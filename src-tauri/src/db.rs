use crate::error::{AppError, AppResult};
use crate::hlc::{load_clock_from_tx, save_clock_to_tx, system_now_ms, HlcTimestamp};
use rand::Rng;
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, RwLock};
use unicode_normalization::UnicodeNormalization;
use uuid::Uuid;

pub const SCHEMA_VERSION: i32 = 1;

pub const APP_NAMESPACE: Uuid = Uuid::from_bytes([
    0x6d, 0x6f, 0x6e, 0x65, 0x79, 0x2d, 0x6d, 0x67, 0x72, 0x2d, 0x76, 0x31, 0x2d, 0x70, 0x32, 0x70,
]);

pub const DEFAULT_CASH_ACCOUNT_ID: &str = "00000000-0000-7000-8000-000000000001";
pub const SYSTEM_CATEGORY_PRIVE_ID: &str = "00000000-0000-7000-8000-000000000010";
pub const SYSTEM_CATEGORY_PRIVE_NAME: &str = "Prive/Penarikan";
pub const SYSTEM_CATEGORY_MODAL_ID: &str = "00000000-0000-7000-8000-000000000011";
pub const SYSTEM_CATEGORY_MODAL_NAME: &str = "Bagi Hasil/Injeksi Modal";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BookMetadata {
    pub id: String,
    pub name: String,
    pub kind: String,
    pub created_at: String,
    pub last_opened_at: String,
    pub file_exists: bool,
}

pub fn new_uuid_v7() -> String {
    Uuid::now_v7().to_string()
}

pub fn deterministic_budget_id(category_id: Option<&str>, period: &str) -> String {
    let cat_part = category_id.unwrap_or("ALL");
    let name = format!("{}:{}", cat_part, period);
    Uuid::new_v5(&APP_NAMESPACE, name.as_bytes()).to_string()
}

pub fn validate_book_id(book_id: &str) -> AppResult<String> {
    let parsed = Uuid::parse_str(book_id.trim())
        .map_err(|_| AppError::InvalidBookId(book_id.to_string()))?;
    Ok(parsed.hyphenated().to_string())
}

pub fn normalize_category_name(name: &str) -> String {
    name.nfkc()
        .flat_map(|c| c.to_lowercase())
        .filter(|c| c.is_alphanumeric())
        .collect()
}

pub fn generate_device_id() -> String {
    let mut rng = rand::thread_rng();
    let bytes: [u8; 4] = rng.gen();
    hex::encode(bytes)
}

pub fn now_iso8601() -> String {
    chrono::Utc::now().to_rfc3339()
}

pub fn configure_pragmas(conn: &Connection) -> AppResult<()> {
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA foreign_keys = OFF;
         PRAGMA synchronous = NORMAL;
         PRAGMA busy_timeout = 5000;",
    )?;
    Ok(())
}

pub fn init_registry_db(conn: &Connection) -> AppResult<()> {
    configure_pragmas(conn)?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS books (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            kind TEXT NOT NULL,
            created_at TEXT NOT NULL,
            last_opened_at TEXT NOT NULL
        );",
    )?;
    Ok(())
}

pub fn init_book_db(
    conn: &mut Connection,
    book_id: &str,
    book_name: &str,
    seed_defaults: bool,
) -> AppResult<()> {
    configure_pragmas(conn)?;

    let current_version: i32 = conn.query_row("PRAGMA user_version", [], |row| row.get(0))?;

    if current_version < 1 {
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
        tx.execute_batch(
            "CREATE TABLE IF NOT EXISTS meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS accounts (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                account_type TEXT NOT NULL,
                initial_balance INTEGER NOT NULL DEFAULT 0,
                merged_into_id TEXT,
                is_deleted INTEGER NOT NULL DEFAULT 0,
                updated_hlc TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS categories (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                normalized_name TEXT NOT NULL,
                kind TEXT NOT NULL,
                merged_into_id TEXT,
                is_deleted INTEGER NOT NULL DEFAULT 0,
                updated_hlc TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS transactions (
                id TEXT PRIMARY KEY,
                account_id TEXT NOT NULL,
                to_account_id TEXT,
                category_id TEXT,
                amount INTEGER NOT NULL,
                tx_type TEXT NOT NULL,
                note TEXT,
                tx_date TEXT NOT NULL,
                created_by_device TEXT NOT NULL,
                link_id TEXT,
                is_deleted INTEGER NOT NULL DEFAULT 0,
                updated_hlc TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS budgets (
                id TEXT PRIMARY KEY,
                category_id TEXT,
                period TEXT NOT NULL,
                amount_limit INTEGER NOT NULL,
                alert_threshold_pct INTEGER NOT NULL DEFAULT 80,
                is_deleted INTEGER NOT NULL DEFAULT 0,
                updated_hlc TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS crdt_oplog (
                hlc_timestamp TEXT PRIMARY KEY,
                table_name TEXT NOT NULL,
                row_id TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                device_id TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS sync_peers (
                node_id TEXT PRIMARY KEY,
                device_id TEXT,
                last_seen_at TEXT,
                relay_url TEXT,
                direct_addrs_json TEXT
            );

            CREATE INDEX IF NOT EXISTS idx_transactions_tx_date ON transactions(tx_date DESC);
            CREATE INDEX IF NOT EXISTS idx_transactions_account_id ON transactions(account_id);
            CREATE INDEX IF NOT EXISTS idx_transactions_category_id ON transactions(category_id);
            CREATE INDEX IF NOT EXISTS idx_crdt_oplog_device_hlc ON crdt_oplog(device_id, hlc_timestamp);
            CREATE INDEX IF NOT EXISTS idx_categories_kind_norm ON categories(kind, normalized_name);
            CREATE INDEX IF NOT EXISTS idx_budgets_cat_period ON budgets(category_id, period);
            CREATE INDEX IF NOT EXISTS idx_transactions_type_date ON transactions(tx_type, tx_date);

            PRAGMA user_version = 1;",
        )?;
        tx.commit()?;
    }

    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    // Ensure existing v1 databases also have relay_url and direct_addrs_json on sync_peers
    let _ = tx.execute("ALTER TABLE sync_peers ADD COLUMN relay_url TEXT", []);
    let _ = tx.execute("ALTER TABLE sync_peers ADD COLUMN direct_addrs_json TEXT", []);
    tx.execute(
        "INSERT OR IGNORE INTO meta (key, value) VALUES ('book_id', ?1)",
        params![book_id],
    )?;
    tx.execute(
        "INSERT INTO meta (key, value) VALUES ('book_name', ?1)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![book_name],
    )?;

    let existing_device_id: Option<String> = tx
        .query_row(
            "SELECT value FROM meta WHERE key = 'device_id'",
            [],
            |row| row.get(0),
        )
        .optional()?;

    let device_id = match existing_device_id {
        Some(id) => id,
        None => {
            let generated = generate_device_id();
            tx.execute(
                "INSERT INTO meta (key, value) VALUES ('device_id', ?1)",
                params![generated],
            )?;
            generated
        }
    };

    let existing_hlc: Option<String> = tx
        .query_row("SELECT value FROM meta WHERE key = 'hlc_last'", [], |row| {
            row.get(0)
        })
        .optional()?;

    if existing_hlc.is_none() {
        let initial_hlc = HlcTimestamp::zero(&device_id)?;
        tx.execute(
            "INSERT INTO meta (key, value) VALUES ('hlc_last', ?1)",
            params![initial_hlc.to_string()],
        )?;
    }

    if seed_defaults {
        let acc_count: i64 =
            tx.query_row("SELECT COUNT(*) FROM accounts", [], |row| row.get(0))?;
        if acc_count == 0 {
            let mut clock = load_clock_from_tx(&tx)?;
            let now_ms = system_now_ms();
            let hlc_acc = clock.tick(now_ms)?.to_string();

            let cash_row = crate::crdt::AccountRow {
                id: DEFAULT_CASH_ACCOUNT_ID.to_string(),
                name: "Kas Tunai".to_string(),
                account_type: "CASH".to_string(),
                initial_balance: 0,
                merged_into_id: None,
                is_deleted: 0,
                updated_hlc: hlc_acc.clone(),
            };
            crate::crdt::write_local_account_op(&tx, &cash_row, &device_id)?;

            save_clock_to_tx(&tx, &clock)?;
        }
    }

    tx.commit()?;
    Ok(())
}

#[derive(Clone)]
pub struct AppState {
    pub app_data_dir: PathBuf,
    pub registry: Arc<Mutex<Connection>>,
    pub pool: Arc<RwLock<HashMap<String, Arc<Mutex<Connection>>>>>,
    pub sync: Arc<crate::sync::SyncEngine>,
}

impl AppState {
    pub fn new(app_data_dir: PathBuf) -> AppResult<Self> {
        fs::create_dir_all(&app_data_dir)?;
        fs::create_dir_all(app_data_dir.join("books"))?;

        let registry_path = app_data_dir.join("registry.sqlite");
        let registry_conn = Connection::open(registry_path)?;
        init_registry_db(&registry_conn)?;
        let sync = crate::sync::SyncEngine::new(&app_data_dir)?;

        Ok(Self {
            app_data_dir,
            registry: Arc::new(Mutex::new(registry_conn)),
            pool: Arc::new(RwLock::new(HashMap::new())),
            sync,
        })
    }

    pub fn book_db_path(&self, validated_book_id: &str) -> PathBuf {
        self.app_data_dir
            .join("books")
            .join(format!("{}.sqlite", validated_book_id))
    }

    pub async fn with_registry<F, T>(&self, f: F) -> AppResult<T>
    where
        F: FnOnce(&mut Connection) -> AppResult<T> + Send + 'static,
        T: Send + 'static,
    {
        let registry = Arc::clone(&self.registry);
        tokio::task::spawn_blocking(move || {
            let mut guard = registry
                .lock()
                .map_err(|_| AppError::Internal("Registry mutex poisoned".into()))?;
            f(&mut guard)
        })
        .await
        .map_err(|e| AppError::TaskJoin(e.to_string()))?
    }

    pub async fn get_or_open_book(&self, book_id: &str) -> AppResult<Arc<Mutex<Connection>>> {
        let valid_id = validate_book_id(book_id)?;

        {
            let read_guard = self
                .pool
                .read()
                .map_err(|_| AppError::Internal("Pool RwLock poisoned".into()))?;
            if let Some(conn) = read_guard.get(&valid_id) {
                return Ok(Arc::clone(conn));
            }
        }

        let state = self.clone();
        let valid_id_clone = valid_id.clone();

        tokio::task::spawn_blocking(move || {
            let mut write_guard = state
                .pool
                .write()
                .map_err(|_| AppError::Internal("Pool RwLock poisoned".into()))?;
            if let Some(conn) = write_guard.get(&valid_id_clone) {
                return Ok(Arc::clone(conn));
            }

            let book_name: String = {
                let reg_guard = state
                    .registry
                    .lock()
                    .map_err(|_| AppError::Internal("Registry mutex poisoned".into()))?;
                let name: Option<String> = reg_guard
                    .query_row(
                        "SELECT name FROM books WHERE id = ?1",
                        params![valid_id_clone],
                        |row| row.get(0),
                    )
                    .optional()?;
                let name = name.ok_or_else(|| AppError::BookNotFound(valid_id_clone.clone()))?;
                reg_guard.execute(
                    "UPDATE books SET last_opened_at = ?1 WHERE id = ?2",
                    params![now_iso8601(), valid_id_clone],
                )?;
                name
            };

            let db_path = state.book_db_path(&valid_id_clone);
            let mut conn = Connection::open(&db_path)?;
            init_book_db(&mut conn, &valid_id_clone, &book_name, false)?;

            let arc_conn = Arc::new(Mutex::new(conn));
            write_guard.insert(valid_id_clone, Arc::clone(&arc_conn));
            Ok(arc_conn)
        })
        .await
        .map_err(|e| AppError::TaskJoin(e.to_string()))?
    }

    pub async fn with_book<F, T>(&self, book_id: &str, f: F) -> AppResult<T>
    where
        F: FnOnce(&mut Connection) -> AppResult<T> + Send + 'static,
        T: Send + 'static,
    {
        let conn_arc = self.get_or_open_book(book_id).await?;
        tokio::task::spawn_blocking(move || {
            let mut guard = conn_arc
                .lock()
                .map_err(|_| AppError::Internal("Book connection mutex poisoned".into()))?;
            f(&mut guard)
        })
        .await
        .map_err(|e| AppError::TaskJoin(e.to_string()))?
    }

    pub async fn close_book_conn(&self, book_id: &str) -> AppResult<()> {
        let valid_id = validate_book_id(book_id)?;
        let pool = Arc::clone(&self.pool);
        tokio::task::spawn_blocking(move || {
            let mut write_guard = pool
                .write()
                .map_err(|_| AppError::Internal("Pool RwLock poisoned".into()))?;
            write_guard.remove(&valid_id);
            Ok(())
        })
        .await
        .map_err(|e| AppError::TaskJoin(e.to_string()))?
    }
}

pub fn open_in_memory_book(book_id: &str, book_name: &str) -> AppResult<Connection> {
    let mut conn = Connection::open_in_memory()?;
    init_book_db(&mut conn, book_id, book_name, false)?;
    Ok(conn)
}

pub fn ensure_system_category_in_tx(
    tx: &rusqlite::Transaction<'_>,
    id: &str,
    name: &str,
    kind: &str,
) -> AppResult<String> {
    let existing: Option<(String, i64)> = tx
        .query_row(
            "SELECT id, is_deleted FROM categories WHERE id = ?1",
            params![id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;

    if let Some((found_id, 0)) = existing {
        let resolved: String = tx.query_row(
            "SELECT COALESCE(merged_into_id, id) FROM categories WHERE id = ?1",
            params![found_id],
            |row| row.get(0),
        )?;
        return Ok(resolved);
    }

    let mut clock = load_clock_from_tx(tx)?;
    let hlc = clock.tick(system_now_ms())?.to_string();
    let device_id = clock.device_id().to_string();
    let normalized = normalize_category_name(name);

    let row = crate::crdt::CategoryRow {
        id: id.to_string(),
        name: name.to_string(),
        normalized_name: normalized,
        kind: kind.to_string(),
        merged_into_id: None,
        is_deleted: 0,
        updated_hlc: hlc,
    };

    crate::crdt::write_local_category_op(tx, &row, &device_id)?;
    save_clock_to_tx(tx, &clock)?;
    crate::crdt::dedupe_categories(tx)?;

    let resolved: String = tx.query_row(
        "SELECT COALESCE(merged_into_id, id) FROM categories WHERE id = ?1",
        params![id],
        |row| row.get(0),
    )?;
    Ok(resolved)
}

pub fn check_book_file_exists(app_data_dir: &Path, book_id: &str) -> bool {
    app_data_dir
        .join("books")
        .join(format!("{}.sqlite", book_id))
        .exists()
}

