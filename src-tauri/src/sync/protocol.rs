use crate::crdt::{merge_remote_oplog, CrdtOp, MergeReport};
use crate::db::now_iso8601;
use crate::error::{AppError, AppResult};
use crate::hlc::{load_clock_from_tx, save_clock_to_tx, system_now_ms};
use crate::sync::crypto::{
    compute_auth_mac, decrypt_wire_payload, encrypt_wire_payload, random_nonce_32, verify_auth_mac,
    DerivedBookKeys, ROLE_CLIENT_AUTH, ROLE_SERVER_AUTH,
};
use crate::sync::keystore::KeyStore;
use crate::sync::transport::{NodeTicketAddr, PeerSession, Transport};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, HashMap};
use std::sync::{Arc, Mutex};
use tokio::sync::{mpsc, watch};

pub const MAX_DELTA_BATCH_OPS: usize = 500;
pub const MAX_DELTA_BATCH_BYTES: usize = 256 * 1024; // 256 KiB per batch (Section 6.3)
pub const LIVE_HEARTBEAT_INTERVAL_SECS: u64 = 20;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HelloMessage {
    pub book_topic_id: [u8; 32],
    pub device_id: String,
    pub nonce: [u8; 32],
    pub known_peers: Vec<String>,
    #[serde(default)]
    pub sender_addr: Option<NodeTicketAddr>,
    #[serde(default)]
    pub known_peer_addrs: Vec<NodeTicketAddr>,
    #[serde(default)]
    pub preferred_hub_node_id: Option<String>,
    #[serde(default)]
    pub preferred_hub_hlc: Option<String>,
    #[serde(default)]
    pub device_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChallengeMessage {
    pub server_nonce: [u8; 32],
    pub device_id: String,
    pub server_mac: [u8; 32],
    pub known_peers: Vec<String>,
    #[serde(default)]
    pub sender_addr: Option<NodeTicketAddr>,
    #[serde(default)]
    pub known_peer_addrs: Vec<NodeTicketAddr>,
    #[serde(default)]
    pub preferred_hub_node_id: Option<String>,
    #[serde(default)]
    pub preferred_hub_hlc: Option<String>,
    #[serde(default)]
    pub device_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuthProofMessage {
    pub client_mac: [u8; 32],
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FrontierMessage {
    pub frontier: HashMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeltaBatchMessage {
    pub ops: Vec<CrdtOp>,
    pub is_final: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncAckMessage {
    pub ok: bool,
}

/// Persistent stream frame exchanged after initial handshake & SyncAck (Section 6.3 step 4).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum LiveStreamFrame {
    PushOps {
        ops: Vec<CrdtOp>,
    },
    Heartbeat {
        frontier: HashMap<String, String>,
        preferred_hub_node_id: Option<String>,
        preferred_hub_hlc: Option<String>,
    },
    Disconnect,
}

#[derive(Debug, Clone)]
pub enum LiveSessionEvent {
    OpsApplied {
        book_id: String,
        from_node_id: String,
        applied_ops: Vec<CrdtOp>,
        changed_tables: Vec<String>,
    },
    PreferredHubChanged {
        book_id: String,
        preferred_hub_node_id: Option<String>,
    },
}

#[derive(Debug, Clone, Default)]
pub struct SyncSessionOutcome {
    pub book_id: String,
    pub remote_node_id: String,
    pub remote_device_id: String,
    pub sent_ops: usize,
    pub received_ops: usize,
    pub changed_tables: Vec<String>,
    pub hub_updated: bool,
}

pub fn load_local_device_id(conn: &Connection) -> AppResult<String> {
    let dev_id: Option<String> = conn
        .query_row(
            "SELECT value FROM meta WHERE key = 'device_id'",
            [],
            |r| r.get(0),
        )
        .optional()?;
    Ok(dev_id.unwrap_or_else(|| "00000000".to_string()))
}

pub fn load_local_device_name(conn: &Connection) -> AppResult<String> {
    let name_opt: Option<String> = conn
        .query_row(
            "SELECT value FROM meta WHERE key = 'device_name'",
            [],
            |r| r.get(0),
        )
        .optional()?;
    Ok(name_opt.unwrap_or_else(crate::db::default_device_name))
}

pub fn load_preferred_hub(conn: &Connection) -> AppResult<(Option<String>, Option<String>)> {
    let raw_hub: Option<String> = conn
        .query_row(
            "SELECT value FROM meta WHERE key = 'preferred_hub_node_id'",
            [],
            |r| r.get(0),
        )
        .optional()?;
    let hlc: Option<String> = conn
        .query_row(
            "SELECT value FROM meta WHERE key = 'preferred_hub_hlc'",
            [],
            |r| r.get(0),
        )
        .optional()?;
    let normalized_hub = raw_hub
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    Ok((normalized_hub, hlc))
}

pub fn set_local_preferred_hub(
    conn: &mut Connection,
    hub_node_id: Option<&str>,
) -> AppResult<(Option<String>, String)> {
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let mut clock = load_clock_from_tx(&tx)?;
    let new_hlc = clock.tick(system_now_ms())?.to_string();
    save_clock_to_tx(&tx, &clock)?;

    let clean_hub = hub_node_id
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let stored_val = clean_hub.clone().unwrap_or_default();

    tx.execute(
        "INSERT INTO meta (key, value) VALUES ('preferred_hub_node_id', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![stored_val],
    )?;
    tx.execute(
        "INSERT INTO meta (key, value) VALUES ('preferred_hub_hlc', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![new_hlc],
    )?;
    tx.commit()?;
    Ok((clean_hub, new_hlc))
}

pub fn apply_remote_preferred_hub(
    conn: &Connection,
    remote_hub: Option<&str>,
    remote_hlc: Option<&str>,
) -> AppResult<bool> {
    let Some(r_hlc) = remote_hlc.map(|s| s.trim()).filter(|s| !s.is_empty()) else {
        return Ok(false);
    };
    let (local_hub, local_hlc) = load_preferred_hub(conn)?;
    let should_apply = match local_hlc {
        None => true,
        Some(ref cur) => r_hlc > cur.as_str(),
    };
    if !should_apply {
        return Ok(false);
    }

    let clean_remote = remote_hub
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let changed = clean_remote != local_hub;
    let stored_val = clean_remote.unwrap_or_default();

    conn.execute(
        "INSERT INTO meta (key, value) VALUES ('preferred_hub_node_id', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![stored_val],
    )?;
    conn.execute(
        "INSERT INTO meta (key, value) VALUES ('preferred_hub_hlc', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![r_hlc],
    )?;
    Ok(changed)
}

pub fn load_known_peer_tickets(conn: &Connection) -> AppResult<Vec<NodeTicketAddr>> {
    let mut stmt = conn.prepare(
        "SELECT node_id, relay_url, direct_addrs_json
         FROM sync_peers
         WHERE (relay_url IS NOT NULL AND trim(relay_url) != '')
            OR (direct_addrs_json IS NOT NULL AND trim(direct_addrs_json) NOT IN ('', '[]'))
         ORDER BY last_seen_at DESC NULLS LAST
         LIMIT 64",
    )?;
    let rows = stmt.query_map([], |r| {
        let node_id: String = r.get(0)?;
        let relay_url: Option<String> = r.get(1)?;
        let addrs_json: Option<String> = r.get(2)?;
        let direct_addrs: Vec<String> = addrs_json
            .as_deref()
            .and_then(|s| serde_json::from_str(s).ok())
            .unwrap_or_default();
        Ok(NodeTicketAddr {
            node_id,
            relay_url,
            direct_addrs,
        })
    })?;
    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

pub fn load_known_peer_ids(conn: &Connection) -> AppResult<Vec<String>> {
    Ok(load_known_peer_tickets(conn)?
        .into_iter()
        .map(|t| t.node_id)
        .collect())
}

pub fn upsert_peer_ticket(
    conn: &Connection,
    ticket: &NodeTicketAddr,
    device_id: Option<&str>,
    device_name: Option<&str>,
    last_seen_at: Option<&str>,
) -> AppResult<()> {
    let trimmed_node = ticket.node_id.trim();
    if trimmed_node.is_empty() {
        return Ok(());
    }
    let direct_json = if ticket.direct_addrs.is_empty() {
        None
    } else {
        serde_json::to_string(&ticket.direct_addrs).ok()
    };

    conn.execute(
        "INSERT INTO sync_peers (node_id, device_id, last_seen_at, relay_url, direct_addrs_json, device_name)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)
         ON CONFLICT(node_id) DO UPDATE SET
            device_id = COALESCE(excluded.device_id, sync_peers.device_id),
            last_seen_at = COALESCE(excluded.last_seen_at, sync_peers.last_seen_at),
            relay_url = COALESCE(excluded.relay_url, sync_peers.relay_url),
            direct_addrs_json = COALESCE(excluded.direct_addrs_json, sync_peers.direct_addrs_json),
            device_name = COALESCE(excluded.device_name, sync_peers.device_name)",
        params![
            trimmed_node,
            device_id,
            last_seen_at,
            ticket.relay_url,
            direct_json,
            device_name,
        ],
    )?;
    Ok(())
}

pub fn record_authenticated_peer(
    conn: &Connection,
    remote_node_id: &str,
    remote_device_id: &str,
    remote_device_name: Option<&str>,
    remote_sender_addr: Option<&NodeTicketAddr>,
    gossip_peers: &[String],
    gossip_peer_addrs: &[NodeTicketAddr],
    local_node_id: &str,
) -> AppResult<()> {
    let now = now_iso8601();
    let primary_ticket = remote_sender_addr
        .cloned()
        .unwrap_or_else(|| NodeTicketAddr {
            node_id: remote_node_id.to_string(),
            relay_url: None,
            direct_addrs: Vec::new(),
        });
    upsert_peer_ticket(conn, &primary_ticket, Some(remote_device_id), remote_device_name, Some(&now))?;

    for addr in gossip_peer_addrs.iter().take(64) {
        let trimmed = addr.node_id.trim();
        if !trimmed.is_empty() && trimmed != local_node_id && trimmed != remote_node_id {
            upsert_peer_ticket(conn, addr, None, None, None)?;
        }
    }

    for peer_node_id in gossip_peers.iter().take(64) {
        let trimmed = peer_node_id.trim();
        if !trimmed.is_empty() && trimmed != local_node_id && trimmed != remote_node_id {
            let fallback = NodeTicketAddr {
                node_id: trimmed.to_string(),
                relay_url: None,
                direct_addrs: Vec::new(),
            };
            upsert_peer_ticket(conn, &fallback, None, None, None)?;
        }
    }
    Ok(())
}

pub fn compute_local_frontier(conn: &Connection) -> AppResult<HashMap<String, String>> {
    let mut stmt = conn.prepare(
        "SELECT device_id, MAX(hlc_timestamp)
         FROM crdt_oplog
         GROUP BY device_id",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
    })?;
    let mut map = HashMap::new();
    for r in rows {
        let (dev, max_hlc) = r?;
        map.insert(dev, max_hlc);
    }
    Ok(map)
}

pub fn load_max_oplog_hlc(conn: &Connection) -> AppResult<Option<String>> {
    let max_hlc: Option<String> = conn
        .query_row("SELECT MAX(hlc_timestamp) FROM crdt_oplog", [], |r| {
            r.get(0)
        })
        .optional()?
        .flatten();
    Ok(max_hlc)
}

pub fn collect_ops_since_hlc(
    conn: &Connection,
    since_hlc: Option<&str>,
) -> AppResult<Vec<CrdtOp>> {
    let mut out = Vec::new();
    match since_hlc.map(|s| s.trim()).filter(|s| !s.is_empty()) {
        Some(hlc_bound) => {
            let mut stmt = conn.prepare(
                "SELECT hlc_timestamp, table_name, row_id, payload_json, device_id
                 FROM crdt_oplog
                 WHERE hlc_timestamp > ?1
                 ORDER BY hlc_timestamp ASC",
            )?;
            let rows = stmt.query_map(params![hlc_bound], |r| {
                Ok(CrdtOp {
                    hlc_timestamp: r.get(0)?,
                    table_name: r.get(1)?,
                    row_id: r.get(2)?,
                    payload_json: r.get(3)?,
                    device_id: r.get(4)?,
                })
            })?;
            for r in rows {
                out.push(r?);
            }
        }
        None => {
            let mut stmt = conn.prepare(
                "SELECT hlc_timestamp, table_name, row_id, payload_json, device_id
                 FROM crdt_oplog
                 ORDER BY hlc_timestamp ASC",
            )?;
            let rows = stmt.query_map([], |r| {
                Ok(CrdtOp {
                    hlc_timestamp: r.get(0)?,
                    table_name: r.get(1)?,
                    row_id: r.get(2)?,
                    payload_json: r.get(3)?,
                    device_id: r.get(4)?,
                })
            })?;
            for r in rows {
                out.push(r?);
            }
        }
    }
    Ok(out)
}

pub fn collect_delta_ops_for_peer(
    conn: &Connection,
    peer_frontier: &HashMap<String, String>,
) -> AppResult<Vec<CrdtOp>> {
    if peer_frontier.is_empty() {
        return collect_ops_since_hlc(conn, None);
    }

    // Use idx_crdt_oplog_device_hlc (device_id, hlc_timestamp) per distinct device
    let mut dev_stmt = conn.prepare("SELECT DISTINCT device_id FROM crdt_oplog")?;
    let dev_rows = dev_stmt.query_map([], |r| r.get::<_, String>(0))?;
    let mut devices = Vec::new();
    for d in dev_rows {
        devices.push(d?);
    }

    let mut delta = Vec::new();
    let mut bounded_stmt = conn.prepare(
        "SELECT hlc_timestamp, table_name, row_id, payload_json, device_id
         FROM crdt_oplog
         WHERE device_id = ?1 AND hlc_timestamp > ?2
         ORDER BY hlc_timestamp ASC",
    )?;
    let mut full_dev_stmt = conn.prepare(
        "SELECT hlc_timestamp, table_name, row_id, payload_json, device_id
         FROM crdt_oplog
         WHERE device_id = ?1
         ORDER BY hlc_timestamp ASC",
    )?;

    for dev in devices {
        if let Some(peer_max) = peer_frontier.get(&dev) {
            let rows = bounded_stmt.query_map(params![dev, peer_max], |r| {
                Ok(CrdtOp {
                    hlc_timestamp: r.get(0)?,
                    table_name: r.get(1)?,
                    row_id: r.get(2)?,
                    payload_json: r.get(3)?,
                    device_id: r.get(4)?,
                })
            })?;
            for r in rows {
                delta.push(r?);
            }
        } else {
            let rows = full_dev_stmt.query_map(params![dev], |r| {
                Ok(CrdtOp {
                    hlc_timestamp: r.get(0)?,
                    table_name: r.get(1)?,
                    row_id: r.get(2)?,
                    payload_json: r.get(3)?,
                    device_id: r.get(4)?,
                })
            })?;
            for r in rows {
                delta.push(r?);
            }
        }
    }

    delta.sort_by(|a, b| a.hlc_timestamp.cmp(&b.hlc_timestamp));
    Ok(delta)
}

pub fn chunk_ops_into_batches(ops: Vec<CrdtOp>) -> Vec<DeltaBatchMessage> {
    if ops.is_empty() {
        return vec![DeltaBatchMessage {
            ops: Vec::new(),
            is_final: true,
        }];
    }

    let mut batches: Vec<DeltaBatchMessage> = Vec::new();
    let mut current_ops: Vec<CrdtOp> = Vec::new();
    let mut current_bytes: usize = 0;

    for op in ops {
        let op_est_bytes = op.hlc_timestamp.len()
            + op.table_name.len()
            + op.row_id.len()
            + op.payload_json.len()
            + op.device_id.len()
            + 32;

        let would_exceed_count = current_ops.len() >= MAX_DELTA_BATCH_OPS;
        let would_exceed_bytes =
            !current_ops.is_empty() && (current_bytes + op_est_bytes > MAX_DELTA_BATCH_BYTES);

        if would_exceed_count || would_exceed_bytes {
            batches.push(DeltaBatchMessage {
                ops: std::mem::take(&mut current_ops),
                is_final: false,
            });
            current_bytes = 0;
        }

        current_bytes += op_est_bytes;
        current_ops.push(op);
    }

    if !current_ops.is_empty() {
        batches.push(DeltaBatchMessage {
            ops: current_ops,
            is_final: true,
        });
    } else if let Some(last) = batches.last_mut() {
        last.is_final = true;
    }

    batches
}

async fn send_delta_stream(
    transport: &dyn Transport,
    session: &dyn PeerSession,
    enc_key: &[u8; 32],
    ops: Vec<CrdtOp>,
) -> AppResult<usize> {
    let total_ops = ops.len();
    let batches = chunk_ops_into_batches(ops);
    for batch in batches {
        let is_final = batch.is_final;
        let frame = encrypt_wire_payload(enc_key, &batch)?;
        transport.send_batch(session, &frame).await?;
        if is_final {
            break;
        }
    }
    Ok(total_ops)
}

async fn recv_and_apply_delta_stream(
    transport: &dyn Transport,
    session: &dyn PeerSession,
    enc_key: &[u8; 32],
    book_conn: &Arc<Mutex<Connection>>,
) -> AppResult<(usize, BTreeSet<String>)> {
    let mut total_applied = 0usize;
    let mut changed_tables = BTreeSet::new();

    loop {
        let frame = transport.recv_batch(session).await?;
        let batch: DeltaBatchMessage = decrypt_wire_payload(enc_key, &frame)?;

        if batch.ops.len() > MAX_DELTA_BATCH_OPS {
            return Err(AppError::Validation(format!(
                "Peer sent delta batch with {} ops (max {})",
                batch.ops.len(),
                MAX_DELTA_BATCH_OPS
            )));
        }

        if !batch.ops.is_empty() {
            let ops_to_merge = batch.ops;
            let conn_arc = Arc::clone(book_conn);
            let report: MergeReport = tokio::task::spawn_blocking(move || {
                let mut guard = conn_arc
                    .lock()
                    .map_err(|_| AppError::Internal("Book DB mutex poisoned".into()))?;
                merge_remote_oplog(&mut guard, &ops_to_merge, system_now_ms())
            })
            .await
            .map_err(|e| AppError::TaskJoin(e.to_string()))??;

            total_applied += report.applied_count;
            for t in report.tables {
                changed_tables.insert(t);
            }
        }

        if batch.is_final {
            break;
        }
    }

    Ok((total_applied, changed_tables))
}

/// Runs a complete initiator sync handshake and initial delta exchange over `Transport` (Section 6.3).
/// Leaves `session` open on success so it can transition into `run_live_session_loop`.
pub async fn run_initiator_sync(
    transport: &dyn Transport,
    session: &dyn PeerSession,
    book_id: &str,
    book_key: &[u8; 32],
    book_conn: Arc<Mutex<Connection>>,
) -> AppResult<SyncSessionOutcome> {
    let keys = DerivedBookKeys::derive(book_key);
    let local_ticket = transport.local_node_addr()?;
    let local_node_id = local_ticket.node_id.clone();
    let remote_node_id = session.remote_node_id().to_string();

    let (local_device_id, local_device_name, known_peer_addrs, local_frontier, pref_hub, pref_hub_hlc) = {
        let conn_arc = Arc::clone(&book_conn);
        tokio::task::spawn_blocking(move || -> AppResult<_> {
            let guard = conn_arc
                .lock()
                .map_err(|_| AppError::Internal("Book DB mutex poisoned".into()))?;
            let dev = load_local_device_id(&guard)?;
            let dev_name = load_local_device_name(&guard)?;
            let peers = load_known_peer_tickets(&guard)?;
            let frontier = compute_local_frontier(&guard)?;
            let (hub, hub_hlc) = load_preferred_hub(&guard)?;
            Ok((dev, dev_name, peers, frontier, hub, hub_hlc))
        })
        .await
        .map_err(|e| AppError::TaskJoin(e.to_string()))??
    };

    let known_peers: Vec<String> = known_peer_addrs.iter().map(|p| p.node_id.clone()).collect();

    // 1. Send Hello (includes initiator's full NodeTicketAddr and preferred hub metadata)
    let client_nonce = random_nonce_32();
    let hello = HelloMessage {
        book_topic_id: keys.topic_id,
        device_id: local_device_id.clone(),
        nonce: client_nonce,
        known_peers,
        sender_addr: Some(local_ticket),
        known_peer_addrs,
        preferred_hub_node_id: pref_hub,
        preferred_hub_hlc: pref_hub_hlc,
        device_name: Some(local_device_name),
    };
    let hello_bytes = postcard::to_allocvec(&hello)
        .map_err(|e| AppError::Crypto(format!("Hello encode error: {}", e)))?;
    transport.send_batch(session, &hello_bytes).await?;

    // 2. Receive Challenge & verify Responder's HMAC proof of auth_key
    let challenge_bytes = transport.recv_batch(session).await?;
    let challenge: ChallengeMessage = postcard::from_bytes(&challenge_bytes)
        .map_err(|_| AppError::Crypto("Invalid Challenge frame from responder".into()))?;

    if let Err(err) = verify_auth_mac(
        &keys.auth_key,
        ROLE_SERVER_AUTH,
        &keys.topic_id,
        &client_nonce,
        &challenge.server_nonce,
        &challenge.device_id,
        &challenge.server_mac,
    ) {
        session.close().await;
        return Err(err);
    }

    // 3. Send Initiator's HMAC proof
    let client_mac = compute_auth_mac(
        &keys.auth_key,
        ROLE_CLIENT_AUTH,
        &keys.topic_id,
        &client_nonce,
        &challenge.server_nonce,
        &local_device_id,
    )?;
    let proof = AuthProofMessage { client_mac };
    let proof_bytes = postcard::to_allocvec(&proof)
        .map_err(|e| AppError::Crypto(format!("AuthProof encode error: {}", e)))?;
    transport.send_batch(session, &proof_bytes).await?;

    // Record authenticated peer, gossip peers & remote preferred hub if newer
    let hub_updated = {
        let conn_arc = Arc::clone(&book_conn);
        let r_node = remote_node_id.clone();
        let r_dev = challenge.device_id.clone();
        let r_name = challenge.device_name.clone();
        let r_addr = challenge.sender_addr.clone();
        let gossip = challenge.known_peers.clone();
        let gossip_addrs = challenge.known_peer_addrs.clone();
        let r_hub = challenge.preferred_hub_node_id.clone();
        let r_hub_hlc = challenge.preferred_hub_hlc.clone();
        let l_node = local_node_id.clone();
        tokio::task::spawn_blocking(move || -> AppResult<bool> {
            let guard = conn_arc
                .lock()
                .map_err(|_| AppError::Internal("Book DB mutex poisoned".into()))?;
            record_authenticated_peer(
                &guard,
                &r_node,
                &r_dev,
                r_name.as_deref(),
                r_addr.as_ref(),
                &gossip,
                &gossip_addrs,
                &l_node,
            )?;
            apply_remote_preferred_hub(&guard, r_hub.as_deref(), r_hub_hlc.as_deref())
        })
        .await
        .map_err(|e| AppError::TaskJoin(e.to_string()))??
    };

    // 4. Frontier exchange (encrypted with enc_key)
    let local_frontier_msg = FrontierMessage {
        frontier: local_frontier,
    };
    let frontier_frame = encrypt_wire_payload(&keys.enc_key, &local_frontier_msg)?;
    transport.send_batch(session, &frontier_frame).await?;

    let remote_frontier_frame = transport.recv_batch(session).await?;
    let remote_frontier_msg: FrontierMessage =
        decrypt_wire_payload(&keys.enc_key, &remote_frontier_frame)?;

    // 5. Delta exchange: send our missing ops, then receive responder's missing ops
    let delta_to_send = {
        let conn_arc = Arc::clone(&book_conn);
        let peer_f = remote_frontier_msg.frontier;
        tokio::task::spawn_blocking(move || -> AppResult<Vec<CrdtOp>> {
            let guard = conn_arc
                .lock()
                .map_err(|_| AppError::Internal("Book DB mutex poisoned".into()))?;
            collect_delta_ops_for_peer(&guard, &peer_f)
        })
        .await
        .map_err(|e| AppError::TaskJoin(e.to_string()))??
    };

    let sent_ops = send_delta_stream(transport, session, &keys.enc_key, delta_to_send).await?;
    let (received_ops, changed_tables) =
        recv_and_apply_delta_stream(transport, session, &keys.enc_key, &book_conn).await?;

    // 6. Send final SyncAck so Responder knows initial delta exchange is complete
    let ack_frame = encrypt_wire_payload(&keys.enc_key, &SyncAckMessage { ok: true })?;
    transport.send_batch(session, &ack_frame).await?;

    Ok(SyncSessionOutcome {
        book_id: book_id.to_string(),
        remote_node_id,
        remote_device_id: challenge.device_id,
        sent_ops,
        received_ops,
        changed_tables: changed_tables.into_iter().collect(),
        hub_updated,
    })
}

/// Runs a complete responder sync handshake and initial delta exchange over `Transport` (Section 6.3).
/// Leaves `session` open on success so it can transition into `run_live_session_loop`.
pub async fn run_responder_sync<F>(
    transport: &dyn Transport,
    session: &dyn PeerSession,
    keystore: &dyn KeyStore,
    resolve_book_conn: F,
) -> AppResult<SyncSessionOutcome>
where
    F: FnOnce(String) -> crate::sync::transport::BoxFuture<'static, AppResult<Arc<Mutex<Connection>>>>,
{
    let local_ticket = transport.local_node_addr()?;
    let local_node_id = local_ticket.node_id.clone();
    let remote_node_id = session.remote_node_id().to_string();

    // 1. Receive Hello
    let hello_bytes = match transport.recv_batch(session).await {
        Ok(b) => b,
        Err(e) => {
            session.close().await;
            return Err(e);
        }
    };
    let hello: HelloMessage = match postcard::from_bytes(&hello_bytes) {
        Ok(h) => h,
        Err(_) => {
            session.close().await;
            return Err(AppError::Crypto("Malformed Hello message from peer".into()));
        }
    };

    // Lookup topic_id in KeyStore; if unknown, disconnect without leaking book existence
    let Some((book_id, book_key)) = keystore.find_book_by_topic_id(&hello.book_topic_id)? else {
        session.close().await;
        return Err(AppError::Crypto(
            "Rejected unknown book_topic_id during Hello".into(),
        ));
    };

    let keys = DerivedBookKeys::derive(&book_key);
    let book_conn = match resolve_book_conn(book_id.clone()).await {
        Ok(c) => c,
        Err(e) => {
            session.close().await;
            return Err(e);
        }
    };

    let (local_device_id, local_device_name, known_peer_addrs, local_frontier, pref_hub, pref_hub_hlc) = {
        let conn_arc = Arc::clone(&book_conn);
        tokio::task::spawn_blocking(move || -> AppResult<_> {
            let guard = conn_arc
                .lock()
                .map_err(|_| AppError::Internal("Book DB mutex poisoned".into()))?;
            let dev = load_local_device_id(&guard)?;
            let dev_name = load_local_device_name(&guard)?;
            let peers = load_known_peer_tickets(&guard)?;
            let frontier = compute_local_frontier(&guard)?;
            let (hub, hub_hlc) = load_preferred_hub(&guard)?;
            Ok((dev, dev_name, peers, frontier, hub, hub_hlc))
        })
        .await
        .map_err(|e| AppError::TaskJoin(e.to_string()))??
    };

    let known_peers: Vec<String> = known_peer_addrs.iter().map(|p| p.node_id.clone()).collect();

    // 2. Send Challenge with server HMAC
    let server_nonce = random_nonce_32();
    let server_mac = compute_auth_mac(
        &keys.auth_key,
        ROLE_SERVER_AUTH,
        &keys.topic_id,
        &hello.nonce,
        &server_nonce,
        &local_device_id,
    )?;

    let challenge = ChallengeMessage {
        server_nonce,
        device_id: local_device_id,
        server_mac,
        known_peers,
        sender_addr: Some(local_ticket),
        known_peer_addrs,
        preferred_hub_node_id: pref_hub,
        preferred_hub_hlc: pref_hub_hlc,
        device_name: Some(local_device_name),
    };
    let challenge_bytes = postcard::to_allocvec(&challenge)
        .map_err(|e| AppError::Crypto(format!("Challenge encode error: {}", e)))?;
    transport.send_batch(session, &challenge_bytes).await?;

    // 3. Receive Initiator's AuthProof & verify HMAC
    let proof_bytes = match transport.recv_batch(session).await {
        Ok(b) => b,
        Err(e) => {
            session.close().await;
            return Err(e);
        }
    };
    let proof: AuthProofMessage = match postcard::from_bytes(&proof_bytes) {
        Ok(p) => p,
        Err(_) => {
            session.close().await;
            return Err(AppError::Crypto("Malformed AuthProof message".into()));
        }
    };

    if let Err(err) = verify_auth_mac(
        &keys.auth_key,
        ROLE_CLIENT_AUTH,
        &keys.topic_id,
        &hello.nonce,
        &server_nonce,
        &hello.device_id,
        &proof.client_mac,
    ) {
        session.close().await;
        return Err(err);
    }

    // Record authenticated peer, gossip peers & remote preferred hub if newer
    let hub_updated = {
        let conn_arc = Arc::clone(&book_conn);
        let r_node = remote_node_id.clone();
        let r_dev = hello.device_id.clone();
        let r_name = hello.device_name.clone();
        let r_addr = hello.sender_addr.clone();
        let gossip = hello.known_peers.clone();
        let gossip_addrs = hello.known_peer_addrs.clone();
        let r_hub = hello.preferred_hub_node_id.clone();
        let r_hub_hlc = hello.preferred_hub_hlc.clone();
        let l_node = local_node_id.clone();
        tokio::task::spawn_blocking(move || -> AppResult<bool> {
            let guard = conn_arc
                .lock()
                .map_err(|_| AppError::Internal("Book DB mutex poisoned".into()))?;
            record_authenticated_peer(
                &guard,
                &r_node,
                &r_dev,
                r_name.as_deref(),
                r_addr.as_ref(),
                &gossip,
                &gossip_addrs,
                &l_node,
            )?;
            apply_remote_preferred_hub(&guard, r_hub.as_deref(), r_hub_hlc.as_deref())
        })
        .await
        .map_err(|e| AppError::TaskJoin(e.to_string()))??
    };

    // 4. Frontier exchange (encrypted with enc_key)
    let remote_frontier_frame = transport.recv_batch(session).await?;
    let remote_frontier_msg: FrontierMessage =
        decrypt_wire_payload(&keys.enc_key, &remote_frontier_frame)?;

    let local_frontier_msg = FrontierMessage {
        frontier: local_frontier,
    };
    let frontier_frame = encrypt_wire_payload(&keys.enc_key, &local_frontier_msg)?;
    transport.send_batch(session, &frontier_frame).await?;

    // 5. Delta exchange: receive initiator's ops first, then send our missing ops
    let (received_ops, changed_tables) =
        recv_and_apply_delta_stream(transport, session, &keys.enc_key, &book_conn).await?;

    let delta_to_send = {
        let conn_arc = Arc::clone(&book_conn);
        let peer_f = remote_frontier_msg.frontier;
        tokio::task::spawn_blocking(move || -> AppResult<Vec<CrdtOp>> {
            let guard = conn_arc
                .lock()
                .map_err(|_| AppError::Internal("Book DB mutex poisoned".into()))?;
            collect_delta_ops_for_peer(&guard, &peer_f)
        })
        .await
        .map_err(|e| AppError::TaskJoin(e.to_string()))??
    };

    let sent_ops = send_delta_stream(transport, session, &keys.enc_key, delta_to_send).await?;

    // 6. Wait for Initiator's SyncAck so initial reconciliation is complete
    let ack_bytes = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        transport.recv_batch(session),
    )
    .await
    .map_err(|_| {
        AppError::Io(std::io::Error::new(
            std::io::ErrorKind::TimedOut,
            "Timed out waiting for initiator SyncAck",
        ))
    })??;
    let _ack: SyncAckMessage = decrypt_wire_payload(&keys.enc_key, &ack_bytes)?;

    Ok(SyncSessionOutcome {
        book_id,
        remote_node_id,
        remote_device_id: hello.device_id,
        sent_ops,
        received_ops,
        changed_tables: changed_tables.into_iter().collect(),
        hub_updated,
    })
}

/// Encrypts and pushes a live batch of newly committed local ops over an active session (Section 6.3 step 4).
pub async fn send_live_push_batch(
    transport: &dyn Transport,
    session: &dyn PeerSession,
    book_key: &[u8; 32],
    ops: Vec<CrdtOp>,
) -> AppResult<()> {
    let keys = DerivedBookKeys::derive(book_key);
    for chunk in chunk_ops_into_batches(ops) {
        if chunk.ops.is_empty() {
            continue;
        }
        let live_frame = LiveStreamFrame::PushOps { ops: chunk.ops };
        let encrypted = encrypt_wire_payload(&keys.enc_key, &live_frame)?;
        transport.send_batch(session, &encrypted).await?;
    }
    Ok(())
}

/// Runs a persistent full-duplex live stream on an already-authenticated `PeerSession`.
/// - A dedicated writer task sends outgoing `LiveStreamFrame`s (`PushOps`, periodic `Heartbeat`, `Disconnect`).
/// - The reader loop continuously awaits incoming `LiveStreamFrame`s without ever cancelling `recv_batch`.
pub async fn run_live_session_loop<F>(
    transport: Arc<dyn Transport>,
    session: Arc<dyn PeerSession>,
    book_id: String,
    book_key: [u8; 32],
    book_conn: Arc<Mutex<Connection>>,
    mut outbound_rx: mpsc::Receiver<LiveStreamFrame>,
    mut stop_rx: watch::Receiver<bool>,
    on_event: F,
) -> AppResult<()>
where
    F: Fn(LiveSessionEvent) + Send + Sync + 'static,
{
    let keys = DerivedBookKeys::derive(&book_key);
    let enc_key = keys.enc_key;
    let remote_node_id = session.remote_node_id().to_string();

    let (internal_tx, mut internal_rx) = mpsc::channel::<LiveStreamFrame>(64);

    // Dedicated Writer Task: multiplexes caller's outbound_rx, internal catch-up frames, and heartbeats
    let writer_transport = Arc::clone(&transport);
    let writer_session = Arc::clone(&session);
    let writer_conn = Arc::clone(&book_conn);
    let mut writer_stop_rx = stop_rx.clone();

    let writer_handle = tokio::spawn(async move {
        let mut heartbeat_ticker = tokio::time::interval(std::time::Duration::from_secs(
            LIVE_HEARTBEAT_INTERVAL_SECS,
        ));
        // Skip immediate first tick since initial sync just completed
        heartbeat_ticker.tick().await;

        let send_encrypted_frame = |frame: &LiveStreamFrame| {
            let t = Arc::clone(&writer_transport);
            let s = Arc::clone(&writer_session);
            let encoded = encrypt_wire_payload(&enc_key, frame);
            async move {
                let bytes = encoded?;
                t.send_batch(s.as_ref(), &bytes).await
            }
        };

        loop {
            tokio::select! {
                _ = writer_stop_rx.changed() => {
                    if *writer_stop_rx.borrow() {
                        let _ = tokio::time::timeout(
                            std::time::Duration::from_millis(200),
                            send_encrypted_frame(&LiveStreamFrame::Disconnect),
                        ).await;
                        break;
                    }
                }
                maybe_ext = outbound_rx.recv() => {
                    let Some(frame) = maybe_ext else {
                        break;
                    };
                    match frame {
                        LiveStreamFrame::PushOps { ops } => {
                            for batch in chunk_ops_into_batches(ops) {
                                if batch.ops.is_empty() {
                                    continue;
                                }
                                let chunk_frame = LiveStreamFrame::PushOps { ops: batch.ops };
                                if send_encrypted_frame(&chunk_frame).await.is_err() {
                                    return;
                                }
                            }
                        }
                        other => {
                            if send_encrypted_frame(&other).await.is_err() {
                                return;
                            }
                        }
                    }
                }
                maybe_int = internal_rx.recv() => {
                    if let Some(frame) = maybe_int {
                        match frame {
                            LiveStreamFrame::PushOps { ops } => {
                                for batch in chunk_ops_into_batches(ops) {
                                    if batch.ops.is_empty() {
                                        continue;
                                    }
                                    let chunk_frame = LiveStreamFrame::PushOps { ops: batch.ops };
                                    if send_encrypted_frame(&chunk_frame).await.is_err() {
                                        return;
                                    }
                                }
                            }
                            other => {
                                if send_encrypted_frame(&other).await.is_err() {
                                    return;
                                }
                            }
                        }
                    }
                }
                _ = heartbeat_ticker.tick() => {
                    let conn_arc = Arc::clone(&writer_conn);
                    let hb_data = tokio::task::spawn_blocking(move || -> AppResult<_> {
                        let guard = conn_arc
                            .lock()
                            .map_err(|_| AppError::Internal("Book DB mutex poisoned".into()))?;
                        let frontier = compute_local_frontier(&guard)?;
                        let (hub, hub_hlc) = load_preferred_hub(&guard)?;
                        Ok((frontier, hub, hub_hlc))
                    }).await;

                    if let Ok(Ok((frontier, preferred_hub_node_id, preferred_hub_hlc))) = hb_data {
                        let hb_frame = LiveStreamFrame::Heartbeat {
                            frontier,
                            preferred_hub_node_id,
                            preferred_hub_hlc,
                        };
                        if send_encrypted_frame(&hb_frame).await.is_err() {
                            return;
                        }
                    }
                }
            }
        }
    });

    // Reader Loop: continuously reads frames without ever being cancelled by outgoing writes
    let mut loop_result: AppResult<()> = Ok(());
    loop {
        tokio::select! {
            _ = stop_rx.changed() => {
                if *stop_rx.borrow() {
                    break;
                }
            }
            recv_res = transport.recv_batch(session.as_ref()) => {
                let raw_bytes = match recv_res {
                    Ok(b) => b,
                    Err(_) => break,
                };
                let frame: LiveStreamFrame = match decrypt_wire_payload(&enc_key, &raw_bytes) {
                    Ok(f) => f,
                    Err(e) => {
                        loop_result = Err(e);
                        break;
                    }
                };

                match frame {
                    LiveStreamFrame::PushOps { ops } => {
                        if ops.len() > MAX_DELTA_BATCH_OPS {
                            loop_result = Err(AppError::Validation(format!(
                                "Live PushOps batch size {} exceeds max {}",
                                ops.len(),
                                MAX_DELTA_BATCH_OPS
                            )));
                            break;
                        }
                        if ops.is_empty() {
                            continue;
                        }
                        let ops_clone = ops.clone();
                        let conn_arc = Arc::clone(&book_conn);
                        let r_node = remote_node_id.clone();
                        let merge_res = tokio::task::spawn_blocking(move || -> AppResult<MergeReport> {
                            let mut guard = conn_arc
                                .lock()
                                .map_err(|_| AppError::Internal("Book DB mutex poisoned".into()))?;
                            let report = merge_remote_oplog(&mut guard, &ops_clone, system_now_ms())?;
                            let now = now_iso8601();
                            let _ = guard.execute(
                                "UPDATE sync_peers SET last_seen_at = ?1 WHERE node_id = ?2",
                                params![now, r_node],
                            );
                            Ok(report)
                        })
                        .await
                        .map_err(|e| AppError::TaskJoin(e.to_string()))?;

                        match merge_res {
                            Ok(report) => {
                                if report.applied_count > 0 {
                                    on_event(LiveSessionEvent::OpsApplied {
                                        book_id: book_id.clone(),
                                        from_node_id: remote_node_id.clone(),
                                        applied_ops: ops,
                                        changed_tables: report.tables,
                                    });
                                }
                            }
                            Err(e) => {
                                loop_result = Err(e);
                                break;
                            }
                        }
                    }
                    LiveStreamFrame::Heartbeat {
                        frontier,
                        preferred_hub_node_id,
                        preferred_hub_hlc,
                    } => {
                        let conn_arc = Arc::clone(&book_conn);
                        let r_node = remote_node_id.clone();
                        let hb_outcome = tokio::task::spawn_blocking(move || -> AppResult<(Vec<CrdtOp>, bool, Option<String>)> {
                            let guard = conn_arc
                                .lock()
                                .map_err(|_| AppError::Internal("Book DB mutex poisoned".into()))?;
                            let now = now_iso8601();
                            let _ = guard.execute(
                                "UPDATE sync_peers SET last_seen_at = ?1 WHERE node_id = ?2",
                                params![now, r_node],
                            );
                            let hub_changed = apply_remote_preferred_hub(
                                &guard,
                                preferred_hub_node_id.as_deref(),
                                preferred_hub_hlc.as_deref(),
                            )?;
                            let (cur_hub, _) = load_preferred_hub(&guard)?;
                            let missing = collect_delta_ops_for_peer(&guard, &frontier)?;
                            Ok((missing, hub_changed, cur_hub))
                        })
                        .await
                        .map_err(|e| AppError::TaskJoin(e.to_string()))?;

                        if let Ok((missing_ops, hub_changed, cur_hub)) = hb_outcome {
                            if hub_changed {
                                on_event(LiveSessionEvent::PreferredHubChanged {
                                    book_id: book_id.clone(),
                                    preferred_hub_node_id: cur_hub,
                                });
                            }
                            if !missing_ops.is_empty() {
                                let _ = internal_tx
                                    .send(LiveStreamFrame::PushOps { ops: missing_ops })
                                    .await;
                            }
                        }
                    }
                    LiveStreamFrame::Disconnect => {
                        break;
                    }
                }
            }
        }
    }

    writer_handle.abort();
    session.close().await;
    loop_result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::{
        add_transaction_in_conn, get_account_balances_in_conn, upsert_account_in_conn,
        upsert_category_in_conn, AddTransactionInput, UpsertAccountInput, UpsertCategoryInput,
    };
    use crate::db::open_in_memory_book;
    use crate::sync::crypto::BookMasterKey;
    use crate::sync::keystore::MemoryKeyStore;
    use crate::sync::transport::{InMemoryTransport, NodeTicketAddr};

    #[tokio::test]
    async fn test_full_bidirectional_sync_between_two_peers() {
        let book_id = "018f0000-0000-7000-8000-000000000777";
        let master_key = BookMasterKey::generate();

        let ks_a = Arc::new(MemoryKeyStore::new());
        let ks_b = Arc::new(MemoryKeyStore::new());
        ks_a.set_book_key(book_id, master_key.as_bytes()).unwrap();
        ks_b.set_book_key(book_id, master_key.as_bytes()).unwrap();

        let conn_a = Arc::new(Mutex::new(
            open_in_memory_book(book_id, "Buku Bersama").unwrap(),
        ));
        let conn_b = Arc::new(Mutex::new(
            open_in_memory_book(book_id, "Buku Bersama").unwrap(),
        ));

        // Peer A creates an account, category, and expense offline
        {
            let mut db_a = conn_a.lock().unwrap();
            let acc = upsert_account_in_conn(
                &mut db_a,
                UpsertAccountInput {
                    id: Some("acc-shared".into()),
                    name: "BCA Bersama".into(),
                    account_type: "BANK".into(),
                    initial_balance: 10_000_000,
                },
            )
            .unwrap();
            let cat = upsert_category_in_conn(
                &mut db_a,
                UpsertCategoryInput {
                    id: Some("cat-belanja".into()),
                    name: "Belanja Bulanan".into(),
                    kind: "EXPENSE".into(),
                },
            )
            .unwrap();
            add_transaction_in_conn(
                &mut db_a,
                AddTransactionInput {
                    id: None,
                    account_id: acc.id,
                    to_account_id: None,
                    category_id: Some(cat.id),
                    amount: -1_500_000,
                    tx_type: "EXPENSE".into(),
                    note: Some("Belanja dari Perangkat A".into()),
                    tx_date: "2026-06-10".into(),
                    link_id: None,
                },
            )
            .unwrap();
        }

        // Peer B creates an income offline on the same account
        {
            let mut db_b = conn_b.lock().unwrap();
            let cat_inc = upsert_category_in_conn(
                &mut db_b,
                UpsertCategoryInput {
                    id: Some("cat-bonus".into()),
                    name: "Bonus Proyek".into(),
                    kind: "INCOME".into(),
                },
            )
            .unwrap();
            add_transaction_in_conn(
                &mut db_b,
                AddTransactionInput {
                    id: None,
                    account_id: "acc-shared".into(),
                    to_account_id: None,
                    category_id: Some(cat_inc.id),
                    amount: 4_000_000,
                    tx_type: "INCOME".into(),
                    note: Some("Pemasukan dari Perangkat B".into()),
                    tx_date: "2026-06-11".into(),
                    link_id: None,
                },
            )
            .unwrap();
        }

        let mesh = InMemoryTransport::create_mesh(&["node-a", "node-b"]);
        let transport_a = Arc::clone(mesh.get("node-a").unwrap());
        let transport_b = Arc::clone(mesh.get("node-b").unwrap());

        let conn_b_for_server = Arc::clone(&conn_b);
        let ks_b_for_server = Arc::clone(&ks_b);
        let transport_b_for_server = Arc::clone(&transport_b);

        let responder_task = tokio::spawn(async move {
            let session = transport_b_for_server
                .accept()
                .await
                .unwrap()
                .expect("expected incoming session");
            run_responder_sync(
                transport_b_for_server.as_ref(),
                session.as_ref(),
                ks_b_for_server.as_ref(),
                move |_bid| {
                    let c = Arc::clone(&conn_b_for_server);
                    Box::pin(async move { Ok(c) })
                },
            )
            .await
            .unwrap()
        });

        let target_b = NodeTicketAddr {
            node_id: "node-b".into(),
            relay_url: None,
            direct_addrs: vec![],
        };
        let client_session = transport_a.connect(&target_b).await.unwrap();
        let initiator_outcome = run_initiator_sync(
            transport_a.as_ref(),
            client_session.as_ref(),
            book_id,
            master_key.as_bytes(),
            Arc::clone(&conn_a),
        )
        .await
        .unwrap();
        let responder_outcome = responder_task.await.unwrap();

        assert_eq!(initiator_outcome.sent_ops, 3);
        assert_eq!(initiator_outcome.received_ops, 2);
        assert_eq!(responder_outcome.received_ops, 3);
        assert_eq!(responder_outcome.sent_ops, 2);

        // Both databases must converge to exact balance: 10M - 1.5M + 4M = 12.5M
        let bal_a = get_account_balances_in_conn(&conn_a.lock().unwrap()).unwrap();
        let bal_b = get_account_balances_in_conn(&conn_b.lock().unwrap()).unwrap();
        assert_eq!(bal_a, bal_b);
        assert_eq!(bal_a[0].current_balance, 12_500_000);
    }

    #[tokio::test]
    async fn test_persistent_stream_instant_live_push() {
        let book_id = "018f0000-0000-7000-8000-000000000778";
        let master_key = BookMasterKey::generate();
        let key_bytes = *master_key.as_bytes();

        let ks_a = Arc::new(MemoryKeyStore::new());
        let ks_b = Arc::new(MemoryKeyStore::new());
        ks_a.set_book_key(book_id, &key_bytes).unwrap();
        ks_b.set_book_key(book_id, &key_bytes).unwrap();

        let conn_a = Arc::new(Mutex::new(
            open_in_memory_book(book_id, "Buku Live").unwrap(),
        ));
        let conn_b = Arc::new(Mutex::new(
            open_in_memory_book(book_id, "Buku Live").unwrap(),
        ));

        {
            let mut db_a = conn_a.lock().unwrap();
            upsert_account_in_conn(
                &mut db_a,
                UpsertAccountInput {
                    id: Some("acc-live".into()),
                    name: "Dompet Live".into(),
                    account_type: "EWALLET".into(),
                    initial_balance: 5_000_000,
                },
            )
            .unwrap();
            upsert_category_in_conn(
                &mut db_a,
                UpsertCategoryInput {
                    id: Some("cat-kopi".into()),
                    name: "Kopi".into(),
                    kind: "EXPENSE".into(),
                },
            )
            .unwrap();
        }

        let mesh = InMemoryTransport::create_mesh(&["node-a", "node-b"]);
        let transport_a: Arc<dyn Transport> = Arc::clone(mesh.get("node-a").unwrap()) as Arc<dyn Transport>;
        let transport_b: Arc<dyn Transport> = Arc::clone(mesh.get("node-b").unwrap()) as Arc<dyn Transport>;

        let (stop_tx, stop_rx) = watch::channel(false);
        let (push_a_tx, push_a_rx) = mpsc::channel(32);
        let (_push_b_tx, push_b_rx) = mpsc::channel(32);
        let (applied_notify_tx, mut applied_notify_rx) = mpsc::unbounded_channel();

        let conn_b_srv = Arc::clone(&conn_b);
        let ks_b_srv = Arc::clone(&ks_b);
        let t_b_srv = Arc::clone(&transport_b);
        let stop_b = stop_rx.clone();
        let bid_b = book_id.to_string();

        let responder_loop = tokio::spawn(async move {
            let sess: Arc<dyn PeerSession> = Arc::from(t_b_srv.accept().await.unwrap().unwrap());
            let conn_lookup = Arc::clone(&conn_b_srv);
            run_responder_sync(
                t_b_srv.as_ref(),
                sess.as_ref(),
                ks_b_srv.as_ref(),
                move |_| {
                    let c = Arc::clone(&conn_lookup);
                    Box::pin(async move { Ok(c) })
                },
            )
            .await
            .unwrap();

            run_live_session_loop(
                t_b_srv,
                sess,
                bid_b,
                key_bytes,
                conn_b_srv,
                push_b_rx,
                stop_b,
                move |ev| {
                    if let LiveSessionEvent::OpsApplied { changed_tables, .. } = ev {
                        let _ = applied_notify_tx.send(changed_tables);
                    }
                },
            )
            .await
            .unwrap();
        });

        let target_b = NodeTicketAddr {
            node_id: "node-b".into(),
            relay_url: None,
            direct_addrs: vec![],
        };
        let sess_a: Arc<dyn PeerSession> = Arc::from(transport_a.connect(&target_b).await.unwrap());
        run_initiator_sync(
            transport_a.as_ref(),
            sess_a.as_ref(),
            book_id,
            &key_bytes,
            Arc::clone(&conn_a),
        )
        .await
        .unwrap();

        let t_a_loop = Arc::clone(&transport_a);
        let conn_a_loop = Arc::clone(&conn_a);
        let stop_a = stop_rx.clone();
        let bid_a = book_id.to_string();
        let initiator_loop = tokio::spawn(async move {
            run_live_session_loop(
                t_a_loop,
                sess_a,
                bid_a,
                key_bytes,
                conn_a_loop,
                push_a_rx,
                stop_a,
                |_| {},
            )
            .await
            .unwrap();
        });

        // Now both peers are in persistent LiveStream mode!
        // Peer A records a new transaction and pushes it over the open session without reconnecting
        let new_ops = {
            let mut db_a = conn_a.lock().unwrap();
            let prev_hlc = load_max_oplog_hlc(&db_a).unwrap();
            add_transaction_in_conn(
                &mut db_a,
                AddTransactionInput {
                    id: None,
                    account_id: "acc-live".into(),
                    to_account_id: None,
                    category_id: Some("cat-kopi".into()),
                    amount: -35_000,
                    tx_type: "EXPENSE".into(),
                    note: Some("Kopi Susu Live Push".into()),
                    tx_date: "2026-06-12".into(),
                    link_id: None,
                },
            )
            .unwrap();
            collect_ops_since_hlc(&db_a, prev_hlc.as_deref()).unwrap()
        };
        assert_eq!(new_ops.len(), 1);

        push_a_tx
            .send(LiveStreamFrame::PushOps { ops: new_ops })
            .await
            .unwrap();

        let tables = tokio::time::timeout(
            std::time::Duration::from_millis(500),
            applied_notify_rx.recv(),
        )
        .await
        .expect("live push should arrive within 500ms")
        .unwrap();
        assert_eq!(tables, vec!["transactions".to_string()]);

        let bal_b = get_account_balances_in_conn(&conn_b.lock().unwrap()).unwrap();
        assert_eq!(bal_b[0].current_balance, 4_965_000);

        let _ = stop_tx.send(true);
        let _ = tokio::join!(initiator_loop, responder_loop);
    }

    #[tokio::test]
    async fn test_peer_with_wrong_auth_key_is_rejected() {
        let book_id = "018f0000-0000-7000-8000-000000000888";
        let key_legit = BookMasterKey::from_bytes([0x11u8; 32]);
        // Attacker shares the same topic_id knowledge (e.g. intercepted Hello) but has wrong auth_key
        let mut wrong_master = [0x22u8; 32];
        let legit_derived = DerivedBookKeys::derive(key_legit.as_bytes());

        let ks_responder = Arc::new(MemoryKeyStore::new());
        ks_responder
            .set_book_key(book_id, key_legit.as_bytes())
            .unwrap();

        let conn_responder = Arc::new(Mutex::new(
            open_in_memory_book(book_id, "Book").unwrap(),
        ));

        let mesh = InMemoryTransport::create_mesh(&["attacker", "responder"]);
        let t_attacker = Arc::clone(mesh.get("attacker").unwrap());
        let t_responder = Arc::clone(mesh.get("responder").unwrap());

        let responder_handle = {
            let t_resp = Arc::clone(&t_responder);
            let ks_resp = Arc::clone(&ks_responder);
            let c_resp = Arc::clone(&conn_responder);
            tokio::spawn(async move {
                let sess = t_resp.accept().await.unwrap().unwrap();
                run_responder_sync(t_resp.as_ref(), sess.as_ref(), ks_resp.as_ref(), move |_| {
                    let c = Arc::clone(&c_resp);
                    Box::pin(async move { Ok(c) })
                })
                .await
            })
        };

        let target = NodeTicketAddr {
            node_id: "responder".into(),
            relay_url: None,
            direct_addrs: vec![],
        };
        let attacker_sess = t_attacker.connect(&target).await.unwrap();

        // Attacker sends Hello with the valid topic_id, then sends forged AuthProof with wrong key
        let hello = HelloMessage {
            book_topic_id: legit_derived.topic_id,
            device_id: "bad00001".into(),
            nonce: [0x99u8; 32],
            known_peers: vec![],
            sender_addr: None,
            known_peer_addrs: vec![],
            preferred_hub_node_id: None,
            preferred_hub_hlc: None,
        };
        t_attacker
            .send_batch(
                attacker_sess.as_ref(),
                &postcard::to_allocvec(&hello).unwrap(),
            )
            .await
            .unwrap();

        let _challenge_bytes = t_attacker.recv_batch(attacker_sess.as_ref()).await.unwrap();

        // Forged client_mac using wrong_master
        wrong_master[0] ^= 0xFF;
        let bad_proof = AuthProofMessage {
            client_mac: wrong_master,
        };
        t_attacker
            .send_batch(
                attacker_sess.as_ref(),
                &postcard::to_allocvec(&bad_proof).unwrap(),
            )
            .await
            .unwrap();

        let resp_res = responder_handle.await.unwrap();
        assert!(resp_res.is_err());
    }
}
