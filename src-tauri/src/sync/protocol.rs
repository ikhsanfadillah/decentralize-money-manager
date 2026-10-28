use crate::crdt::{merge_remote_oplog, CrdtOp, MergeReport};
use crate::db::now_iso8601;
use crate::error::{AppError, AppResult};
use crate::hlc::system_now_ms;
use crate::sync::crypto::{
    compute_auth_mac, decrypt_wire_payload, encrypt_wire_payload, random_nonce_32, verify_auth_mac,
    DerivedBookKeys, ROLE_CLIENT_AUTH, ROLE_SERVER_AUTH,
};
use crate::sync::keystore::KeyStore;
use crate::sync::transport::{NodeTicketAddr, PeerSession, Transport};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, HashMap};
use std::sync::{Arc, Mutex};

pub const MAX_DELTA_BATCH_OPS: usize = 500;
pub const MAX_DELTA_BATCH_BYTES: usize = 256 * 1024; // 256 KiB per batch (Section 6.3)

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

#[derive(Debug, Clone, Default)]
pub struct SyncSessionOutcome {
    pub book_id: String,
    pub remote_node_id: String,
    pub remote_device_id: String,
    pub sent_ops: usize,
    pub received_ops: usize,
    pub changed_tables: Vec<String>,
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
        "INSERT INTO sync_peers (node_id, device_id, last_seen_at, relay_url, direct_addrs_json)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(node_id) DO UPDATE SET
            device_id = COALESCE(excluded.device_id, sync_peers.device_id),
            last_seen_at = COALESCE(excluded.last_seen_at, sync_peers.last_seen_at),
            relay_url = COALESCE(excluded.relay_url, sync_peers.relay_url),
            direct_addrs_json = COALESCE(excluded.direct_addrs_json, sync_peers.direct_addrs_json)",
        params![
            trimmed_node,
            device_id,
            last_seen_at,
            ticket.relay_url,
            direct_json
        ],
    )?;
    Ok(())
}

pub fn record_authenticated_peer(
    conn: &Connection,
    remote_node_id: &str,
    remote_device_id: &str,
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
    upsert_peer_ticket(conn, &primary_ticket, Some(remote_device_id), Some(&now))?;

    for addr in gossip_peer_addrs.iter().take(64) {
        let trimmed = addr.node_id.trim();
        if !trimmed.is_empty() && trimmed != local_node_id && trimmed != remote_node_id {
            upsert_peer_ticket(conn, addr, None, None)?;
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
            upsert_peer_ticket(conn, &fallback, None, None)?;
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

pub fn collect_delta_ops_for_peer(
    conn: &Connection,
    peer_frontier: &HashMap<String, String>,
) -> AppResult<Vec<CrdtOp>> {
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

    let mut delta = Vec::new();
    for r in rows {
        let op = r?;
        let needed = match peer_frontier.get(&op.device_id) {
            None => true,
            Some(peer_max) => op.hlc_timestamp.as_str() > peer_max.as_str(),
        };
        if needed {
            delta.push(op);
        }
    }
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
    session: &mut dyn PeerSession,
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
    session: &mut dyn PeerSession,
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

/// Runs a complete initiator sync session over `Transport` (Section 6.3).
pub async fn run_initiator_sync(
    transport: &dyn Transport,
    session: &mut dyn PeerSession,
    book_id: &str,
    book_key: &[u8; 32],
    book_conn: Arc<Mutex<Connection>>,
) -> AppResult<SyncSessionOutcome> {
    let keys = DerivedBookKeys::derive(book_key);
    let local_ticket = transport.local_node_addr()?;
    let local_node_id = local_ticket.node_id.clone();
    let remote_node_id = session.remote_node_id().to_string();

    let (local_device_id, known_peer_addrs, local_frontier) = {
        let conn_arc = Arc::clone(&book_conn);
        tokio::task::spawn_blocking(move || -> AppResult<_> {
            let guard = conn_arc
                .lock()
                .map_err(|_| AppError::Internal("Book DB mutex poisoned".into()))?;
            let dev = load_local_device_id(&guard)?;
            let peers = load_known_peer_tickets(&guard)?;
            let frontier = compute_local_frontier(&guard)?;
            Ok((dev, peers, frontier))
        })
        .await
        .map_err(|e| AppError::TaskJoin(e.to_string()))??
    };

    let known_peers: Vec<String> = known_peer_addrs.iter().map(|p| p.node_id.clone()).collect();

    // 1. Send Hello (includes initiator's full NodeTicketAddr so responder can dial back anytime)
    let client_nonce = random_nonce_32();
    let hello = HelloMessage {
        book_topic_id: keys.topic_id,
        device_id: local_device_id.clone(),
        nonce: client_nonce,
        known_peers,
        sender_addr: Some(local_ticket),
        known_peer_addrs,
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

    // Record authenticated peer & gossip peers (including full NodeTicketAddr)
    {
        let conn_arc = Arc::clone(&book_conn);
        let r_node = remote_node_id.clone();
        let r_dev = challenge.device_id.clone();
        let r_addr = challenge.sender_addr.clone();
        let gossip = challenge.known_peers.clone();
        let gossip_addrs = challenge.known_peer_addrs.clone();
        let l_node = local_node_id.clone();
        tokio::task::spawn_blocking(move || -> AppResult<()> {
            let guard = conn_arc
                .lock()
                .map_err(|_| AppError::Internal("Book DB mutex poisoned".into()))?;
            record_authenticated_peer(
                &guard,
                &r_node,
                &r_dev,
                r_addr.as_ref(),
                &gossip,
                &gossip_addrs,
                &l_node,
            )
        })
        .await
        .map_err(|e| AppError::TaskJoin(e.to_string()))??;
    }

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

    // 6. Send final SyncAck so Responder knows all delta batches have been received & committed before closing QUIC stream
    let ack_frame = encrypt_wire_payload(&keys.enc_key, &SyncAckMessage { ok: true })?;
    let _ = transport.send_batch(session, &ack_frame).await;

    Ok(SyncSessionOutcome {
        book_id: book_id.to_string(),
        remote_node_id,
        remote_device_id: challenge.device_id,
        sent_ops,
        received_ops,
        changed_tables: changed_tables.into_iter().collect(),
    })
}

/// Runs a complete responder sync session over `Transport` (Section 6.3).
pub async fn run_responder_sync<F>(
    transport: &dyn Transport,
    session: &mut dyn PeerSession,
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

    let (local_device_id, known_peer_addrs, local_frontier) = {
        let conn_arc = Arc::clone(&book_conn);
        tokio::task::spawn_blocking(move || -> AppResult<_> {
            let guard = conn_arc
                .lock()
                .map_err(|_| AppError::Internal("Book DB mutex poisoned".into()))?;
            let dev = load_local_device_id(&guard)?;
            let peers = load_known_peer_tickets(&guard)?;
            let frontier = compute_local_frontier(&guard)?;
            Ok((dev, peers, frontier))
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

    // Record authenticated peer & gossip peers (including full NodeTicketAddr)
    {
        let conn_arc = Arc::clone(&book_conn);
        let r_node = remote_node_id.clone();
        let r_dev = hello.device_id.clone();
        let r_addr = hello.sender_addr.clone();
        let gossip = hello.known_peers.clone();
        let gossip_addrs = hello.known_peer_addrs.clone();
        let l_node = local_node_id.clone();
        tokio::task::spawn_blocking(move || -> AppResult<()> {
            let guard = conn_arc
                .lock()
                .map_err(|_| AppError::Internal("Book DB mutex poisoned".into()))?;
            record_authenticated_peer(
                &guard,
                &r_node,
                &r_dev,
                r_addr.as_ref(),
                &gossip,
                &gossip_addrs,
                &l_node,
            )
        })
        .await
        .map_err(|e| AppError::TaskJoin(e.to_string()))??;
    }

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

    // 6. Wait for Initiator's SyncAck before closing session so QUIC stream is never truncated early
    let _ = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        transport.recv_batch(session),
    )
    .await;

    Ok(SyncSessionOutcome {
        book_id,
        remote_node_id,
        remote_device_id: hello.device_id,
        sent_ops,
        received_ops,
        changed_tables: changed_tables.into_iter().collect(),
    })
}

/// Encrypts and pushes a live batch of newly committed local ops over an active session (Section 6.3 step 4).
pub async fn send_live_push_batch(
    transport: &dyn Transport,
    session: &mut dyn PeerSession,
    book_key: &[u8; 32],
    ops: Vec<CrdtOp>,
) -> AppResult<()> {
    let keys = DerivedBookKeys::derive(book_key);
    send_delta_stream(transport, session, &keys.enc_key, ops).await?;
    Ok(())
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
            let mut session = transport_b_for_server
                .accept()
                .await
                .unwrap()
                .expect("expected incoming session");
            run_responder_sync(
                transport_b_for_server.as_ref(),
                session.as_mut(),
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
        let mut client_session = transport_a.connect(&target_b).await.unwrap();
        let initiator_outcome = run_initiator_sync(
            transport_a.as_ref(),
            client_session.as_mut(),
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
                let mut sess = t_resp.accept().await.unwrap().unwrap();
                run_responder_sync(t_resp.as_ref(), sess.as_mut(), ks_resp.as_ref(), move |_| {
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
        let mut attacker_sess = t_attacker.connect(&target).await.unwrap();

        // Attacker sends Hello with the valid topic_id, then sends forged AuthProof with wrong key
        let hello = HelloMessage {
            book_topic_id: legit_derived.topic_id,
            device_id: "bad00001".into(),
            nonce: [0x99u8; 32],
            known_peers: vec![],
            sender_addr: None,
            known_peer_addrs: vec![],
        };
        t_attacker
            .send_batch(
                attacker_sess.as_mut(),
                &postcard::to_allocvec(&hello).unwrap(),
            )
            .await
            .unwrap();

        let _challenge_bytes = t_attacker.recv_batch(attacker_sess.as_mut()).await.unwrap();

        // Forged client_mac using wrong_master
        wrong_master[0] ^= 0xFF;
        let bad_proof = AuthProofMessage {
            client_mac: wrong_master,
        };
        t_attacker
            .send_batch(
                attacker_sess.as_mut(),
                &postcard::to_allocvec(&bad_proof).unwrap(),
            )
            .await
            .unwrap();

        let resp_res = responder_handle.await.unwrap();
        assert!(resp_res.is_err());
    }
}
