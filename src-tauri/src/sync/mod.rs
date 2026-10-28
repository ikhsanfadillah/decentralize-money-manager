pub mod crypto;
pub mod iroh_transport;
pub mod keystore;
pub mod protocol;
pub mod transport;

use crate::db::{now_iso8601, validate_book_id, AppState};
use crate::error::{AppError, AppResult};
use crate::sync::iroh_transport::IrohTransport;
use crate::sync::keystore::{KeyStore, OsVaultKeyStore};
use crate::sync::protocol::{
    load_known_peer_tickets, run_initiator_sync, run_responder_sync, upsert_peer_ticket,
};
use crate::sync::transport::{NodeTicketAddr, Transport};
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, HashMap};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::{watch, Mutex, RwLock};
use tauri::{AppHandle, Emitter};
use zeroize::Zeroize;

pub const EVENT_CRDT_SYNCED: &str = "crdt:synced";
pub const EVENT_SYNC_STATUS: &str = "sync:status";
pub const DEFAULT_INVITE_TTL_SECS: i64 = 600; // 10 minutes (Section 6.4)
pub const MAX_BACKOFF_SECS: u64 = 60; // Max 60 seconds exponential backoff (Section 6.5)

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
    pending_synced_tables: Mutex<HashMap<String, BTreeSet<String>>>,
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
            pending_synced_tables: Mutex::new(HashMap::new()),
            is_foreground: AtomicBool::new(true),
        })
    }

    pub async fn set_app_handle(&self, handle: AppHandle) {
        let mut guard = self.app_handle.write().await;
        *guard = Some(handle);
    }

    pub async fn get_status(&self, book_id: &str, default_peers: usize) -> SyncStatusEvent {
        let guard = self.statuses.read().await;
        guard
            .get(book_id)
            .cloned()
            .unwrap_or_else(|| SyncStatusEvent {
                book_id: book_id.to_string(),
                state: "idle".to_string(),
                peers: default_peers,
                last_synced_at: None,
            })
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
            let prev_last = guard
                .get(book_id)
                .and_then(|s| s.last_synced_at.clone());
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

    /// Emits `crdt:synced` debounced by 250 ms per book_id (Section 3.3).
    pub async fn notify_crdt_synced(
        self: &Arc<Self>,
        book_id: &str,
        tables: &[String],
    ) {
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

        // Start incoming connection accept loop
        let (stop_tx, mut stop_rx) = watch::channel(false);
        {
            let mut guard = self.accept_stop_tx.lock().await;
            *guard = Some(stop_tx);
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
                            Ok(Some(mut session)) => {
                                let eng = Arc::clone(&engine_clone);
                                let tr = Arc::clone(&transport_clone);
                                let st = state_clone.clone();
                                tokio::spawn(async move {
                                    let st_for_lookup = st.clone();
                                    let res = run_responder_sync(
                                        tr.as_ref(),
                                        session.as_mut(),
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
                                            session.close().await;
                                            if !outcome.changed_tables.is_empty() {
                                                eng.notify_crdt_synced(&outcome.book_id, &outcome.changed_tables).await;
                                            }
                                            eng.update_and_emit_status(
                                                &outcome.book_id,
                                                "idle",
                                                1,
                                                Some(now_iso8601()),
                                            ).await;
                                        }
                                        Err(err) => {
                                            session.close().await;
                                            if err.code() == "CLOCK_DRIFT_EXCEEDED" {
                                                // Report clock drift via sync:status error without crashing (Section 5.1)
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

        Ok(transport)
    }

    pub async fn start_book_sync(
        self: &Arc<Self>,
        app_state: &AppState,
        book_id: &str,
    ) -> AppResult<()> {
        let valid_id = validate_book_id(book_id)?;
        let _ = self.keystore.get_or_create_book_key(&valid_id)?;

        if !self.is_foreground.load(Ordering::SeqCst) {
            return Ok(());
        }

        {
            let guard = self.book_workers.lock().await;
            if guard.contains_key(&valid_id) {
                return Ok(());
            }
        }

        let (stop_tx, mut stop_rx) = watch::channel(false);
        {
            let mut guard = self.book_workers.lock().await;
            guard.insert(valid_id.clone(), stop_tx);
        }

        let engine = Arc::clone(self);
        let state = app_state.clone();
        let bid = valid_id.clone();

        tokio::spawn(async move {
            let mut backoff_secs = 1u64;
            loop {
                if !engine.is_foreground.load(Ordering::SeqCst) || *stop_rx.borrow() {
                    break;
                }

                let synced_any = engine.sync_book_once(&state, &bid).await;
                let wait_secs = if synced_any {
                    backoff_secs = 1;
                    15
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
                    _ = tokio::time::sleep(std::time::Duration::from_secs(wait_secs)) => {}
                }
            }
        });

        Ok(())
    }

    pub async fn sync_book_once(
        self: &Arc<Self>,
        app_state: &AppState,
        book_id: &str,
    ) -> bool {
        let Ok(transport) = self.ensure_transport(app_state).await else {
            return false;
        };
        let Ok(Some(book_key)) = self.keystore.get_book_key(book_id) else {
            return false;
        };
        let Ok(book_conn) = app_state.get_or_open_book(book_id).await else {
            return false;
        };

        let peers: Vec<NodeTicketAddr> = {
            let conn_arc = Arc::clone(&book_conn);
            let Ok(Ok(list)) =
                tokio::task::spawn_blocking(move || -> AppResult<Vec<NodeTicketAddr>> {
                    let guard = conn_arc
                        .lock()
                        .map_err(|_| AppError::Internal("Book mutex poisoned".into()))?;
                    load_known_peer_tickets(&guard)
                })
                .await
            else {
                return false;
            };
            list
        };

        if peers.is_empty() {
            self.update_and_emit_status(book_id, "idle", 0, None).await;
            return true;
        }

        self.update_and_emit_status(book_id, "connecting", 0, None)
            .await;

        let mut online_peers = 0usize;
        for ticket in peers {
            if let Ok(mut session) = transport.connect(&ticket).await {
                self.update_and_emit_status(book_id, "syncing", online_peers + 1, None)
                    .await;
                match run_initiator_sync(
                    transport.as_ref(),
                    session.as_mut(),
                    book_id,
                    &book_key,
                    Arc::clone(&book_conn),
                )
                .await
                {
                    Ok(outcome) => {
                        online_peers += 1;
                        if !outcome.changed_tables.is_empty() {
                            self.notify_crdt_synced(book_id, &outcome.changed_tables)
                                .await;
                        }
                    }
                    Err(err) => {
                        if err.code() == "CLOCK_DRIFT_EXCEEDED" {
                            self.update_and_emit_status(book_id, "error", online_peers, None)
                                .await;
                            session.close().await;
                            return false;
                        }
                    }
                }
                session.close().await;
            }
        }

        let synced_at = if online_peers > 0 {
            Some(now_iso8601())
        } else {
            None
        };
        self.update_and_emit_status(book_id, "idle", online_peers, synced_at)
            .await;
        online_peers > 0
    }

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
            let _ = engine.sync_book_once(&state, &valid_id).await;
        });
    }

    pub async fn stop_book_sync(&self, book_id: &str) {
        let mut guard = self.book_workers.lock().await;
        if let Some(tx) = guard.remove(book_id) {
            let _ = tx.send(true);
        }
        self.update_and_emit_status(book_id, "idle", 0, None).await;
    }

    /// Foreground-only lifecycle handler (Section 6.5).
    pub async fn set_foreground(self: &Arc<Self>, app_state: &AppState, is_foreground: bool) {
        let prev = self.is_foreground.swap(is_foreground, Ordering::SeqCst);
        if prev == is_foreground {
            return;
        }

        if !is_foreground {
            // Stop all book workers and shut down transport cleanly on pause/background
            let active_ids: Vec<String> = {
                let mut guard = self.book_workers.lock().await;
                let keys = guard.keys().cloned().collect();
                for (_, tx) in guard.drain() {
                    let _ = tx.send(true);
                }
                keys
            };
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
                upsert_peer_ticket(&guard, &ticket_clone, None, None)?;
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
            if let Ok(mut session) = transport.connect(inviter_ticket).await {
                self.update_and_emit_status(book_id, "syncing", 1, None)
                    .await;
                match run_initiator_sync(
                    transport.as_ref(),
                    session.as_mut(),
                    book_id,
                    &book_key,
                    Arc::clone(&book_conn),
                )
                .await
                {
                    Ok(outcome) => {
                        session.close().await;
                        if !outcome.changed_tables.is_empty() {
                            self.notify_crdt_synced(book_id, &outcome.changed_tables)
                                .await;
                        }
                        self.update_and_emit_status(book_id, "idle", 1, Some(now_iso8601()))
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
    use crate::sync::crypto::BookMasterKey;

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
}

