import type { Database } from "@sqlite.org/sqlite-wasm";
import type { AccountRow } from "../../lib/tauri-api";
import {
  DEFAULT_CASH_ACCOUNT_ID,
  HlcTimestamp,
  generateDeviceId,
  systemNowMs,
} from "../../lib/web-core";
import {
  loadClockFromDb,
  saveClockToDb,
  writeLocalAccountOp,
} from "./crdt-ops";

export function configurePragmas(db: Database): void {
  db.exec(
    `PRAGMA foreign_keys = OFF;
     PRAGMA synchronous = NORMAL;
     PRAGMA busy_timeout = 5000;`
  );
}

export function initRegistryDb(db: Database): void {
  configurePragmas(db);
  db.exec(
    `CREATE TABLE IF NOT EXISTS books (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        kind TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_opened_at TEXT NOT NULL
    );`
  );
}

export function initBookDb(
  db: Database,
  bookId: string,
  bookName: string,
  seedDefaults: boolean
): void {
  configurePragmas(db);

  const currentVersion = Number(
    db.selectValue("PRAGMA user_version") ?? 0
  );

  if (currentVersion < 1) {
    db.transaction("IMMEDIATE", (tx) => {
      tx.exec(`
        CREATE TABLE IF NOT EXISTS meta (
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
            direct_addrs_json TEXT,
            device_name TEXT,
            custom_alias TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_transactions_tx_date ON transactions(tx_date DESC);
        CREATE INDEX IF NOT EXISTS idx_transactions_account_id ON transactions(account_id);
        CREATE INDEX IF NOT EXISTS idx_transactions_category_id ON transactions(category_id);
        CREATE INDEX IF NOT EXISTS idx_crdt_oplog_device_hlc ON crdt_oplog(device_id, hlc_timestamp);
        CREATE INDEX IF NOT EXISTS idx_categories_kind_norm ON categories(kind, normalized_name);
        CREATE INDEX IF NOT EXISTS idx_budgets_cat_period ON budgets(category_id, period);
        CREATE INDEX IF NOT EXISTS idx_transactions_type_date ON transactions(tx_type, tx_date);

        PRAGMA user_version = 1;
      `);
    });
  }

  db.transaction("IMMEDIATE", (tx) => {
    try {
      tx.exec("ALTER TABLE sync_peers ADD COLUMN relay_url TEXT");
    } catch {
      // Column already exists
    }
    try {
      tx.exec("ALTER TABLE sync_peers ADD COLUMN direct_addrs_json TEXT");
    } catch {
      // Column already exists
    }
    try {
      tx.exec("ALTER TABLE sync_peers ADD COLUMN device_name TEXT");
    } catch {
      // Column already exists
    }
    try {
      tx.exec("ALTER TABLE sync_peers ADD COLUMN custom_alias TEXT");
    } catch {
      // Column already exists
    }

    tx.exec({
      sql: "INSERT OR IGNORE INTO meta (key, value) VALUES ('book_id', ?1)",
      bind: [bookId],
    });
    tx.exec({
      sql: `INSERT INTO meta (key, value) VALUES ('book_name', ?1)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      bind: [bookName],
    });

    let deviceName = tx.selectValue(
      "SELECT value FROM meta WHERE key = 'device_name'"
    ) as string | undefined;

    if (!deviceName) {
      deviceName =
        typeof navigator !== "undefined" && /android/i.test(navigator.userAgent)
          ? "Android Phone"
          : typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent)
          ? "iPhone"
          : typeof navigator !== "undefined" && /macintosh|mac os x/i.test(navigator.userAgent)
          ? "Mac"
          : typeof navigator !== "undefined" && /windows/i.test(navigator.userAgent)
          ? "Windows PC"
          : typeof navigator !== "undefined" && /linux/i.test(navigator.userAgent)
          ? "Linux PC"
          : "Web Browser";
      tx.exec({
        sql: "INSERT INTO meta (key, value) VALUES ('device_name', ?1)",
        bind: [deviceName],
      });
    }

    let deviceId = tx.selectValue(
      "SELECT value FROM meta WHERE key = 'device_id'"
    ) as string | undefined;

    if (!deviceId) {
      deviceId = generateDeviceId();
      tx.exec({
        sql: "INSERT INTO meta (key, value) VALUES ('device_id', ?1)",
        bind: [deviceId],
      });
    }

    const existingHlc = tx.selectValue(
      "SELECT value FROM meta WHERE key = 'hlc_last'"
    ) as string | undefined;

    if (!existingHlc) {
      const initialHlc = HlcTimestamp.zero(deviceId).toString();
      tx.exec({
        sql: "INSERT INTO meta (key, value) VALUES ('hlc_last', ?1)",
        bind: [initialHlc],
      });
    }

    if (seedDefaults) {
      const accCount = Number(
        tx.selectValue("SELECT COUNT(*) FROM accounts") ?? 0
      );
      if (accCount === 0) {
        const clock = loadClockFromDb(tx);
        const hlcAcc = clock.tick(systemNowMs()).toString();
        const cashRow: AccountRow = {
          id: DEFAULT_CASH_ACCOUNT_ID,
          name: "Kas Tunai",
          account_type: "CASH",
          initial_balance: 0,
          merged_into_id: null,
          is_deleted: 0,
          updated_hlc: hlcAcc,
        };
        writeLocalAccountOp(tx, cashRow, deviceId);
        saveClockToDb(tx, clock);
      }
    }
  });
}

