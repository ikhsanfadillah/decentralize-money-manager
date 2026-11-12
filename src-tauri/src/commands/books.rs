use crate::db::{
    check_book_file_exists, init_book_db, new_uuid_v7, now_iso8601, validate_book_id, AppState,
    BookMetadata,
};
use crate::error::{AppError, AppResult};
use argon2::Argon2;
use chacha20poly1305::aead::{Aead, KeyInit};
use chacha20poly1305::{Key, XChaCha20Poly1305, XNonce};
use rand::RngCore;
use rusqlite::{params, Connection, OptionalExtension};
use std::fs;
use std::path::PathBuf;
use tauri::State;
use zeroize::Zeroize;
#[tauri::command]
pub async fn list_books(state: State<'_, AppState>) -> AppResult<Vec<BookMetadata>> {
    let app_dir = state.app_data_dir.clone();
    state
        .with_registry(move |conn| {
            let mut stmt = conn.prepare(
                "SELECT id, name, kind, created_at, last_opened_at
                 FROM books
                 ORDER BY last_opened_at DESC, created_at DESC",
            )?;
            let rows = stmt.query_map([], |r| {
                let id: String = r.get(0)?;
                let exists = check_book_file_exists(&app_dir, &id);
                Ok(BookMetadata {
                    id,
                    name: r.get(1)?,
                    kind: r.get(2)?,
                    created_at: r.get(3)?,
                    last_opened_at: r.get(4)?,
                    file_exists: exists,
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

pub async fn create_book_in_state(
    state: &AppState,
    name: String,
    kind: String,
) -> AppResult<BookMetadata> {
    let trimmed_name = name.trim().to_string();
    if trimmed_name.is_empty() {
        return Err(AppError::Validation("Book name cannot be empty".into()));
    }
    let trimmed_kind = if kind.trim().is_empty() {
        "PERSONAL".to_string()
    } else {
        kind.trim().to_uppercase()
    };

    let book_id = new_uuid_v7();
    let now = now_iso8601();
    let meta = BookMetadata {
        id: book_id.clone(),
        name: trimmed_name.clone(),
        kind: trimmed_kind.clone(),
        created_at: now.clone(),
        last_opened_at: now.clone(),
        file_exists: true,
    };

    let state_clone = state.clone();
    let meta_clone = meta.clone();

    tokio::task::spawn_blocking(move || -> AppResult<()> {
        {
            let reg_guard = state_clone
                .registry
                .lock()
                .map_err(|_| AppError::Internal("Registry mutex poisoned".into()))?;
            reg_guard.execute(
                "INSERT INTO books (id, name, kind, created_at, last_opened_at)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
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
        init_book_db(&mut conn, &meta_clone.id, &meta_clone.name, true)?;

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

    let _ = state.sync.start_book_sync(state, &meta.id).await;
    Ok(meta)
}

#[tauri::command]
pub async fn create_book(
    state: State<'_, AppState>,
    name: String,
    kind: String,
) -> AppResult<BookMetadata> {
    create_book_in_state(state.inner(), name, kind).await
}

#[tauri::command]
pub async fn rename_book(
    state: State<'_, AppState>,
    book_id: String,
    new_name: String,
) -> AppResult<BookMetadata> {
    let valid_id = validate_book_id(&book_id)?;
    let trimmed = new_name.trim().to_string();
    if trimmed.is_empty() {
        return Err(AppError::Validation("Book name cannot be empty".into()));
    }

    let trimmed_for_book = trimmed.clone();
    state
        .with_book(&valid_id, move |conn| {
            conn.execute(
                "INSERT INTO meta (key, value) VALUES ('book_name', ?1)
                 ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                params![trimmed_for_book],
            )?;
            Ok(())
        })
        .await?;

    let app_dir = state.app_data_dir.clone();
    state
        .with_registry(move |reg| {
            let changed = reg.execute(
                "UPDATE books SET name = ?1 WHERE id = ?2",
                params![trimmed, valid_id],
            )?;
            if changed == 0 {
                return Err(AppError::BookNotFound(valid_id));
            }
            let meta = reg.query_row(
                "SELECT id, name, kind, created_at, last_opened_at FROM books WHERE id = ?1",
                params![valid_id],
                |r| {
                    let id: String = r.get(0)?;
                    Ok(BookMetadata {
                        file_exists: check_book_file_exists(&app_dir, &id),
                        id,
                        name: r.get(1)?,
                        kind: r.get(2)?,
                        created_at: r.get(3)?,
                        last_opened_at: r.get(4)?,
                    })
                },
            )?;
            Ok(meta)
        })
        .await
}

#[tauri::command]
pub async fn delete_book(state: State<'_, AppState>, book_id: String) -> AppResult<()> {
    let valid_id = validate_book_id(&book_id)?;
    state.sync.stop_book_sync(&valid_id).await;
    let _ = state.sync.keystore.delete_book_key(&valid_id);
    state.close_book_conn(&valid_id).await?;

    let db_path = state.book_db_path(&valid_id);
    let valid_id_clone = valid_id.clone();

    state
        .with_registry(move |reg| {
            reg.execute("DELETE FROM books WHERE id = ?1", params![valid_id_clone])?;
            if db_path.exists() {
                let _ = fs::remove_file(&db_path);
            }
            let wal_path = PathBuf::from(format!("{}-wal", db_path.display()));
            let shm_path = PathBuf::from(format!("{}-shm", db_path.display()));
            if wal_path.exists() {
                let _ = fs::remove_file(wal_path);
            }
            if shm_path.exists() {
                let _ = fs::remove_file(shm_path);
            }
            Ok(())
        })
        .await
}

#[tauri::command]
pub async fn open_book(state: State<'_, AppState>, book_id: String) -> AppResult<BookMetadata> {
    let valid_id = validate_book_id(&book_id)?;
    let _ = state.get_or_open_book(&valid_id).await?;
    let _ = state.sync.start_book_sync(state.inner(), &valid_id).await;
    let app_dir = state.app_data_dir.clone();

    state
        .with_registry(move |reg| {
            let meta = reg
                .query_row(
                    "SELECT id, name, kind, created_at, last_opened_at FROM books WHERE id = ?1",
                    params![valid_id],
                    |r| {
                        let id: String = r.get(0)?;
                        Ok(BookMetadata {
                            file_exists: check_book_file_exists(&app_dir, &id),
                            id,
                            name: r.get(1)?,
                            kind: r.get(2)?,
                            created_at: r.get(3)?,
                            last_opened_at: r.get(4)?,
                        })
                    },
                )
                .optional()?
                .ok_or_else(|| AppError::BookNotFound(valid_id))?;
            Ok(meta)
        })
        .await
}

#[tauri::command]
pub async fn close_book(state: State<'_, AppState>, book_id: String) -> AppResult<()> {
    let valid_id = validate_book_id(&book_id)?;
    state.sync.stop_book_sync(&valid_id).await;
    state.close_book_conn(&valid_id).await
}

#[tauri::command]
pub async fn export_book_encrypted(
    state: State<'_, AppState>,
    book_id: String,
    mut passphrase: String,
    destination_path: String,
) -> AppResult<String> {
    if passphrase.len() < 8 {
        passphrase.zeroize();
        return Err(AppError::Validation(
            "Export passphrase must be at least 8 characters".into(),
        ));
    }

    let valid_id = validate_book_id(&book_id)?;
    let temp_snapshot = state
        .app_data_dir
        .join(format!("export-tmp-{}.sqlite", new_uuid_v7()));
    let temp_snapshot_clone = temp_snapshot.clone();

    state
        .with_book(&valid_id, move |conn| {
            let escaped = temp_snapshot_clone.to_string_lossy().replace('\'', "''");
            conn.execute_batch(&format!("VACUUM INTO '{}';", escaped))?;
            Ok(())
        })
        .await?;

    let dest = PathBuf::from(&destination_path);
    let result = tokio::task::spawn_blocking(move || -> AppResult<String> {
        let plain_bytes = fs::read(&temp_snapshot);
        let _ = fs::remove_file(&temp_snapshot);
        let mut plain = plain_bytes?;

        let mut salt = [0u8; 16];
        let mut nonce_bytes = [0u8; 24];
        rand::thread_rng().fill_bytes(&mut salt);
        rand::thread_rng().fill_bytes(&mut nonce_bytes);

        let mut derived_key = [0u8; 32];
        let argon_res =
            Argon2::default().hash_password_into(passphrase.as_bytes(), &salt, &mut derived_key);
        passphrase.zeroize();

        if let Err(e) = argon_res {
            derived_key.zeroize();
            plain.zeroize();
            return Err(AppError::Crypto(format!("Argon2id key derivation failed: {}", e)));
        }

        let cipher = XChaCha20Poly1305::new(Key::from_slice(&derived_key));
        let ciphertext_res = cipher.encrypt(XNonce::from_slice(&nonce_bytes), plain.as_ref());
        derived_key.zeroize();
        plain.zeroize();

        let ciphertext = ciphertext_res
            .map_err(|_| AppError::Crypto("Encryption of book snapshot failed".into()))?;

        // Format: [header version (8B) | salt (16B) | nonce (24B) | ciphertext]
        let mut output = Vec::with_capacity(8 + 16 + 24 + ciphertext.len());
        output.extend_from_slice(b"DMMEXP01");
        output.extend_from_slice(&salt);
        output.extend_from_slice(&nonce_bytes);
        output.extend_from_slice(&ciphertext);

        fs::write(&dest, &output)?;
        Ok(dest.to_string_lossy().to_string())
    })
    .await
    .map_err(|e| AppError::TaskJoin(e.to_string()))??;

    Ok(result)
}

