pub mod crypto;
pub mod iroh_transport;
pub mod keystore;
pub mod protocol;
pub mod transport;

use crate::crdt::CrdtOp;
use crate::db::{now_iso8601, validate_book_id, AppState};
use crate::error::{AppError, AppResult};
use crate::sync::iroh_transport::IrohTransport;
use crate::sync::keystore::{KeyStore, OsVaultKeyStore};
use crate::sync::protocol::{
    collect_ops_since_hlc, compute_local_frontier, load_known_peer_tickets, load_max_oplog_hlc,
    load_preferred_hub, run_initiator_sync, run_live_session_loop, run_responder_sync,
    set_local_preferred_hub, upsert_peer_ticket, LiveSessionEvent, LiveStreamFrame,
    SyncSessionOutcome,
};
use crate::sync::transport::{NodeTicketAddr, PeerSession, Transport};
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, HashMap};
use std::path::Path;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc, watch, Mutex, Notify, RwLock};
use tokio::task::JoinSet;
use zeroize::Zeroize;

pub const EVENT_CRDT_SYNCED: &str = "crdt:synced";
pub const EVENT_SYNC_STATUS: &str = "sync:status";
pub const DEFAULT_INVITE_TTL_SECS: i64 = 600; // 10 minutes (Section 6.4)
pub const MAX_BACKOFF_SECS: u64 = 60; // Max 60 seconds exponential backoff (Section 6.5)
pub const SUPERVISOR_IDLE_CHECK_SECS: u64 = 25;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CrdtSyncedEvent {
    pub book_id: String,
    pub tables: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SyncStatusEvent {
    pub book_id: String,
    pub state: String,
    pub peers: usize,
    pub last_synced_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InvitePayload {
    pub v: u8,
    pub book_id: String,
    pub book_name: String,
    pub book_key: String,
    pub inviter_node_addr: NodeTicketAddr,
    pub expires_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InviteResponse {
    pub qr_json: String,
    pub expires_at: String,
    pub node_id: String,
}

#[derive(Clone)]
pub struct ActivePeerSessionHandle {
    pub session_id: u64,
    pub node_id: String,
    pub device_id: String,
    pub outbound_tx: mpsc::Sender<LiveStreamFrame>,
    pub stop_tx: watch::Sender<bool>,
}

pub fn build_invite_payload(
    book_id: &str,
    book_name: &str,
    book_key_bytes: &[u8; 32],
    inviter_node_addr: NodeTicketAddr,
    ttl_secs: i64,
) -> AppResult<InviteResponse> {
    let valid_book_id = validate_book_id(book_id)?;
    let clamped_ttl = ttl_secs.clamp(60, 3600);
    let expires_dt = Utc::now() + Duration::seconds(clamped_ttl);
    let expires_at = expires_dt.to_rfc3339();
    let node_id = inviter_node_addr.node_id.clone();

    let payload = InvitePayload {
        v: 1,
        book_id: valid_book_id,
        book_name: book_name.trim().to_string(),
        book_key: hex::encode(book_key_bytes),
        inviter_node_addr,
        expires_at: expires_at.clone(),
    };

    let qr_json = serde_json::to_string(&payload)?;
    Ok(InviteResponse {
        qr_json,
        expires_at,
        node_id,
    })
}

pub fn parse_and_validate_invite(qr_json: &str) -> AppResult<(InvitePayload, [u8; 32])> {
    let payload: InvitePayload = serde_json::from_str(qr_json.trim())
        .map_err(|_| AppError::Validation("Format kode undangan QR tidak valid".into()))?;

    if payload.v != 1 {
        return Err(AppError::Validation(format!(
            "Versi undangan QR (v={}) tidak didukung",
            payload.v
        )));
    }

    let _ = validate_book_id(&payload.book_id)?;
    if payload.book_name.trim().is_empty() {
        return Err(AppError::Validation(
            "Nama buku pada undangan QR kosong".into(),
        ));
    }

    let expires_dt = DateTime::parse_from_rfc3339(&payload.expires_at)
        .map_err(|_| AppError::Validation("Format waktu kedaluwarsa undangan tidak valid".into()))?
        .with_timezone(&Utc);

    if Utc::now() > expires_dt {
        return Err(AppError::Validation(
            "Kode undangan QR telah kedaluwarsa (batas 10 menit terlewati)".into(),
        ));
    }

    let mut raw_key = hex::decode(payload.book_key.trim())
        .map_err(|_| AppError::Validation("Kunci buku pada undangan QR tidak valid".into()))?;
    if raw_key.len() != 32 {
        raw_key.zeroize();
        return Err(AppError::Validation(
            "Panjang kunci buku pada undangan QR harus 32 byte".into(),
        ));
    }

    let mut key_arr = [0u8; 32];
    key_arr.copy_from_slice(&raw_key);
    raw_key.zeroize();

    Ok((payload, key_arr))
}

pub struct SyncEngine {
    pub keystore: Arc<dyn KeyStore>,
    transport: RwLock<Option<Arc<dyn Transport>>>,
    accept_stop_tx: Mutex<Option<watch::Sender<bool>>>,
    app_handle: RwLock<Option<AppHandle>>,
    statuses: RwLock<HashMap<String, SyncStatusEvent>>,
    book_workers: Mutex<HashMap<String, watch::Sender<bool>>>,
    book_wake_notifiers: Mutex<HashMap<String, Arc<Notify>>>,
    active_sessions: RwLock<HashMap<String, Vec<ActivePeerSessionHandle>>>,
    last_broadcast_hlc: Mutex<HashMap<String, String>>,
    pending_synced_tables: Mutex<HashMap<String, BTreeSet<String>>>,
    next_session_id: AtomicU64,
    is_foreground: AtomicBool,
}

impl SyncEngine {
    pub fn new(app_data_dir: &Path) -> AppResult<Arc<Self>> {
        let keystore = Arc::new(OsVaultKeyStore::open(app_data_dir)?);
        Ok(Self::with_keystore(keystore))
    }

    pub fn with_keystore(keystore: Arc<dyn KeyStore>) -> Arc<Self> {
        Arc::new(Self {
            keystore,
            transport: RwLock::new(None),
            accept_stop_tx: Mutex::new(None),
            app_handle: RwLock::new(None),
            statuses: RwLock::new(HashMap::new()),
            book_workers: Mutex::new(HashMap::new()),
            book_wake_notifiers: Mutex::new(HashMap::new()),
            active_sessions: RwLock::new(HashMap::new()),
            last_broadcast_hlc: Mutex::new(HashMap::new()),
            pending_synced_tables: Mutex::new(HashMap::new()),
            next_session_id: AtomicU64::new(1),
            is_foreground: AtomicBool::new(true),
        })
    }

    pub async fn set_app_handle(&self, handle: AppHandle) {
        let mut guard = self.app_handle.write().await;
        *guard = Some(handle);
    }

    pub async fn online_peer_node_ids(&self, book_id: &str) -> BTreeSet<String> {
        let guard = self.active_sessions.read().await;
        guard
            .get(book_id)
            .map(|list| list.iter().map(|h| h.node_id.clone()).collect())
            .unwrap_or_default()
    }

    pub async fn active_peer_count(&self, book_id: &str) -> usize {
        self.online_peer_node_ids(book_id).await.len()
    }

    pub async fn get_local_node_id(self: &Arc<Self>, app_state: &AppState) -> Option<String> {
        let transport = self.ensure_transport(app_state).await.ok()?;
        transport.local_node_addr().ok().map(|a| a.node_id)
    }

    pub async fn get_status(&self, book_id: &str, default_peers: usize) -> SyncStatusEvent {
        let live_peers = self.active_peer_count(book_id).await;
        let guard = self.statuses.read().await;
        if let Some(existing) = guard.get(book_id) {
            let mut cloned = existing.clone();
            if live_peers > 0 {
                cloned.peers = live_peers;
            }
            return cloned;
        }
        SyncStatusEvent {
            book_id: book_id.to_string(),
            state: "idle".to_string(),
            peers: if live_peers > 0 {
                live_peers
            } else {
                default_peers
            },
            last_synced_at: None,
        }
    }

    pub async fn update_and_emit_status(
        &self,
        book_id: &str,
        state_str: &str,
        peers: usize,
        last_synced_at: Option<String>,
    ) {
        let payload = {
            let mut guard = self.statuses.write().await;
            let prev_last = guard.get(book_id).and_then(|s| s.last_synced_at.clone());
            let event = SyncStatusEvent {
                book_id: book_id.to_string(),
                state: state_str.to_string(),
                peers,
                last_synced_at: last_synced_at.or(prev_last),
            };
            guard.insert(book_id.to_string(), event.clone());
            event
        };

        if let Some(ref handle) = *self.app_handle.read().await {
            let _ = handle.emit(EVENT_SYNC_STATUS, &payload);
        }
    }

    pub async fn refresh_book_live_status(&self, book_id: &str, last_synced_at: Option<String>) {
        let count = self.active_peer_count(book_id).await;
        self.update_and_emit_status(book_id, "idle", count, last_synced_at)
            .await;
    }

    async fn get_or_create_wake_notifier(&self, book_id: &str) -> Arc<Notify> {
        let mut guard = self.book_wake_notifiers.lock().await;
        Arc::clone(
            guard
                .entry(book_id.to_string())
                .or_insert_with(|| Arc::new(Notify::new())),
        )
    }

    pub async fn notify_book_supervisor(&self, book_id: &str) {
        let maybe_notify = {
            let guard = self.book_wake_notifiers.lock().await;
            guard.get(book_id).cloned()
        };
        if let Some(n) = maybe_notify {
            n.notify_one();
        }
    }

    /// Emits `crdt:synced` debounced by 250 ms per book_id (Section 3.3).
    pub async fn notify_crdt_synced(self: &Arc<Self>, book_id: &str, tables: &[String]) {
        if tables.is_empty() {
            return;
        }

        let should_spawn = {
            let mut guard = self.pending_synced_tables.lock().await;
            let is_new = !guard.contains_key(book_id);
            let entry = guard.entry(book_id.to_string()).or_default();
            for t in tables {
                entry.insert(t.clone());
            }
            is_new
        };

        if should_spawn {
            let engine = Arc::clone(self);
            let bid = book_id.to_string();
            tokio::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_millis(250)).await;
                let tables_vec = {
                    let mut guard = engine.pending_synced_tables.lock().await;
                    guard
                        .remove(&bid)
                        .map(|set| set.into_iter().collect::<Vec<_>>())
                        .unwrap_or_default()
                };
                if !tables_vec.is_empty() {
                    let payload = CrdtSyncedEvent {
                        book_id: bid,
                        tables: tables_vec,
                    };
                    if let Some(ref handle) = *engine.app_handle.read().await {
                        let _ = handle.emit(EVENT_CRDT_SYNCED, &payload);
                    }
                }
            });
        }
    }

    /// Pushes `ops` over all currently active persistent sessions for `book_id`,
    /// optionally excluding `exclude_node_id` (used when relaying incoming ops as a Hub/Peer).
    pub async fn broadcast_ops_to_active_peers(
        &self,
        book_id: &str,
        ops: Vec<CrdtOp>,
        exclude_node_id: Option<&str>,
    ) -> usize {
        if ops.is_empty() {
            return 0;
        }

        let targets: Vec<mpsc::Sender<LiveStreamFrame>> = {
            let guard = self.active_sessions.read().await;
            let Some(list) = guard.get(book_id) else {
                return 0;
            };
            // Deduplicate by node_id (picking the newest session handle per peer)
            let mut by_node: HashMap<&str, &ActivePeerSessionHandle> = HashMap::new();
            for handle in list {
                if Some(handle.node_id.as_str()) == exclude_node_id {
                    continue;
                }
                by_node.insert(handle.node_id.as_str(), handle);
            }
            by_node
                .into_values()
                .map(|h| h.outbound_tx.clone())
                .collect()
        };

        let mut pushed_peers = 0usize;
        for tx in targets {
            if tx
                .send(LiveStreamFrame::PushOps { ops: ops.clone() })
                .await
                .is_ok()
            {
                pushed_peers += 1;
            }
        }
        pushed_peers
    }

    /// Registers an authenticated `PeerSession` in `active_sessions` and spawns its persistent
    /// full-duplex live stream loop (`run_live_session_loop`).
    pub async fn register_and_spawn_live_session(
        self: &Arc<Self>,
        transport: Arc<dyn Transport>,
        session: Arc<dyn PeerSession>,
        outcome: SyncSessionOutcome,
        book_key: [u8; 32],
        book_conn: Arc<std::sync::Mutex<rusqlite::Connection>>,
    ) {
        let book_id = outcome.book_id.clone();
        let remote_node_id = outcome.remote_node_id.clone();
        let remote_device_id = outcome.remote_device_id.clone();

        if !outcome.changed_tables.is_empty() {
            self.notify_crdt_synced(&book_id, &outcome.changed_tables)
                .await;
        }

        // Advance last_broadcast_hlc watermark if not yet initialized for this book
        {
            let conn_arc = Arc::clone(&book_conn);
            if let Ok(Ok(Some(max_hlc))) =
                tokio::task::spawn_blocking(move || load_max_oplog_hlc(&conn_arc.lock().unwrap()))
                    .await
            {
                let mut hlc_guard = self.last_broadcast_hlc.lock().await;
                let entry = hlc_guard.entry(book_id.clone()).or_default();
                if max_hlc > *entry {
                    *entry = max_hlc;
                }
            }
        }

        let (outbound_tx, outbound_rx) = mpsc::channel::<LiveStreamFrame>(128);
        let (stop_tx, stop_rx) = watch::channel(false);
        let session_id = self.next_session_id.fetch_add(1, Ordering::SeqCst);

        let handle = ActivePeerSessionHandle {
            session_id,
            node_id: remote_node_id.clone(),
            device_id: remote_device_id,
            outbound_tx,
            stop_tx,
        };

        {
            let mut guard = self.active_sessions.write().await;
            let list = guard.entry(book_id.clone()).or_default();
            list.push(handle);
        }

        self.refresh_book_live_status(&book_id, Some(now_iso8601()))
            .await;

        let engine_for_loop = Arc::clone(self);
        let engine_for_events = Arc::clone(self);
        let bid_for_cleanup = book_id.clone();

        tokio::spawn(async move {
            let _ = run_live_session_loop(
                transport,
                session,
                book_id,
                book_key,
                book_conn,
                outbound_rx,
                stop_rx,
                move |event| {
                    let eng = Arc::clone(&engine_for_events);
                    tokio::spawn(async move {
                        match event {
                            LiveSessionEvent::OpsApplied {
                                book_id,
                                from_node_id,
                                applied_ops,
                                changed_tables,
                            } => {
                                // Update local broadcast watermark so we don't re-push remote ops as local mutations
                                if let Some(max_op) =
                                    applied_ops.iter().map(|o| &o.hlc_timestamp).max()
                                {
                                    let mut hlc_guard = eng.last_broadcast_hlc.lock().await;
                                    let entry = hlc_guard.entry(book_id.clone()).or_default();
                                    if max_op > entry {
                                        *entry = max_op.clone();
                                    }
                                }

                                eng.notify_crdt_synced(&book_id, &changed_tables).await;
                                eng.refresh_book_live_status(&book_id, Some(now_iso8601()))
                                    .await;

                                // Instant Hub / Multi-hop Relay Forwarding to all other connected peers!
                                let _ = eng
                                    .broadcast_ops_to_active_peers(
                                        &book_id,
                                        applied_ops,
                                        Some(&from_node_id),
                                    )
                                    .await;
                            }
                            LiveSessionEvent::PreferredHubChanged { book_id, .. } => {
                                eng.refresh_book_live_status(&book_id, None).await;
                                eng.notify_book_supervisor(&book_id).await;
                            }
                        }
                    });
                },
            )
            .await;

            // Remove this session handle on disconnect
            {
                let mut guard = engine_for_loop.active_sessions.write().await;
                if let Some(list) = guard.get_mut(&bid_for_cleanup) {
                    list.retain(|h| h.session_id != session_id);
                }
            }
            engine_for_loop
                .refresh_book_live_status(&bid_for_cleanup, None)
                .await;
            engine_for_loop
                .notify_book_supervisor(&bid_for_cleanup)
                .await;
        });
    }

    /// Injects a custom `Transport` (e.g. `InMemoryTransport` for deterministic tests) and starts the accept loop.
    pub async fn set_custom_transport(
        self: &Arc<Self>,
        app_state: &AppState,
        custom_transport: Arc<dyn Transport>,
    ) {
        {
            let mut write_guard = self.transport.write().await;
            *write_guard = Some(Arc::clone(&custom_transport));
        }
        self.spawn_accept_loop(app_state, custom_transport).await;
    }

    async fn spawn_accept_loop(
        self: &Arc<Self>,
        app_state: &AppState,
        transport: Arc<dyn Transport>,
    ) {
        let (stop_tx, mut stop_rx) = watch::channel(false);
        {
            let mut guard = self.accept_stop_tx.lock().await;
            if let Some(prev) = guard.replace(stop_tx) {
                let _ = prev.send(true);
            }
        }

        let engine_clone = Arc::clone(self);
        let transport_clone = Arc::clone(&transport);
        let state_clone = app_state.clone();

        tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = stop_rx.changed() => {
                        if *stop_rx.borrow() {
                            break;
                        }
                    }
                    accept_res = transport_clone.accept() => {
                        match accept_res {
                            Ok(Some(session_box)) => {
                                let session: Arc<dyn PeerSession> = Arc::from(session_box);
                                let eng = Arc::clone(&engine_clone);
                                let tr = Arc::clone(&transport_clone);
                                let st = state_clone.clone();
                                tokio::spawn(async move {
                                    let st_for_lookup = st.clone();
                                    let res = run_responder_sync(
                                        tr.as_ref(),
                                        session.as_ref(),
                                        eng.keystore.as_ref(),
                                        move |book_id| {
                                            let st_inner = st_for_lookup.clone();
                                            Box::pin(async move {
                                                st_inner.get_or_open_book(&book_id).await
                                            })
                                        },
                                    ).await;

                                    match res {
                                        Ok(outcome) => {
                                            if let (Ok(Some(book_key)), Ok(book_conn)) = (
                                                eng.keystore.get_book_key(&outcome.book_id),
                                                st.get_or_open_book(&outcome.book_id).await,
                                            ) {
                                                eng.register_and_spawn_live_session(
                                                    tr,
                                                    session,
                                                    outcome,
                                                    book_key,
                                                    book_conn,
                                                ).await;
                                            } else {
                                                session.close().await;
                                            }
                                        }
                                        Err(err) => {
                                            session.close().await;
                                            if err.code() == "CLOCK_DRIFT_EXCEEDED" {
                                                for (bid, _) in eng.statuses.read().await.clone() {
                                                    eng.update_and_emit_status(&bid, "error", 0, None).await;
                                                }
                                            }
                                        }
                                    }
                                });
                            }
                            Ok(None) => break,
                            Err(_) => {
                                tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                            }
                        }
                    }
                }
            }
        });
    }

    pub async fn ensure_transport(
        self: &Arc<Self>,
        app_state: &AppState,
    ) -> AppResult<Arc<dyn Transport>> {
        {
            let read_guard = self.transport.read().await;
            if let Some(ref t) = *read_guard {
                return Ok(Arc::clone(t));
            }
        }

        let mut write_guard = self.transport.write().await;
        if let Some(ref t) = *write_guard {
            return Ok(Arc::clone(t));
        }

        let mut secret = self.keystore.get_or_create_node_secret_key()?;
        let iroh_res = IrohTransport::bind_with_secret(secret).await;
        secret.zeroize();
        let transport: Arc<dyn Transport> = Arc::new(iroh_res?);
        *write_guard = Some(Arc::clone(&transport));
        drop(write_guard);

        self.spawn_accept_loop(app_state, Arc::clone(&transport))
            .await;

        Ok(transport)
    }

    pub async fn start_book_sync(
        self: &Arc<Self>,
        app_state: &AppState,
        book_id: &str,
    ) -> AppResult<()> {
        let valid_id = validate_book_id(book_id)?;
        let _ = self.keystore.get_or_create_book_key(&valid_id)?;

        // Initialize last_broadcast_hlc watermark if not present
        if let Ok(book_conn) = app_state.get_or_open_book(&valid_id).await {
            let conn_arc = Arc::clone(&book_conn);
            if let Ok(Ok(Some(max_hlc))) =
                tokio::task::spawn_blocking(move || load_max_oplog_hlc(&conn_arc.lock().unwrap()))
                    .await
            {
                let mut hlc_guard = self.last_broadcast_hlc.lock().await;
                hlc_guard.entry(valid_id.clone()).or_insert(max_hlc);
            }
        }

        if !self.is_foreground.load(Ordering::SeqCst) {
            return Ok(());
        }

        {
            let guard = self.book_workers.lock().await;
            if guard.contains_key(&valid_id) {
                self.notify_book_supervisor(&valid_id).await;
                return Ok(());
            }
        }

        let (stop_tx, mut stop_rx) = watch::channel(false);
        {
            let mut guard = self.book_workers.lock().await;
            guard.insert(valid_id.clone(), stop_tx);
        }

        let wake_notify = self.get_or_create_wake_notifier(&valid_id).await;
        let engine = Arc::clone(self);
        let state = app_state.clone();
        let bid = valid_id.clone();

        tokio::spawn(async move {
            let mut backoff_secs = 1u64;
            loop {
                if !engine.is_foreground.load(Ordering::SeqCst) || *stop_rx.borrow() {
                    break;
                }

                let has_online_or_no_peers = engine.sync_book_once(&state, &bid).await;
                let wait_secs = if has_online_or_no_peers {
                    backoff_secs = 1;
                    SUPERVISOR_IDLE_CHECK_SECS
                } else {
                    let current = backoff_secs;
                    backoff_secs = (backoff_secs * 2).min(MAX_BACKOFF_SECS);
                    current
                };

                tokio::select! {
                    _ = stop_rx.changed() => {
                        if *stop_rx.borrow() {
                            break;
                        }
                    }
                    _ = wake_notify.notified() => {
                        backoff_secs = 1;
                    }
                    _ = tokio::time::sleep(std::time::Duration::from_secs(wait_secs)) => {}
                }
            }
        });

        Ok(())
    }

    async fn connect_and_register_peer(
        self: &Arc<Self>,
        transport: Arc<dyn Transport>,
        book_id: String,
        book_key: [u8; 32],
        book_conn: Arc<std::sync::Mutex<rusqlite::Connection>>,
        ticket: NodeTicketAddr,
    ) -> Result<bool, AppError> {
        let session_box = transport.connect(&ticket).await?;
        let session: Arc<dyn PeerSession> = Arc::from(session_box);

        match run_initiator_sync(
            transport.as_ref(),
            session.as_ref(),
            &book_id,
            &book_key,
            Arc::clone(&book_conn),
        )
        .await
        {
            Ok(outcome) => {
                self.register_and_spawn_live_session(
                    transport, session, outcome, book_key, book_conn,
                )
                .await;
                Ok(true)
            }
            Err(err) => {
                session.close().await;
                Err(err)
            }
        }
    }

    /// Supervisor pass: maintains persistent connections using Preferred Hub priority + Parallel Mesh fallback.
    pub async fn sync_book_once(self: &Arc<Self>, app_state: &AppState, book_id: &str) -> bool {
        let Ok(transport) = self.ensure_transport(app_state).await else {
            return false;
        };
        let Ok(Some(book_key)) = self.keystore.get_book_key(book_id) else {
            return false;
        };
        let Ok(book_conn) = app_state.get_or_open_book(book_id).await else {
            return false;
        };
        let local_node_id = transport
            .local_node_addr()
            .map(|a| a.node_id)
            .unwrap_or_default();

        let (peers, preferred_hub_id) = {
            let conn_arc = Arc::clone(&book_conn);
            let Ok(Ok(res)) = tokio::task::spawn_blocking(
                move || -> AppResult<(Vec<NodeTicketAddr>, Option<String>)> {
                    let guard = conn_arc
                        .lock()
                        .map_err(|_| AppError::Internal("Book mutex poisoned".into()))?;
                    let list = load_known_peer_tickets(&guard)?;
                    let (hub, _) = load_preferred_hub(&guard)?;
                    Ok((list, hub))
                },
            )
            .await
            else {
                return false;
            };
            res
        };

        let peers: Vec<NodeTicketAddr> = peers
            .into_iter()
            .filter(|p| p.node_id != local_node_id)
            .collect();

        if peers.is_empty() {
            let current_online = self.active_peer_count(book_id).await;
            self.update_and_emit_status(book_id, "idle", current_online, None)
                .await;
            return true;
        }

        let online_ids = self.online_peer_node_ids(book_id).await;

        // Priority 1: Preferred Hub Topology (if a remote node is configured as preferred Hub)
        if let Some(ref hub_node_id) = preferred_hub_id {
            if hub_node_id != &local_node_id {
                if online_ids.contains(hub_node_id) {
                    // Spoke is already connected to the active Hub via persistent stream!
                    self.refresh_book_live_status(book_id, None).await;
                    return true;
                }
                if let Some(hub_ticket) = peers.iter().find(|p| &p.node_id == hub_node_id).cloned()
                {
                    if online_ids.is_empty() {
                        self.update_and_emit_status(book_id, "connecting", 0, None)
                            .await;
                    }
                    match self
                        .connect_and_register_peer(
                            Arc::clone(&transport),
                            book_id.to_string(),
                            book_key,
                            Arc::clone(&book_conn),
                            hub_ticket,
                        )
                        .await
                    {
                        Ok(true) => {
                            return true;
                        }
                        Err(err) if err.code() == "CLOCK_DRIFT_EXCEEDED" => {
                            let online = self.active_peer_count(book_id).await;
                            self.update_and_emit_status(book_id, "error", online, None)
                                .await;
                            return false;
                        }
                        _ => {
                            // Hub is unreachable -> fall through to Parallel Mesh Fallback!
                        }
                    }
                }
            }
        }

        // Priority 2: Parallel Mesh Connection for unconnected peers
        let unconnected: Vec<NodeTicketAddr> = peers
            .into_iter()
            .filter(|p| !online_ids.contains(&p.node_id))
            .collect();

        if unconnected.is_empty() {
            self.refresh_book_live_status(book_id, None).await;
            return true;
        }

        if online_ids.is_empty() {
            self.update_and_emit_status(book_id, "connecting", 0, None)
                .await;
        }

        let mut join_set = JoinSet::new();
        for ticket in unconnected.into_iter().take(8) {
            let eng = Arc::clone(self);
            let tr = Arc::clone(&transport);
            let bid = book_id.to_string();
            let conn_arc = Arc::clone(&book_conn);
            join_set.spawn(async move {
                eng.connect_and_register_peer(tr, bid, book_key, conn_arc, ticket)
                    .await
            });
        }

        let mut clock_drift = false;
        while let Some(joined) = join_set.join_next().await {
            if let Ok(Err(err)) = joined {
                if err.code() == "CLOCK_DRIFT_EXCEEDED" {
                    clock_drift = true;
                }
            }
        }

        let final_online = self.active_peer_count(book_id).await;
        if clock_drift && final_online == 0 {
            self.update_and_emit_status(book_id, "error", 0, None).await;
            return false;
        }

        let synced_at = if final_online > 0 {
            Some(now_iso8601())
        } else {
            None
        };
        self.update_and_emit_status(book_id, "idle", final_online, synced_at)
            .await;
        final_online > 0
    }

    /// Event-driven instant push triggered immediately on local SQLite mutations.
    /// Pushes newly committed `CrdtOp`s down all open persistent streams for `book_id` in milliseconds,
    /// and wakes the connection supervisor if any peers are not yet connected.
    pub fn trigger_sync_now(self: &Arc<Self>, app_state: &AppState, book_id: &str) {
        if !self.is_foreground.load(Ordering::SeqCst) {
            return;
        }
        let Ok(valid_id) = validate_book_id(book_id) else {
            return;
        };
        let engine = Arc::clone(self);
        let state = app_state.clone();
        tokio::spawn(async move {
            if let Ok(book_conn) = state.get_or_open_book(&valid_id).await {
                let since_hlc = {
                    let guard = engine.last_broadcast_hlc.lock().await;
                    guard.get(&valid_id).cloned()
                };
                let conn_arc = Arc::clone(&book_conn);
                if let Ok(Ok(new_ops)) = tokio::task::spawn_blocking(move || {
                    let guard = conn_arc
                        .lock()
                        .map_err(|_| AppError::Internal("Book DB mutex poisoned".into()))?;
                    collect_ops_since_hlc(&guard, since_hlc.as_deref())
                })
                .await
                {
                    if let Some(max_hlc) = new_ops.last().map(|o| o.hlc_timestamp.clone()) {
                        let mut guard = engine.last_broadcast_hlc.lock().await;
                        guard.insert(valid_id.clone(), max_hlc);
                    }
                    if !new_ops.is_empty() {
                        let pushed = engine
                            .broadcast_ops_to_active_peers(&valid_id, new_ops, None)
                            .await;
                        if pushed > 0 {
                            engine
                                .refresh_book_live_status(&valid_id, Some(now_iso8601()))
                                .await;
                        }
                    }
                }
            }
            // Wake supervisor so any disconnected peers are dialed right away
            engine.notify_book_supervisor(&valid_id).await;
        });
    }

    /// Sets or clears the preferred Hub node ID for `book_id`, persists it with a new HLC timestamp,
    /// immediately broadcasts a Heartbeat carrying the updated Hub to all connected peers,
    /// and wakes the supervisor to adjust topology connections.
    pub async fn set_preferred_hub(
        self: &Arc<Self>,
        app_state: &AppState,
        book_id: &str,
        hub_node_id: Option<String>,
    ) -> AppResult<Option<String>> {
        let valid_id = validate_book_id(book_id)?;
        let book_conn = app_state.get_or_open_book(&valid_id).await?;

        let (clean_hub, new_hlc, frontier) = {
            let conn_arc = Arc::clone(&book_conn);
            tokio::task::spawn_blocking(move || -> AppResult<_> {
                let mut guard = conn_arc
                    .lock()
                    .map_err(|_| AppError::Internal("Book DB mutex poisoned".into()))?;
                let (clean_hub, new_hlc) =
                    set_local_preferred_hub(&mut guard, hub_node_id.as_deref())?;
                let frontier = compute_local_frontier(&guard)?;
                Ok((clean_hub, new_hlc, frontier))
            })
            .await
            .map_err(|e| AppError::TaskJoin(e.to_string()))??
        };

        // Broadcast updated preferred hub via Heartbeat frame to all active sessions
        let targets: Vec<mpsc::Sender<LiveStreamFrame>> = {
            let guard = self.active_sessions.read().await;
            guard
                .get(&valid_id)
                .map(|list| list.iter().map(|h| h.outbound_tx.clone()).collect())
                .unwrap_or_default()
        };

        let hb_frame = LiveStreamFrame::Heartbeat {
            frontier,
            preferred_hub_node_id: clean_hub.clone(),
            preferred_hub_hlc: Some(new_hlc),
        };
        for tx in targets {
            let _ = tx.send(hb_frame.clone()).await;
        }

        self.refresh_book_live_status(&valid_id, None).await;
        self.notify_book_supervisor(&valid_id).await;
        Ok(clean_hub)
    }

    pub async fn stop_book_sync(&self, book_id: &str) {
        {
            let mut guard = self.book_workers.lock().await;
            if let Some(tx) = guard.remove(book_id) {
                let _ = tx.send(true);
            }
        }
        {
            let mut guard = self.active_sessions.write().await;
            if let Some(sessions) = guard.remove(book_id) {
                for handle in sessions {
                    let _ = handle.stop_tx.send(true);
                }
            }
        }
        self.update_and_emit_status(book_id, "idle", 0, None).await;
    }

    /// Foreground-only lifecycle handler (Section 6.5).
    pub async fn set_foreground(self: &Arc<Self>, app_state: &AppState, is_foreground: bool) {
        let prev = self.is_foreground.swap(is_foreground, Ordering::SeqCst);
        if prev == is_foreground {
            if is_foreground {
                // Even if already marked foreground (e.g. window focus event), wake supervisors
                let book_ids: Vec<String> = {
                    let guard = self.book_workers.lock().await;
                    guard.keys().cloned().collect()
                };
                for bid in book_ids {
                    self.notify_book_supervisor(&bid).await;
                }
            }
            return;
        }

        if !is_foreground {
            // Stop all book workers and close all active persistent sessions cleanly on pause/background
            let active_ids: Vec<String> = {
                let mut guard = self.book_workers.lock().await;
                let keys = guard.keys().cloned().collect();
                for (_, tx) in guard.drain() {
                    let _ = tx.send(true);
                }
                keys
            };
            {
                let mut sess_guard = self.active_sessions.write().await;
                for (_, list) in sess_guard.drain() {
                    for handle in list {
                        let _ = handle.stop_tx.send(true);
                    }
                }
            }
            for bid in active_ids {
                self.update_and_emit_status(&bid, "idle", 0, None).await;
            }
            if let Some(stop_tx) = self.accept_stop_tx.lock().await.take() {
                let _ = stop_tx.send(true);
            }
            let maybe_transport = self.transport.write().await.take();
            if let Some(t) = maybe_transport {
                t.shutdown().await;
            }
        } else {
            // Resume sync for currently open books in AppState pool
            let open_book_ids: Vec<String> = {
                match app_state.pool.read() {
                    Ok(guard) => guard.keys().cloned().collect(),
                    Err(_) => Vec::new(),
                }
            };
            for bid in open_book_ids {
                let _ = self.start_book_sync(app_state, &bid).await;
            }
        }
    }

    pub async fn sync_with_inviter_ticket(
        self: &Arc<Self>,
        app_state: &AppState,
        book_id: &str,
        inviter_ticket: &NodeTicketAddr,
    ) -> AppResult<()> {
        let transport = self.ensure_transport(app_state).await?;
        let book_key = self
            .keystore
            .get_book_key(book_id)?
            .ok_or_else(|| AppError::NotFound("Book key not found in keystore".into()))?;
        let book_conn = app_state.get_or_open_book(book_id).await?;

        // Save full inviter ticket (node_id + relay_url + direct_addrs) to sync_peers
        {
            let conn_arc = Arc::clone(&book_conn);
            let ticket_clone = inviter_ticket.clone();
            tokio::task::spawn_blocking(move || -> AppResult<()> {
                let guard = conn_arc
                    .lock()
                    .map_err(|_| AppError::Internal("Book DB mutex poisoned".into()))?;
                upsert_peer_ticket(&guard, &ticket_clone, None, None, None)?;
                Ok(())
            })
            .await
            .map_err(|e| AppError::TaskJoin(e.to_string()))??;
        }

        self.update_and_emit_status(book_id, "connecting", 0, None)
            .await;

        let mut synced = false;
        let mut clock_drift = false;

        for attempt in 0..3 {
            if attempt > 0 {
                tokio::time::sleep(std::time::Duration::from_millis(350)).await;
            }
            if let Ok(session_box) = transport.connect(inviter_ticket).await {
                let session: Arc<dyn PeerSession> = Arc::from(session_box);
                self.update_and_emit_status(book_id, "syncing", 1, None)
                    .await;
                match run_initiator_sync(
                    transport.as_ref(),
                    session.as_ref(),
                    book_id,
                    &book_key,
                    Arc::clone(&book_conn),
                )
                .await
                {
                    Ok(outcome) => {
                        self.register_and_spawn_live_session(
                            Arc::clone(&transport),
                            session,
                            outcome,
                            book_key,
                            Arc::clone(&book_conn),
                        )
                        .await;
                        synced = true;
                        break;
                    }
                    Err(e) => {
                        session.close().await;
                        if e.code() == "CLOCK_DRIFT_EXCEEDED" {
                            clock_drift = true;
                            break;
                        }
                    }
                }
            }
        }

        if !synced {
            let state_str = if clock_drift { "error" } else { "idle" };
            self.update_and_emit_status(book_id, state_str, 0, None)
                .await;
        }

        let _ = self.start_book_sync(app_state, book_id).await;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::{
        add_transaction_in_conn, create_book_in_state, get_account_balances_in_conn,
        upsert_account_in_conn, upsert_category_in_conn, AddTransactionInput, UpsertAccountInput,
        UpsertCategoryInput,
    };
    use crate::sync::crypto::BookMasterKey;
    use crate::sync::transport::InMemoryTransport;
    use tempfile::TempDir;

    #[test]
    fn test_invite_qr_creation_validation_and_expiration() {
        let book_id = "018f0000-0000-7000-8000-000000000123";
        let master = BookMasterKey::generate();
        let addr = NodeTicketAddr {
            node_id: "node-abc-123".into(),
            relay_url: Some("https://relay.iroh.network/".into()),
            direct_addrs: vec!["192.168.1.10:11204".into()],
        };

        let invite =
            build_invite_payload(book_id, "Buku Keluarga", master.as_bytes(), addr, 600).unwrap();
        let (parsed, parsed_key) = parse_and_validate_invite(&invite.qr_json).unwrap();
        assert_eq!(parsed.book_id, book_id);
        assert_eq!(parsed.book_name, "Buku Keluarga");
        assert_eq!(&parsed_key, master.as_bytes());

        // Expired QR must be rejected
        let expired_payload = InvitePayload {
            v: 1,
            book_id: book_id.into(),
            book_name: "Buku Keluarga".into(),
            book_key: hex::encode(master.as_bytes()),
            inviter_node_addr: NodeTicketAddr {
                node_id: "node-abc-123".into(),
                relay_url: None,
                direct_addrs: vec![],
            },
            expires_at: (Utc::now() - Duration::minutes(5)).to_rfc3339(),
        };
        let expired_json = serde_json::to_string(&expired_payload).unwrap();
        assert!(parse_and_validate_invite(&expired_json).is_err());
    }

    #[tokio::test]
    async fn test_hub_and_spoke_three_peer_instant_relay() {
        // Topology: Spoke A <-> Hub H <-> Spoke B
        // Spoke A and Spoke B only have a ticket for Hub H (not each other).
        // When A commits a new transaction and calls trigger_sync_now,
        // it is pushed over A's persistent stream to Hub H, and H automatically relays it to Spoke B!
        let dir_a = TempDir::new().unwrap();
        let dir_h = TempDir::new().unwrap();
        let dir_b = TempDir::new().unwrap();

        let state_a = AppState::new(dir_a.path().to_path_buf()).unwrap();
        let state_h = AppState::new(dir_h.path().to_path_buf()).unwrap();
        let state_b = AppState::new(dir_b.path().to_path_buf()).unwrap();

        let mesh = InMemoryTransport::create_mesh(&["node-a", "node-h", "node-b"]);
        state_a
            .sync
            .set_custom_transport(
                &state_a,
                Arc::clone(mesh.get("node-a").unwrap()) as Arc<dyn Transport>,
            )
            .await;
        state_h
            .sync
            .set_custom_transport(
                &state_h,
                Arc::clone(mesh.get("node-h").unwrap()) as Arc<dyn Transport>,
            )
            .await;
        state_b
            .sync
            .set_custom_transport(
                &state_b,
                Arc::clone(mesh.get("node-b").unwrap()) as Arc<dyn Transport>,
            )
            .await;

        // Hub H creates the book
        let meta = create_book_in_state(&state_h, "Buku Keluarga Hub".into(), "PERSONAL".into())
            .await
            .unwrap();
        let book_id = meta.id.clone();
        let book_key = state_h
            .sync
            .keystore
            .get_or_create_book_key(&book_id)
            .unwrap();

        // Designate node-h as Preferred Hub
        state_h
            .sync
            .set_preferred_hub(&state_h, &book_id, Some("node-h".into()))
            .await
            .unwrap();
        state_h
            .sync
            .start_book_sync(&state_h, &book_id)
            .await
            .unwrap();

        // Setup Spoke A & Spoke B with the same book_id & book_key, pointing to Hub H
        for st in [&state_a, &state_b] {
            st.sync.keystore.set_book_key(&book_id, &book_key).unwrap();
            let bid = book_id.clone();
            st.with_registry(move |reg| {
                reg.execute(
                    "INSERT INTO books (id, name, kind, created_at, last_opened_at)
                     VALUES (?1, 'Buku Keluarga Hub', 'PERSONAL', '2026-06-01T00:00:00Z', '2026-06-01T00:00:00Z')",
                    rusqlite::params![bid],
                )?;
                Ok(())
            })
            .await
            .unwrap();
        }

        let hub_ticket = NodeTicketAddr {
            node_id: "node-h".into(),
            relay_url: None,
            direct_addrs: vec!["127.0.0.1:11204".into()],
        };

        state_a
            .sync
            .sync_with_inviter_ticket(&state_a, &book_id, &hub_ticket)
            .await
            .unwrap();
        state_b
            .sync
            .sync_with_inviter_ticket(&state_b, &book_id, &hub_ticket)
            .await
            .unwrap();

        // Both Spoke A and Spoke B should now have an active persistent session with Hub H,
        // and both should have learned preferred_hub_node_id == "node-h" via handshake!
        tokio::time::sleep(tokio::time::Duration::from_millis(50)).await;
        assert_eq!(state_a.sync.active_peer_count(&book_id).await, 1);
        assert_eq!(state_b.sync.active_peer_count(&book_id).await, 1);
        assert_eq!(state_h.sync.active_peer_count(&book_id).await, 2);

        let learned_hub_b = state_b
            .with_book(&book_id, |conn| Ok(load_preferred_hub(conn)?.0))
            .await
            .unwrap();
        assert_eq!(learned_hub_b.as_deref(), Some("node-h"));

        // Now Spoke A creates an account, category, and transaction, and calls trigger_sync_now!
        state_a
            .with_book(&book_id, |conn| {
                upsert_account_in_conn(
                    conn,
                    UpsertAccountInput {
                        id: Some("acc-hub-test".into()),
                        name: "Mandiri Keluarga".into(),
                        account_type: "BANK".into(),
                        initial_balance: 20_000_000,
                    },
                )?;
                upsert_category_in_conn(
                    conn,
                    UpsertCategoryInput {
                        id: Some("cat-listrik".into()),
                        name: "Tagihan Listrik".into(),
                        kind: "EXPENSE".into(),
                    },
                )?;
                add_transaction_in_conn(
                    conn,
                    AddTransactionInput {
                        id: None,
                        account_id: "acc-hub-test".into(),
                        to_account_id: None,
                        category_id: Some("cat-listrik".into()),
                        amount: -750_000,
                        tx_type: "EXPENSE".into(),
                        note: Some("Bayar PLN dari Spoke A".into()),
                        tx_date: "2026-06-15".into(),
                        link_id: None,
                    },
                )?;
                Ok(())
            })
            .await
            .unwrap();

        state_a.sync.trigger_sync_now(&state_a, &book_id);

        // Wait briefly for instant live stream push A -> H -> B (no polling needed!)
        let mut converged = false;
        for _ in 0..30 {
            tokio::time::sleep(std::time::Duration::from_millis(25)).await;
            let balances_b = state_b
                .with_book(&book_id, |conn| get_account_balances_in_conn(conn))
                .await
                .unwrap();
            if let Some(acc) = balances_b.iter().find(|a| a.account_id == "acc-hub-test") {
                if acc.current_balance == 19_250_000 {
                    converged = true;
                    break;
                }
            }
        }
        assert!(
            converged,
            "Spoke B must receive Spoke A's transaction via Hub H instant relay"
        );

        state_a.sync.stop_book_sync(&book_id).await;
        state_h.sync.stop_book_sync(&book_id).await;
        state_b.sync.stop_book_sync(&book_id).await;
    }
}

