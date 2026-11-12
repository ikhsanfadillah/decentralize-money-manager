use super::models::{DeviceIdentity, PeerInfo, SyncStatusPayload, SyncTopologyInfo};
use crate::db::{init_book_db, now_iso8601, validate_book_id, AppState, BookMetadata};
use crate::error::{AppError, AppResult};
use rusqlite::{params, Connection, OptionalExtension};
use tauri::State;
use zeroize::Zeroize;
#[tauri::command]
pub async fn get_sync_status(
    state: State<'_, AppState>,
    book_id: String,
) -> AppResult<SyncStatusPayload> {
    let valid_id = validate_book_id(&book_id)?;
    let peers = state
        .with_book(&valid_id, |conn| {
            let count: i64 = conn.query_row(
                "SELECT COUNT(*) FROM sync_peers WHERE last_seen_at IS NOT NULL",
                [],
                |r| r.get(0),
            )?;
            Ok(count as usize)
        })
        .await?;

    let status = state.sync.get_status(&valid_id, peers).await;
    Ok(SyncStatusPayload {
        book_id: status.book_id,
        state: status.state,
        peers: status.peers,
        last_synced_at: status.last_synced_at,
    })
}

#[tauri::command]
pub async fn create_invite(
    state: State<'_, AppState>,
    book_id: String,
    ttl_secs: Option<i64>,
) -> AppResult<crate::sync::InviteResponse> {
    let valid_id = validate_book_id(&book_id)?;
    let book_name: String = {
        let valid_id_clone = valid_id.clone();
        state
            .with_registry(move |reg| {
                let name: Option<String> = reg
                    .query_row(
                        "SELECT name FROM books WHERE id = ?1",
                        params![valid_id_clone],
                        |r| r.get(0),
                    )
                    .optional()?;
                name.ok_or_else(|| AppError::BookNotFound(valid_id_clone))
            })
            .await?
    };

    let mut book_key = state.sync.keystore.get_or_create_book_key(&valid_id)?;
    let transport = state.sync.ensure_transport(state.inner()).await?;
    let node_addr = transport.local_node_addr()?;
    let ttl = ttl_secs.unwrap_or(crate::sync::DEFAULT_INVITE_TTL_SECS);

    let invite_res =
        crate::sync::build_invite_payload(&valid_id, &book_name, &book_key, node_addr, ttl);
    book_key.zeroize();
    let _ = state.sync.start_book_sync(state.inner(), &valid_id).await;
    invite_res
}

#[tauri::command]
pub async fn join_book_from_invite(
    state: State<'_, AppState>,
    mut invite_qr: String,
    kind: Option<String>,
) -> AppResult<BookMetadata> {
    let parse_res = crate::sync::parse_and_validate_invite(&invite_qr);
    invite_qr.zeroize();
    let (payload, mut book_key) = parse_res?;

    let valid_id = validate_book_id(&payload.book_id)?;
    let book_name = payload.book_name.trim().to_string();
    let book_kind = kind
        .map(|k| k.trim().to_uppercase())
        .filter(|k| !k.is_empty())
        .unwrap_or_else(|| "PERSONAL".to_string());
    let now = now_iso8601();

    // Save book_key to OS secure KeyStore (never in SQLite)
    let set_key_res = state.sync.keystore.set_book_key(&valid_id, &book_key);
    book_key.zeroize();
    set_key_res?;

    let meta = BookMetadata {
        id: valid_id.clone(),
        name: book_name.clone(),
        kind: book_kind.clone(),
        created_at: now.clone(),
        last_opened_at: now.clone(),
        file_exists: true,
    };

    let state_clone = state.inner().clone();
    let meta_clone = meta.clone();

    // Create empty book database with the invited book_id (seed_defaults = false so remote oplog populates cleanly)
    tokio::task::spawn_blocking(move || -> AppResult<()> {
        {
            let reg_guard = state_clone
                .registry
                .lock()
                .map_err(|_| AppError::Internal("Registry mutex poisoned".into()))?;
            reg_guard.execute(
                "INSERT INTO books (id, name, kind, created_at, last_opened_at)
                 VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(id) DO UPDATE SET
                    name = excluded.name,
                    last_opened_at = excluded.last_opened_at",
                params![
                    meta_clone.id,
                    meta_clone.name,
                    meta_clone.kind,
                    meta_clone.created_at,
                    meta_clone.last_opened_at
                ],
            )?;
        }

        let db_path = state_clone.book_db_path(&meta_clone.id);
        let mut conn = Connection::open(db_path)?;
        init_book_db(&mut conn, &meta_clone.id, &meta_clone.name, false)?;

        let mut pool_guard = state_clone
            .pool
            .write()
            .map_err(|_| AppError::Internal("Pool RwLock poisoned".into()))?;
        pool_guard.insert(
            meta_clone.id,
            std::sync::Arc::new(std::sync::Mutex::new(conn)),
        );
        Ok(())
    })
    .await
    .map_err(|e| AppError::TaskJoin(e.to_string()))??;

    // Await initial P2P sync with inviter (up to 10s timeout) so data is populated before navigating to dashboard
    let sync_engine = std::sync::Arc::clone(&state.sync);
    let state_for_sync = state.inner().clone();
    let bid_for_sync = valid_id.clone();
    let inviter_addr = payload.inviter_node_addr;
    let _ = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        sync_engine.sync_with_inviter_ticket(&state_for_sync, &bid_for_sync, &inviter_addr),
    )
    .await;

    Ok(meta)
}

#[tauri::command]
pub async fn set_app_foreground(
    state: State<'_, AppState>,
    is_foreground: bool,
) -> AppResult<()> {
    state.sync.set_foreground(state.inner(), is_foreground).await;
    Ok(())
}

#[tauri::command]
pub async fn list_peers(
    state: State<'_, AppState>,
    book_id: String,
) -> AppResult<Vec<PeerInfo>> {
    let valid_id = validate_book_id(&book_id)?;
    let online_ids = state.sync.online_peer_node_ids(&valid_id).await;

    state
        .with_book(&valid_id, move |conn| {
            let (pref_hub, _) = crate::sync::protocol::load_preferred_hub(conn)?;
            let mut stmt = conn.prepare(
                "SELECT node_id, device_id, last_seen_at, device_name, custom_alias FROM sync_peers ORDER BY last_seen_at DESC",
            )?;
            let rows = stmt.query_map([], |r| {
                let node_id: String = r.get(0)?;
                let device_id: Option<String> = r.get(1)?;
                let last_seen_at: Option<String> = r.get(2)?;
                let device_name: Option<String> = r.get(3)?;
                let custom_alias: Option<String> = r.get(4)?;
                let is_online = online_ids.contains(&node_id);
                let is_preferred_hub = pref_hub.as_deref() == Some(node_id.as_str());
                Ok(PeerInfo {
                    node_id,
                    device_id,
                    last_seen_at,
                    device_name,
                    custom_alias,
                    is_online,
                    is_preferred_hub,
                })
            })?;
            let mut out = Vec::new();
            for r in rows {
                out.push(r?);
            }
            Ok(out)
        })
        .await
}

#[tauri::command]
pub async fn get_device_identity(
    state: State<'_, AppState>,
    book_id: String,
) -> AppResult<DeviceIdentity> {
    let valid_id = validate_book_id(&book_id)?;
    state
        .with_book(&valid_id, |conn| {
            let device_id: String = conn
                .query_row(
                    "SELECT value FROM meta WHERE key = 'device_id'",
                    [],
                    |r| r.get(0),
                )
                .unwrap_or_else(|_| "00000000".to_string());
            let device_name: String = conn
                .query_row(
                    "SELECT value FROM meta WHERE key = 'device_name'",
                    [],
                    |r| r.get(0),
                )
                .unwrap_or_else(|_| crate::db::default_device_name());
            Ok(DeviceIdentity {
                device_id,
                device_name,
            })
        })
        .await
}

#[tauri::command]
pub async fn set_device_name(
    state: State<'_, AppState>,
    book_id: String,
    device_name: String,
) -> AppResult<DeviceIdentity> {
    let valid_id = validate_book_id(&book_id)?;
    let trimmed = device_name.trim();
    if trimmed.is_empty() {
        return Err(AppError::Validation("Nama perangkat tidak boleh kosong".into()));
    }
    if trimmed.chars().count() > 64 {
        return Err(AppError::Validation("Nama perangkat maksimal 64 karakter".into()));
    }
    let sanitized_name = trimmed.to_string();
    state
        .with_book(&valid_id, move |conn| {
            conn.execute(
                "INSERT INTO meta (key, value) VALUES ('device_name', ?1)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![sanitized_name],
            )?;
            let device_id: String = conn
                .query_row(
                    "SELECT value FROM meta WHERE key = 'device_id'",
                    [],
                    |r| r.get(0),
                )
                .unwrap_or_else(|_| "00000000".to_string());
            Ok(DeviceIdentity {
                device_id,
                device_name: sanitized_name,
            })
        })
        .await
}

#[tauri::command]
pub async fn set_peer_custom_alias(
    state: State<'_, AppState>,
    book_id: String,
    node_id: String,
    custom_alias: Option<String>,
) -> AppResult<()> {
    let valid_id = validate_book_id(&book_id)?;
    let trimmed_node = node_id.trim().to_string();
    let sanitized_alias = match custom_alias {
        Some(a) => {
            let t = a.trim();
            if t.is_empty() {
                None
            } else if t.chars().count() > 64 {
                return Err(AppError::Validation("Nama alias maksimal 64 karakter".into()));
            } else {
                Some(t.to_string())
            }
        }
        None => None,
    };
    state
        .with_book(&valid_id, move |conn| {
            conn.execute(
                "UPDATE sync_peers SET custom_alias = ?1 WHERE node_id = ?2",
                params![sanitized_alias, trimmed_node],
            )?;
            Ok(())
        })
        .await
}

#[tauri::command]
pub async fn get_sync_topology(
    state: State<'_, AppState>,
    book_id: String,
) -> AppResult<SyncTopologyInfo> {
    let valid_id = validate_book_id(&book_id)?;
    let local_node_id = state.sync.get_local_node_id(state.inner()).await;
    let active_streams = state.sync.active_peer_count(&valid_id).await;
    let preferred_hub_node_id = state
        .with_book(&valid_id, |conn| {
            let (hub, _) = crate::sync::protocol::load_preferred_hub(conn)?;
            Ok(hub)
        })
        .await?;

    Ok(SyncTopologyInfo {
        book_id: valid_id,
        local_node_id,
        preferred_hub_node_id,
        active_streams,
    })
}

#[tauri::command]
pub async fn set_preferred_hub(
    state: State<'_, AppState>,
    book_id: String,
    hub_node_id: Option<String>,
) -> AppResult<SyncTopologyInfo> {
    let valid_id = validate_book_id(&book_id)?;
    let updated_hub = state
        .sync
        .set_preferred_hub(state.inner(), &valid_id, hub_node_id)
        .await?;
    let local_node_id = state.sync.get_local_node_id(state.inner()).await;
    let active_streams = state.sync.active_peer_count(&valid_id).await;

    Ok(SyncTopologyInfo {
        book_id: valid_id,
        local_node_id,
        preferred_hub_node_id: updated_hub,
        active_streams,
    })
}

#[tauri::command]
pub async fn trigger_manual_sync(
    state: State<'_, AppState>,
    book_id: String,
) -> AppResult<()> {
    let valid_id = validate_book_id(&book_id)?;
    state.sync.trigger_sync_now(state.inner(), &valid_id);
    Ok(())
}

