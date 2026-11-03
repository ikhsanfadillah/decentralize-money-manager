import sqlite3InitModule, {
  type Database,
  type SAHPoolUtil,
  type Sqlite3Static,
  type SqlValue,
} from "@sqlite.org/sqlite-wasm";
import {
  TauriCommandError,
  type AccountBalanceItem,
  type AccountReconciliationItem,
  type AccountRow,
  type AccountType,
  type AccountView,
  type AddTransactionInput,
  type BookKind,
  type BookMetadata,
  type BudgetPeriod,
  type BudgetProgressItem,
  type BudgetRow,
  type BudgetStatus,
  type CashFlowMonthItem,
  type CategoryKind,
  type CategoryMonthlyBreakdownItem,
  type CategoryView,
  type DailyCashFlowPoint,
  type DeviceContributionItem,
  type InviteResponse,
  type MonthlyReportResponse,
  type PaginatedTransactions,
  type PeerInfo,
  type SyncStatusPayload,
  type SyncTopologyInfo,
  type TransactionFilter,
  type TransactionRow,
  type TransactionType,
  type TransactionView,
  type TransferBetweenBooksInput,
  type TransferBetweenBooksResult,
  type UpdateTransactionInput,
  type UpsertAccountInput,
  type UpsertBudgetInput,
  type UpsertCategoryInput,
} from "../lib/tauri-api";
import {
  ACCOUNT_ROOTS_CTE_SQL,
  DEFAULT_CASH_ACCOUNT_ID,
  HlcClock,
  HlcTimestamp,
  SYSTEM_CATEGORY_MODAL_ID,
  SYSTEM_CATEGORY_MODAL_NAME,
  SYSTEM_CATEGORY_PRIVE_ID,
  SYSTEM_CATEGORY_PRIVE_NAME,
  daysInYearMonth,
  decryptBookSnapshotBytes,
  deterministicBudgetId,
  encryptBookSnapshotBytes,
  generateDeviceId,
  newUuidV7,
  normalizeCategoryName,
  nowIso8601,
  parseMonthBounds,
  previousYearMonth,
  randomHex,
  systemNowMs,
  validateBookId,
  validateIsoDate,
} from "../lib/web-core";
import {
  CrdtMergeReport,
  CrdtOp,
  collectOpsSinceFrontier,
  computeLocalFrontier,
  mergeRemoteOplog,
} from "./crdt-merge";
import { WebSyncEngine } from "./sync-engine";

interface CategoryRowInternal {
  id: string;
  name: string;
  normalized_name: string;
  kind: CategoryKind;
  merged_into_id: string | null;
  is_deleted: number;
  updated_hlc: string;
}

const IDB_DB_NAME = "dmm_sqlite_storage_v1";
const IDB_STORE_NAME = "sqlite_files";

function hasIndexedDb(): boolean {
  return typeof indexedDB !== "undefined";
}

function openIdb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE_NAME)) {
        db.createObjectStore(IDB_STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbReadFile(path: string): Promise<Uint8Array | null> {
  if (!hasIndexedDb()) return null;
  try {
    const idb = await openIdb();
    return await new Promise<Uint8Array | null>((resolve, reject) => {
      const tx = idb.transaction(IDB_STORE_NAME, "readonly");
      const req = tx.objectStore(IDB_STORE_NAME).get(path);
      req.onsuccess = () => {
        const val = req.result;
        resolve(val instanceof Uint8Array ? val : null);
      };
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

async function idbWriteFile(path: string, data: Uint8Array): Promise<void> {
  if (!hasIndexedDb()) return;
  try {
    const idb = await openIdb();
    await new Promise<void>((resolve, reject) => {
      const tx = idb.transaction(IDB_STORE_NAME, "readwrite");
      tx.objectStore(IDB_STORE_NAME).put(data, path);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Ignore IDB quota/unavailable errors in restricted contexts
  }
}

async function idbDeleteFile(path: string): Promise<void> {
  if (!hasIndexedDb()) return;
  try {
    const idb = await openIdb();
    await new Promise<void>((resolve, reject) => {
      const tx = idb.transaction(IDB_STORE_NAME, "readwrite");
      tx.objectStore(IDB_STORE_NAME).delete(path);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Ignore
  }
}

export class WebSqliteEngine {
  private sqlite3!: Sqlite3Static;
  private sahPool: SAHPoolUtil | null = null;
  private registryDb!: Database;
  private bookPool = new Map<string, Database>();
  private inMemoryFiles = new Map<string, Uint8Array>();
  private localNodeId: string = generateDeviceId() + generateDeviceId();
  private initPromise: Promise<void> | null = null;
  private syncEngine: WebSyncEngine;
  public onLocalOpCreated?: (bookId: string, op: CrdtOp) => void;

  constructor() {
    this.syncEngine = new WebSyncEngine(this.localNodeId, {
      getOrOpenBook: (bookId) => this.getOrOpenBook(bookId),
      withBookWrite: (bookId, action) => this.withBookWrite(bookId, action),
      getRegistryDb: () => this.registryDb,
      initBookDb: (db, bookId, bookName, seedDefaults) =>
        this.initBookDb(db, bookId, bookName, seedDefaults),
      persistDatabaseFile: (virtualPath, db) => this.persistDatabaseFile(virtualPath, db),
      bookVirtualPath: (validBookId) => this.bookVirtualPath(validBookId),
    });
  }

  async init(): Promise<void> {
    if (this.initPromise) {
      return this.initPromise;
    }
    this.initPromise = this.doInit();
    return this.initPromise;
  }

  private async doInit(): Promise<void> {
    this.sqlite3 = await sqlite3InitModule();

    // Try installing OPFS SAHPool VFS first (works in Dedicated Web Worker without COOP/COEP)
    if (typeof this.sqlite3.installOpfsSAHPoolVfs === "function") {
      try {
        this.sahPool = await this.sqlite3.installOpfsSAHPoolVfs({
          name: "dmm-opfs-pool",
          initialCapacity: 24,
        });
      } catch {
        this.sahPool = null;
      }
    }

    this.registryDb = await this.openDatabaseFile("/registry.sqlite");
    this.initRegistryDb(this.registryDb);
    await this.persistDatabaseFile("/registry.sqlite", this.registryDb);
  }

  private async openDatabaseFile(virtualPath: string): Promise<Database> {
    if (this.sahPool) {
      await this.sahPool.reserveMinimumCapacity(
        Math.max(24, this.sahPool.getFileCount() + 4)
      );
      return new this.sahPool.OpfsSAHPoolDb(virtualPath);
    }

    if ("opfs" in this.sqlite3 && this.sqlite3.oo1.OpfsDb) {
      return new this.sqlite3.oo1.OpfsDb(virtualPath);
    }

    const db = new this.sqlite3.oo1.DB(":memory:", "c");
    const savedBytes =
      (await idbReadFile(virtualPath)) ??
      this.inMemoryFiles.get(virtualPath) ??
      null;

    if (savedBytes && savedBytes.byteLength > 0 && db.pointer) {
      const pData = this.sqlite3.wasm.allocFromTypedArray(savedBytes);
      const flags =
        this.sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE |
        this.sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE;
      const rc = this.sqlite3.capi.sqlite3_deserialize(
        db.pointer,
        "main",
        pData,
        savedBytes.byteLength,
        savedBytes.byteLength,
        flags
      );
      db.checkRc(rc);
    }
    return db;
  }

  private async persistDatabaseFile(
    virtualPath: string,
    db: Database
  ): Promise<void> {
    if (this.sahPool || ("opfs" in this.sqlite3 && this.sqlite3.oo1.OpfsDb)) {
      // OPFS writes directly to virtual disk on transaction commit
      return;
    }
    const bytes = this.sqlite3.capi.sqlite3_js_db_export(db);
    const copy = new Uint8Array(bytes);
    this.inMemoryFiles.set(virtualPath, copy);
    await idbWriteFile(virtualPath, copy);
  }

  private async deleteDatabaseFile(virtualPath: string): Promise<void> {
    if (this.sahPool) {
      this.sahPool.unlink(virtualPath);
      return;
    }
    this.inMemoryFiles.delete(virtualPath);
    await idbDeleteFile(virtualPath);
  }

  private bookVirtualPath(validBookId: string): string {
    return `/books/${validBookId}.sqlite`;
  }

  private configurePragmas(db: Database): void {
    db.exec(
      `PRAGMA foreign_keys = OFF;
       PRAGMA synchronous = NORMAL;
       PRAGMA busy_timeout = 5000;`
    );
  }

  private initRegistryDb(db: Database): void {
    this.configurePragmas(db);
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

  private initBookDb(
    db: Database,
    bookId: string,
    bookName: string,
    seedDefaults: boolean
  ): void {
    this.configurePragmas(db);

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
          const clock = this.loadClockFromDb(tx);
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
          this.writeLocalAccountOp(tx, cashRow, deviceId);
          this.saveClockToDb(tx, clock);
        }
      }
    });
  }

  private loadClockFromDb(db: Database): HlcClock {
    const deviceId =
      (db.selectValue("SELECT value FROM meta WHERE key = 'device_id'") as
        | string
        | undefined) ?? "00000000";
    const hlcLastRaw = db.selectValue(
      "SELECT value FROM meta WHERE key = 'hlc_last'"
    ) as string | undefined;

    if (hlcLastRaw) {
      const parsed = HlcTimestamp.parse(hlcLastRaw);
      return new HlcClock(
        new HlcTimestamp(parsed.wall_ms, parsed.counter, deviceId)
      );
    }
    return HlcClock.fromDeviceId(deviceId);
  }

  private saveClockToDb(db: Database, clock: HlcClock): void {
    db.exec({
      sql: `INSERT INTO meta (key, value) VALUES ('hlc_last', ?1)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      bind: [clock.last().toString()],
    });
  }

  private validateAccountRow(row: AccountRow): void {
    if (!row.id.trim()) {
      throw new TauriCommandError(
        "VALIDATION_ERROR",
        "Account id cannot be empty"
      );
    }
    if (!row.name.trim()) {
      throw new TauriCommandError(
        "VALIDATION_ERROR",
        "Account name cannot be empty"
      );
    }
    if (!["BANK", "CASH", "EWALLET"].includes(row.account_type)) {
      throw new TauriCommandError(
        "VALIDATION_ERROR",
        `Invalid account_type '${row.account_type}'`
      );
    }
    if (row.is_deleted !== 0 && row.is_deleted !== 1) {
      throw new TauriCommandError(
        "VALIDATION_ERROR",
        "is_deleted must be 0 or 1"
      );
    }
    if (row.merged_into_id && row.merged_into_id === row.id) {
      throw new TauriCommandError(
        "VALIDATION_ERROR",
        "Account cannot be merged into itself"
      );
    }
  }

  private validateCategoryRow(row: CategoryRowInternal): void {
    if (!row.id.trim()) {
      throw new TauriCommandError(
        "VALIDATION_ERROR",
        "Category id cannot be empty"
      );
    }
    if (!row.name.trim()) {
      throw new TauriCommandError(
        "VALIDATION_ERROR",
        "Category name cannot be empty"
      );
    }
    if (!["EXPENSE", "INCOME"].includes(row.kind)) {
      throw new TauriCommandError(
        "VALIDATION_ERROR",
        `Invalid category kind '${row.kind}'`
      );
    }
    if (row.is_deleted !== 0 && row.is_deleted !== 1) {
      throw new TauriCommandError(
        "VALIDATION_ERROR",
        "is_deleted must be 0 or 1"
      );
    }
  }

  private validateTransactionRow(row: TransactionRow): void {
    if (!row.id.trim()) {
      throw new TauriCommandError(
        "VALIDATION_ERROR",
        "Transaction id cannot be empty"
      );
    }
    if (!row.account_id.trim()) {
      throw new TauriCommandError(
        "VALIDATION_ERROR",
        "Transaction account_id cannot be empty"
      );
    }
    validateIsoDate(row.tx_date);
    if (row.is_deleted !== 0 && row.is_deleted !== 1) {
      throw new TauriCommandError(
        "VALIDATION_ERROR",
        "is_deleted must be 0 or 1"
      );
    }

    switch (row.tx_type) {
      case "EXPENSE":
        if (row.amount >= 0) {
          throw new TauriCommandError(
            "VALIDATION_ERROR",
            "EXPENSE transaction amount must be negative (< 0)"
          );
        }
        if (row.to_account_id !== null) {
          throw new TauriCommandError(
            "VALIDATION_ERROR",
            "EXPENSE transaction must not have to_account_id"
          );
        }
        if (!row.category_id || !row.category_id.trim()) {
          throw new TauriCommandError(
            "VALIDATION_ERROR",
            "EXPENSE transaction requires category_id"
          );
        }
        break;
      case "INCOME":
        if (row.amount <= 0) {
          throw new TauriCommandError(
            "VALIDATION_ERROR",
            "INCOME transaction amount must be positive (> 0)"
          );
        }
        if (row.to_account_id !== null) {
          throw new TauriCommandError(
            "VALIDATION_ERROR",
            "INCOME transaction must not have to_account_id"
          );
        }
        if (!row.category_id || !row.category_id.trim()) {
          throw new TauriCommandError(
            "VALIDATION_ERROR",
            "INCOME transaction requires category_id"
          );
        }
        break;
      case "TRANSFER":
        if (row.amount <= 0) {
          throw new TauriCommandError(
            "VALIDATION_ERROR",
            "TRANSFER transaction amount must be positive (> 0)"
          );
        }
        if (!row.to_account_id || !row.to_account_id.trim()) {
          throw new TauriCommandError(
            "VALIDATION_ERROR",
            "TRANSFER transaction requires to_account_id"
          );
        }
        if (row.to_account_id === row.account_id) {
          throw new TauriCommandError(
            "VALIDATION_ERROR",
            "TRANSFER account_id and to_account_id must be different"
          );
        }
        if (row.category_id !== null) {
          throw new TauriCommandError(
            "VALIDATION_ERROR",
            "TRANSFER transaction must have NULL category_id"
          );
        }
        break;
      default:
        throw new TauriCommandError(
          "VALIDATION_ERROR",
          `Invalid tx_type '${String(row.tx_type)}'`
        );
    }
  }

  private validateBudgetRow(row: BudgetRow): void {
    if (row.period !== "MONTHLY") {
      throw new TauriCommandError(
        "VALIDATION_ERROR",
        `Unsupported budget period '${row.period}', only MONTHLY is supported in v1`
      );
    }
    if (row.amount_limit <= 0) {
      throw new TauriCommandError(
        "VALIDATION_ERROR",
        "Budget amount_limit must be > 0"
      );
    }
    if (row.alert_threshold_pct < 1 || row.alert_threshold_pct > 100) {
      throw new TauriCommandError(
        "VALIDATION_ERROR",
        "Budget alert_threshold_pct must be between 1 and 100"
      );
    }
    if (row.is_deleted !== 0 && row.is_deleted !== 1) {
      throw new TauriCommandError(
        "VALIDATION_ERROR",
        "is_deleted must be 0 or 1"
      );
    }
    const expectedId = deterministicBudgetId(row.category_id, row.period);
    if (row.id !== expectedId) {
      throw new TauriCommandError(
        "VALIDATION_ERROR",
        `Budget id '${row.id}' does not match deterministic UUIDv5 '${expectedId}'`
      );
    }
  }

  private writeLocalAccountOp(
    db: Database,
    row: AccountRow,
    deviceId: string,
    bookId?: string,
  ): void {
    this.validateAccountRow(row);
    const payloadJson = JSON.stringify({ op: "upsert", row });

    db.exec({
      sql: `INSERT INTO accounts (id, name, account_type, initial_balance, merged_into_id, is_deleted, updated_hlc)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
            ON CONFLICT(id) DO UPDATE SET
               name = excluded.name,
               account_type = excluded.account_type,
               initial_balance = excluded.initial_balance,
               merged_into_id = excluded.merged_into_id,
               is_deleted = excluded.is_deleted,
               updated_hlc = excluded.updated_hlc`,
      bind: [
        row.id,
        row.name,
        row.account_type,
        row.initial_balance,
        row.merged_into_id,
        row.is_deleted,
        row.updated_hlc,
      ],
    });

    db.exec({
      sql: `INSERT INTO crdt_oplog (hlc_timestamp, table_name, row_id, payload_json, device_id)
            VALUES (?1, 'accounts', ?2, ?3, ?4)`,
      bind: [row.updated_hlc, row.id, payloadJson, deviceId],
    });

    if (bookId) {
      const op: CrdtOp = {
        hlc_timestamp: row.updated_hlc,
        table_name: "accounts",
        row_id: row.id,
        payload_json: payloadJson,
        device_id: deviceId,
      };
      this.onLocalOpCreated?.(bookId, op);
      void this.syncEngine.broadcastLocalOp(bookId, op);
    }
  }

  private writeLocalCategoryOp(
    db: Database,
    row: CategoryRowInternal,
    deviceId: string,
    bookId?: string,
  ): void {
    this.validateCategoryRow(row);
    const cleanRow: CategoryRowInternal = {
      ...row,
      normalized_name: normalizeCategoryName(row.name),
      merged_into_id: null,
    };
    const payloadJson = JSON.stringify({ op: "upsert", row: cleanRow });

    db.exec({
      sql: `INSERT INTO categories (id, name, normalized_name, kind, merged_into_id, is_deleted, updated_hlc)
            VALUES (?1, ?2, ?3, ?4, NULL, ?5, ?6)
            ON CONFLICT(id) DO UPDATE SET
               name = excluded.name,
               normalized_name = excluded.normalized_name,
               kind = excluded.kind,
               is_deleted = excluded.is_deleted,
               updated_hlc = excluded.updated_hlc`,
      bind: [
        cleanRow.id,
        cleanRow.name,
        cleanRow.normalized_name,
        cleanRow.kind,
        cleanRow.is_deleted,
        cleanRow.updated_hlc,
      ],
    });

    db.exec({
      sql: `INSERT INTO crdt_oplog (hlc_timestamp, table_name, row_id, payload_json, device_id)
            VALUES (?1, 'categories', ?2, ?3, ?4)`,
      bind: [cleanRow.updated_hlc, cleanRow.id, payloadJson, deviceId],
    });

    if (bookId) {
      const op: CrdtOp = {
        hlc_timestamp: cleanRow.updated_hlc,
        table_name: "categories",
        row_id: cleanRow.id,
        payload_json: payloadJson,
        device_id: deviceId,
      };
      this.onLocalOpCreated?.(bookId, op);
      void this.syncEngine.broadcastLocalOp(bookId, op);
    }
  }

  private writeLocalTransactionOp(
    db: Database,
    row: TransactionRow,
    deviceId: string,
    bookId?: string,
  ): void {
    this.validateTransactionRow(row);
    const payloadJson = JSON.stringify({ op: "upsert", row });

    db.exec({
      sql: `INSERT INTO transactions (
               id, account_id, to_account_id, category_id, amount, tx_type,
               note, tx_date, created_by_device, link_id, is_deleted, updated_hlc
            )
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
            ON CONFLICT(id) DO UPDATE SET
               account_id = excluded.account_id,
               to_account_id = excluded.to_account_id,
               category_id = excluded.category_id,
               amount = excluded.amount,
               tx_type = excluded.tx_type,
               note = excluded.note,
               tx_date = excluded.tx_date,
               created_by_device = excluded.created_by_device,
               link_id = excluded.link_id,
               is_deleted = excluded.is_deleted,
               updated_hlc = excluded.updated_hlc`,
      bind: [
        row.id,
        row.account_id,
        row.to_account_id,
        row.category_id,
        row.amount,
        row.tx_type,
        row.note,
        row.tx_date,
        row.created_by_device,
        row.link_id,
        row.is_deleted,
        row.updated_hlc,
      ],
    });

    db.exec({
      sql: `INSERT INTO crdt_oplog (hlc_timestamp, table_name, row_id, payload_json, device_id)
            VALUES (?1, 'transactions', ?2, ?3, ?4)`,
      bind: [row.updated_hlc, row.id, payloadJson, deviceId],
    });

    if (bookId) {
      const op: CrdtOp = {
        hlc_timestamp: row.updated_hlc,
        table_name: "transactions",
        row_id: row.id,
        payload_json: payloadJson,
        device_id: deviceId,
      };
      this.onLocalOpCreated?.(bookId, op);
      void this.syncEngine.broadcastLocalOp(bookId, op);
    }
  }

  private writeLocalBudgetOp(
    db: Database,
    row: BudgetRow,
    deviceId: string,
    bookId?: string,
  ): void {
    this.validateBudgetRow(row);
    const payloadJson = JSON.stringify({ op: "upsert", row });

    db.exec({
      sql: `INSERT INTO budgets (id, category_id, period, amount_limit, alert_threshold_pct, is_deleted, updated_hlc)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
            ON CONFLICT(id) DO UPDATE SET
               category_id = excluded.category_id,
               period = excluded.period,
               amount_limit = excluded.amount_limit,
               alert_threshold_pct = excluded.alert_threshold_pct,
               is_deleted = excluded.is_deleted,
               updated_hlc = excluded.updated_hlc`,
      bind: [
        row.id,
        row.category_id,
        row.period,
        row.amount_limit,
        row.alert_threshold_pct,
        row.is_deleted,
        row.updated_hlc,
      ],
    });

    db.exec({
      sql: `INSERT INTO crdt_oplog (hlc_timestamp, table_name, row_id, payload_json, device_id)
            VALUES (?1, 'budgets', ?2, ?3, ?4)`,
      bind: [row.updated_hlc, row.id, payloadJson, deviceId],
    });

    if (bookId) {
      const op: CrdtOp = {
        hlc_timestamp: row.updated_hlc,
        table_name: "budgets",
        row_id: row.id,
        payload_json: payloadJson,
        device_id: deviceId,
      };
      this.onLocalOpCreated?.(bookId, op);
      void this.syncEngine.broadcastLocalOp(bookId, op);
    }
  }

  private dedupeCategories(db: Database): void {
    db.exec(`
      WITH canonicals AS (
          SELECT kind, normalized_name, MIN(id) AS canonical_id
          FROM categories
          WHERE is_deleted = 0
          GROUP BY kind, normalized_name
      )
      UPDATE categories
      SET merged_into_id = CASE
          WHEN is_deleted = 1 THEN NULL
          ELSE (
              SELECT CASE
                  WHEN c.canonical_id = categories.id THEN NULL
                  ELSE c.canonical_id
              END
              FROM canonicals c
              WHERE c.kind = categories.kind
                AND c.normalized_name = categories.normalized_name
          )
      END;
    `);
  }

  private resolveAccountRootsMap(db: Database): Map<string, string> {
    const sql = `${ACCOUNT_ROOTS_CTE_SQL} SELECT account_id, root_id FROM account_roots`;
    const rows = db.selectArrays(sql);
    const map = new Map<string, string>();
    for (const r of rows) {
      map.set(String(r[0]), String(r[1]));
    }
    return map;
  }

  private ensureSystemCategory(
    db: Database,
    id: string,
    name: string,
    kind: CategoryKind
  ): string {
    const existing = db.selectArray(
      "SELECT id, is_deleted FROM categories WHERE id = ?1",
      [id]
    );
    if (existing && Number(existing[1]) === 0) {
      const resolved = db.selectValue(
        "SELECT COALESCE(merged_into_id, id) FROM categories WHERE id = ?1",
        [String(existing[0])]
      );
      return String(resolved ?? id);
    }

    const clock = this.loadClockFromDb(db);
    const hlc = clock.tick(systemNowMs()).toString();
    const deviceId = clock.deviceId();
    const row: CategoryRowInternal = {
      id,
      name,
      normalized_name: normalizeCategoryName(name),
      kind,
      merged_into_id: null,
      is_deleted: 0,
      updated_hlc: hlc,
    };

    this.writeLocalCategoryOp(db, row, deviceId);
    this.saveClockToDb(db, clock);
    this.dedupeCategories(db);

    const resolved = db.selectValue(
      "SELECT COALESCE(merged_into_id, id) FROM categories WHERE id = ?1",
      [id]
    );
    return String(resolved ?? id);
  }

  private async getOrOpenBook(bookId: string): Promise<Database> {
    await this.init();
    const validId = validateBookId(bookId);
    const existing = this.bookPool.get(validId);
    if (existing && existing.isOpen()) {
      return existing;
    }

    const bookName = this.registryDb.selectValue(
      "SELECT name FROM books WHERE id = ?1",
      [validId]
    ) as string | undefined;

    if (!bookName) {
      throw new TauriCommandError(
        "BOOK_NOT_FOUND",
        `Book not found: ${validId}`
      );
    }

    this.registryDb.exec({
      sql: "UPDATE books SET last_opened_at = ?1 WHERE id = ?2",
      bind: [nowIso8601(), validId],
    });
    await this.persistDatabaseFile("/registry.sqlite", this.registryDb);

    const vPath = this.bookVirtualPath(validId);
    const db = await this.openDatabaseFile(vPath);
    this.initBookDb(db, validId, bookName, false);
    await this.persistDatabaseFile(vPath, db);
    this.bookPool.set(validId, db);
    return db;
  }

  private async withBookWrite<T>(
    bookId: string,
    fn: (db: Database, validId: string) => T | Promise<T>
  ): Promise<T> {
    const validId = validateBookId(bookId);
    const db = await this.getOrOpenBook(validId);
    const result = await fn(db, validId);
    await this.persistDatabaseFile(this.bookVirtualPath(validId), db);
    return result;
  }

  // ==========================================================================
  // Command Handlers (1:1 with src-tauri/src/commands.rs)
  // ==========================================================================

  async listBooks(): Promise<BookMetadata[]> {
    await this.init();
    const rows = this.registryDb.selectArrays(
      `SELECT id, name, kind, created_at, last_opened_at
       FROM books
       ORDER BY last_opened_at DESC, created_at DESC`
    );
    return rows.map((r) => ({
      id: String(r[0]),
      name: String(r[1]),
      kind: String(r[2]),
      created_at: String(r[3]),
      last_opened_at: String(r[4]),
      file_exists: true,
    }));
  }

  async createBook(name: string, kind: BookKind): Promise<BookMetadata> {
    await this.init();
    const trimmedName = name.trim();
    if (!trimmedName) {
      throw new TauriCommandError(
        "VALIDATION_ERROR",
        "Book name cannot be empty"
      );
    }
    const trimmedKind = (kind?.trim() || "PERSONAL").toUpperCase();
    const bookId = newUuidV7();
    const now = nowIso8601();

    this.registryDb.exec({
      sql: `INSERT INTO books (id, name, kind, created_at, last_opened_at)
            VALUES (?1, ?2, ?3, ?4, ?5)`,
      bind: [bookId, trimmedName, trimmedKind, now, now],
    });
    await this.persistDatabaseFile("/registry.sqlite", this.registryDb);

    const vPath = this.bookVirtualPath(bookId);
    const db = await this.openDatabaseFile(vPath);
    this.initBookDb(db, bookId, trimmedName, true);
    await this.persistDatabaseFile(vPath, db);
    this.bookPool.set(bookId, db);

    return {
      id: bookId,
      name: trimmedName,
      kind: trimmedKind,
      created_at: now,
      last_opened_at: now,
      file_exists: true,
    };
  }

  async renameBook(bookId: string, newName: string): Promise<BookMetadata> {
    await this.init();
    const validId = validateBookId(bookId);
    const trimmed = newName.trim();
    if (!trimmed) {
      throw new TauriCommandError(
        "VALIDATION_ERROR",
        "Book name cannot be empty"
      );
    }

    await this.withBookWrite(validId, (db) => {
      db.exec({
        sql: `INSERT INTO meta (key, value) VALUES ('book_name', ?1)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        bind: [trimmed],
      });
    });

    this.registryDb.exec({
      sql: "UPDATE books SET name = ?1 WHERE id = ?2",
      bind: [trimmed, validId],
    });
    if (this.registryDb.changes() === 0) {
      throw new TauriCommandError(
        "BOOK_NOT_FOUND",
        `Book not found: ${validId}`
      );
    }
    await this.persistDatabaseFile("/registry.sqlite", this.registryDb);

    const row = this.registryDb.selectArray(
      "SELECT id, name, kind, created_at, last_opened_at FROM books WHERE id = ?1",
      [validId]
    );
    if (!row) {
      throw new TauriCommandError(
        "BOOK_NOT_FOUND",
        `Book not found: ${validId}`
      );
    }
    return {
      id: String(row[0]),
      name: String(row[1]),
      kind: String(row[2]),
      created_at: String(row[3]),
      last_opened_at: String(row[4]),
      file_exists: true,
    };
  }

  async deleteBook(bookId: string): Promise<void> {
    await this.init();
    const validId = validateBookId(bookId);
    await this.closeBook(validId);

    this.registryDb.exec({
      sql: "DELETE FROM books WHERE id = ?1",
      bind: [validId],
    });
    await this.persistDatabaseFile("/registry.sqlite", this.registryDb);
    await this.deleteDatabaseFile(this.bookVirtualPath(validId));
  }

  async openBook(bookId: string): Promise<BookMetadata> {
    await this.init();
    const validId = validateBookId(bookId);
    await this.getOrOpenBook(validId);
    void this.syncEngine.startTopicSyncForBook(validId);

    const row = this.registryDb.selectArray(
      "SELECT id, name, kind, created_at, last_opened_at FROM books WHERE id = ?1",
      [validId]
    );
    if (!row) {
      throw new TauriCommandError(
        "BOOK_NOT_FOUND",
        `Book not found: ${validId}`
      );
    }
    return {
      id: String(row[0]),
      name: String(row[1]),
      kind: String(row[2]),
      created_at: String(row[3]),
      last_opened_at: String(row[4]),
      file_exists: true,
    };
  }

  async closeBook(bookId: string): Promise<void> {
    await this.init();
    const validId = validateBookId(bookId);
    const conn = this.bookPool.get(validId);
    if (conn) {
      await this.persistDatabaseFile(this.bookVirtualPath(validId), conn);
      conn.close();
      this.bookPool.delete(validId);
    }
  }

  async exportBookEncryptedBytes(
    bookId: string,
    passphrase: string
  ): Promise<Uint8Array> {
    const validId = validateBookId(bookId);
    const db = await this.getOrOpenBook(validId);
    const plainBytes = this.sqlite3.capi.sqlite3_js_db_export(db);
    return encryptBookSnapshotBytes(new Uint8Array(plainBytes), passphrase);
  }

  async importBookEncryptedBytes(
    encryptedBytes: Uint8Array,
    passphrase: string,
    overrideKind?: BookKind
  ): Promise<BookMetadata> {
    await this.init();
    const sqliteBytes = await decryptBookSnapshotBytes(
      encryptedBytes,
      passphrase
    );

    // Inspect metadata from the decrypted SQLite snapshot
    const tempDb = new this.sqlite3.oo1.DB(":memory:", "c");
    let importedBookId: string;
    let importedBookName: string;
    try {
      const pData = this.sqlite3.wasm.allocFromTypedArray(sqliteBytes);
      const flags =
        this.sqlite3.capi.SQLITE_DESERIALIZE_FREEONCLOSE |
        this.sqlite3.capi.SQLITE_DESERIALIZE_RESIZEABLE;
      const rc = this.sqlite3.capi.sqlite3_deserialize(
        tempDb.pointer!,
        "main",
        pData,
        sqliteBytes.byteLength,
        sqliteBytes.byteLength,
        flags
      );
      tempDb.checkRc(rc);

      const rawId = tempDb.selectValue(
        "SELECT value FROM meta WHERE key = 'book_id'"
      ) as string | undefined;
      const rawName = tempDb.selectValue(
        "SELECT value FROM meta WHERE key = 'book_name'"
      ) as string | undefined;

      importedBookId = rawId ? validateBookId(rawId) : newUuidV7();
      importedBookName = (rawName && rawName.trim()) || "Buku Cadangan";
    } finally {
      tempDb.close();
    }

    await this.closeBook(importedBookId);
    const vPath = this.bookVirtualPath(importedBookId);

    if (this.sahPool) {
      await this.sahPool.reserveMinimumCapacity(
        Math.max(24, this.sahPool.getFileCount() + 4)
      );
      await this.sahPool.importDb(vPath, sqliteBytes);
    } else {
      const copy = new Uint8Array(sqliteBytes);
      this.inMemoryFiles.set(vPath, copy);
      await idbWriteFile(vPath, copy);
    }

    const now = nowIso8601();
    const kind = (overrideKind?.trim() || "PERSONAL").toUpperCase();

    this.registryDb.exec({
      sql: `INSERT INTO books (id, name, kind, created_at, last_opened_at)
            VALUES (?1, ?2, ?3, ?4, ?5)
            ON CONFLICT(id) DO UPDATE SET
               name = excluded.name,
               last_opened_at = excluded.last_opened_at`,
      bind: [importedBookId, importedBookName, kind, now, now],
    });
    await this.persistDatabaseFile("/registry.sqlite", this.registryDb);

    return this.openBook(importedBookId);
  }

  async listAccounts(bookId: string): Promise<AccountView[]> {
    const db = await this.getOrOpenBook(bookId);
    const roots = this.resolveAccountRootsMap(db);
    const rows = db.selectArrays(
      `SELECT id, name, account_type, initial_balance, merged_into_id, is_deleted, updated_hlc
       FROM accounts
       WHERE is_deleted = 0
       ORDER BY name ASC, id ASC`
    );
    return rows.map((r) => {
      const id = String(r[0]);
      return {
        id,
        name: String(r[1]),
        account_type: String(r[2]) as AccountType,
        initial_balance: Number(r[3]),
        merged_into_id: r[4] !== null ? String(r[4]) : null,
        root_id: roots.get(id) ?? id,
        is_deleted: Number(r[5]),
        updated_hlc: String(r[6]),
      };
    });
  }

  async upsertAccount(
    bookId: string,
    input: UpsertAccountInput
  ): Promise<AccountRow> {
    return this.withBookWrite(bookId, (db) =>
      db.transaction("IMMEDIATE", (tx) => {
        const clock = this.loadClockFromDb(tx);
        const hlc = clock.tick(systemNowMs()).toString();
        const deviceId = clock.deviceId();
        const id =
          input.id && input.id.trim() !== "" ? input.id.trim() : newUuidV7();

        const existingMergedInto = tx.selectValue(
          "SELECT merged_into_id FROM accounts WHERE id = ?1",
          [id]
        );

        const row: AccountRow = {
          id,
          name: input.name.trim(),
          account_type: input.account_type.trim().toUpperCase() as AccountType,
          initial_balance: input.initial_balance,
          merged_into_id:
            existingMergedInto !== undefined && existingMergedInto !== null
              ? String(existingMergedInto)
              : null,
          is_deleted: 0,
          updated_hlc: hlc,
        };

        this.writeLocalAccountOp(tx, row, deviceId, bookId);
        this.saveClockToDb(tx, clock);
        return row;
      })
    );
  }

  async deleteAccount(bookId: string, accountId: string): Promise<void> {
    await this.withBookWrite(bookId, (db) => {
      db.transaction("IMMEDIATE", (tx) => {
        const r = tx.selectArray(
          `SELECT id, name, account_type, initial_balance, merged_into_id, is_deleted, updated_hlc
           FROM accounts WHERE id = ?1`,
          [accountId]
        );
        if (!r) {
          throw new TauriCommandError("NOT_FOUND", `Account ${accountId}`);
        }
        const clock = this.loadClockFromDb(tx);
        const row: AccountRow = {
          id: String(r[0]),
          name: String(r[1]),
          account_type: String(r[2]) as AccountType,
          initial_balance: Number(r[3]),
          merged_into_id: r[4] !== null ? String(r[4]) : null,
          is_deleted: 1,
          updated_hlc: clock.tick(systemNowMs()).toString(),
        };
        this.writeLocalAccountOp(tx, row, clock.deviceId(), bookId);
        this.saveClockToDb(tx, clock);
      });
    });
  }

  async mergeAccounts(
    bookId: string,
    sourceId: string,
    targetId: string
  ): Promise<AccountRow> {
    if (sourceId === targetId) {
      throw new TauriCommandError(
        "VALIDATION_ERROR",
        "Cannot merge an account into itself"
      );
    }

    return this.withBookWrite(bookId, (db) => {
      const roots = this.resolveAccountRootsMap(db);
      return db.transaction("IMMEDIATE", (tx) => {
        const targetRow = tx.selectArray(
          "SELECT id, merged_into_id, is_deleted FROM accounts WHERE id = ?1",
          [targetId]
        );
        if (!targetRow) {
          throw new TauriCommandError(
            "NOT_FOUND",
            `Target account ${targetId}`
          );
        }
        if (Number(targetRow[2]) !== 0) {
          throw new TauriCommandError(
            "MERGE_CONFLICT",
            "Target account is deleted"
          );
        }
        const targetRoot = roots.get(targetId) ?? targetId;
        if (targetRow[1] !== null || targetRoot !== targetId) {
          throw new TauriCommandError(
            "MERGE_CONFLICT",
            `Target account '${targetId}' is already merged into '${targetRoot}'; resolve to root first`
          );
        }

        const s = tx.selectArray(
          `SELECT id, name, account_type, initial_balance, merged_into_id, is_deleted, updated_hlc
           FROM accounts WHERE id = ?1`,
          [sourceId]
        );
        if (!s) {
          throw new TauriCommandError(
            "NOT_FOUND",
            `Source account ${sourceId}`
          );
        }

        const clock = this.loadClockFromDb(tx);
        const source: AccountRow = {
          id: String(s[0]),
          name: String(s[1]),
          account_type: String(s[2]) as AccountType,
          initial_balance: Number(s[3]),
          merged_into_id: targetId,
          is_deleted: Number(s[5]),
          updated_hlc: clock.tick(systemNowMs()).toString(),
        };

        this.validateAccountRow(source);
        this.writeLocalAccountOp(tx, source, clock.deviceId(), bookId);
        this.saveClockToDb(tx, clock);
        return source;
      });
    });
  }

  async listCategories(bookId: string): Promise<CategoryView[]> {
    const db = await this.getOrOpenBook(bookId);
    const rows = db.selectArrays(
      `SELECT id, name, normalized_name, kind, merged_into_id, COALESCE(merged_into_id, id) AS canonical_id, is_deleted, updated_hlc
       FROM categories
       WHERE is_deleted = 0
       ORDER BY kind ASC, name ASC, id ASC`
    );
    return rows.map((r) => ({
      id: String(r[0]),
      name: String(r[1]),
      normalized_name: String(r[2]),
      kind: String(r[3]) as CategoryKind,
      merged_into_id: r[4] !== null ? String(r[4]) : null,
      canonical_id: String(r[5]),
      is_deleted: Number(r[6]),
      updated_hlc: String(r[7]),
    }));
  }

  async upsertCategory(
    bookId: string,
    input: UpsertCategoryInput
  ): Promise<CategoryView> {
    return this.withBookWrite(bookId, (db) =>
      db.transaction("IMMEDIATE", (tx) => {
        const clock = this.loadClockFromDb(tx);
        const hlc = clock.tick(systemNowMs()).toString();
        const deviceId = clock.deviceId();
        const id =
          input.id && input.id.trim() !== "" ? input.id.trim() : newUuidV7();
        const trimmedName = input.name.trim();
        const normalizedName = normalizeCategoryName(trimmedName);
        if (!normalizedName) {
          throw new TauriCommandError(
            "VALIDATION_ERROR",
            "Category name must contain at least one alphanumeric character"
          );
        }

        const row: CategoryRowInternal = {
          id,
          name: trimmedName,
          normalized_name: normalizedName,
          kind: input.kind.trim().toUpperCase() as CategoryKind,
          merged_into_id: null,
          is_deleted: 0,
          updated_hlc: hlc,
        };

        this.validateCategoryRow(row);
        this.writeLocalCategoryOp(tx, row, deviceId, bookId);
        this.dedupeCategories(tx);
        this.saveClockToDb(tx, clock);

        const v = tx.selectArray(
          `SELECT id, name, normalized_name, kind, merged_into_id, COALESCE(merged_into_id, id), is_deleted, updated_hlc
           FROM categories WHERE id = ?1`,
          [id]
        );
        if (!v) {
          throw new TauriCommandError("NOT_FOUND", `Category ${id}`);
        }
        return {
          id: String(v[0]),
          name: String(v[1]),
          normalized_name: String(v[2]),
          kind: String(v[3]) as CategoryKind,
          merged_into_id: v[4] !== null ? String(v[4]) : null,
          canonical_id: String(v[5]),
          is_deleted: Number(v[6]),
          updated_hlc: String(v[7]),
        };
      })
    );
  }

  async deleteCategory(bookId: string, categoryId: string): Promise<void> {
    await this.withBookWrite(bookId, (db) => {
      db.transaction("IMMEDIATE", (tx) => {
        const r = tx.selectArray(
          `SELECT id, name, normalized_name, kind, merged_into_id, is_deleted, updated_hlc
           FROM categories WHERE id = ?1`,
          [categoryId]
        );
        if (!r) {
          throw new TauriCommandError("NOT_FOUND", `Category ${categoryId}`);
        }
        const clock = this.loadClockFromDb(tx);
        const row: CategoryRowInternal = {
          id: String(r[0]),
          name: String(r[1]),
          normalized_name: String(r[2]),
          kind: String(r[3]) as CategoryKind,
          merged_into_id: null,
          is_deleted: 1,
          updated_hlc: clock.tick(systemNowMs()).toString(),
        };
        this.writeLocalCategoryOp(tx, row, clock.deviceId(), bookId);
        this.dedupeCategories(tx);
        this.saveClockToDb(tx, clock);
      });
    });
  }

  private addTransactionInDb(
    db: Database,
    input: AddTransactionInput,
    bookId?: string,
  ): TransactionRow {
    return db.transaction("IMMEDIATE", (tx) => {
      const clock = this.loadClockFromDb(tx);
      const hlc = clock.tick(systemNowMs()).toString();
      const deviceId = clock.deviceId();
      const id =
        input.id && input.id.trim() !== "" ? input.id.trim() : newUuidV7();

      const row: TransactionRow = {
        id,
        account_id: input.account_id.trim(),
        to_account_id:
          input.to_account_id && input.to_account_id.trim() !== ""
            ? input.to_account_id.trim()
            : null,
        category_id:
          input.category_id && input.category_id.trim() !== ""
            ? input.category_id.trim()
            : null,
        amount: input.amount,
        tx_type: input.tx_type.trim().toUpperCase() as TransactionType,
        note:
          input.note && input.note.trim() !== "" ? input.note.trim() : null,
        tx_date: input.tx_date.trim(),
        created_by_device: deviceId,
        link_id:
          input.link_id && input.link_id.trim() !== ""
            ? input.link_id.trim()
            : null,
        is_deleted: 0,
        updated_hlc: hlc,
      };

      this.validateTransactionRow(row);
      this.writeLocalTransactionOp(tx, row, deviceId, bookId);
      this.saveClockToDb(tx, clock);
      return row;
    });
  }

  async addTransaction(
    bookId: string,
    input: AddTransactionInput
  ): Promise<TransactionRow> {
    return this.withBookWrite(bookId, (db) =>
      this.addTransactionInDb(db, input, bookId)
    );
  }

  async updateTransaction(
    bookId: string,
    input: UpdateTransactionInput
  ): Promise<TransactionRow> {
    return this.withBookWrite(bookId, (db) =>
      db.transaction("IMMEDIATE", (tx) => {
        const existing = tx.selectArray(
          "SELECT created_by_device, link_id FROM transactions WHERE id = ?1 AND is_deleted = 0",
          [input.id]
        );
        if (!existing) {
          throw new TauriCommandError("NOT_FOUND", `Transaction ${input.id}`);
        }

        const clock = this.loadClockFromDb(tx);
        const hlc = clock.tick(systemNowMs()).toString();
        const deviceId = clock.deviceId();

        const row: TransactionRow = {
          id: input.id,
          account_id: input.account_id.trim(),
          to_account_id:
            input.to_account_id && input.to_account_id.trim() !== ""
              ? input.to_account_id.trim()
              : null,
          category_id:
            input.category_id && input.category_id.trim() !== ""
              ? input.category_id.trim()
              : null,
          amount: input.amount,
          tx_type: input.tx_type.trim().toUpperCase() as TransactionType,
          note:
            input.note && input.note.trim() !== "" ? input.note.trim() : null,
          tx_date: input.tx_date.trim(),
          created_by_device: String(existing[0]),
          link_id: existing[1] !== null ? String(existing[1]) : null,
          is_deleted: 0,
          updated_hlc: hlc,
        };

        this.validateTransactionRow(row);
        this.writeLocalTransactionOp(tx, row, deviceId, bookId);
        this.saveClockToDb(tx, clock);
        return row;
      })
    );
  }

  private deleteTransactionInDb(db: Database, txId: string, bookId?: string): void {
    db.transaction("IMMEDIATE", (tx) => {
      const r = tx.selectArray(
        `SELECT id, account_id, to_account_id, category_id, amount, tx_type, note, tx_date, created_by_device, link_id, is_deleted, updated_hlc
         FROM transactions WHERE id = ?1`,
        [txId]
      );
      if (!r) {
        throw new TauriCommandError("NOT_FOUND", `Transaction ${txId}`);
      }
      const clock = this.loadClockFromDb(tx);
      const row: TransactionRow = {
        id: String(r[0]),
        account_id: String(r[1]),
        to_account_id: r[2] !== null ? String(r[2]) : null,
        category_id: r[3] !== null ? String(r[3]) : null,
        amount: Number(r[4]),
        tx_type: String(r[5]) as TransactionType,
        note: r[6] !== null ? String(r[6]) : null,
        tx_date: String(r[7]),
        created_by_device: String(r[8]),
        link_id: r[9] !== null ? String(r[9]) : null,
        is_deleted: 1,
        updated_hlc: clock.tick(systemNowMs()).toString(),
      };
      this.writeLocalTransactionOp(tx, row, clock.deviceId(), bookId);
      this.saveClockToDb(tx, clock);
    });
  }

  async deleteTransaction(bookId: string, txId: string): Promise<void> {
    await this.withBookWrite(bookId, (db) => {
      this.deleteTransactionInDb(db, txId, bookId);
    });
  }

  private listTransactionsInDb(
    db: Database,
    filter: TransactionFilter
  ): PaginatedTransactions {
    const limit = Math.min(500, Math.max(1, filter.limit ?? 50));
    const offset = Math.max(0, filter.offset ?? 0);

    const whereClauses: string[] = ["t.is_deleted = 0"];
    const sqlParams: SqlValue[] = [];

    if (filter.start_date && filter.start_date.trim() !== "") {
      whereClauses.push("t.tx_date >= ?");
      sqlParams.push(filter.start_date.trim());
    }
    if (filter.end_date && filter.end_date.trim() !== "") {
      whereClauses.push("t.tx_date <= ?");
      sqlParams.push(filter.end_date.trim());
    }
    if (filter.account_id && filter.account_id.trim() !== "") {
      whereClauses.push(
        `(COALESCE(ar_src.root_id, t.account_id) = COALESCE((SELECT root_id FROM account_roots WHERE account_id = ?), ?)
          OR COALESCE(ar_dst.root_id, t.to_account_id) = COALESCE((SELECT root_id FROM account_roots WHERE account_id = ?), ?))`
      );
      const acc = filter.account_id.trim();
      sqlParams.push(acc, acc, acc, acc);
    }
    if (filter.category_id && filter.category_id.trim() !== "") {
      whereClauses.push(
        "COALESCE(c.merged_into_id, t.category_id) = COALESCE((SELECT COALESCE(merged_into_id, id) FROM categories WHERE id = ?), ?)"
      );
      const cat = filter.category_id.trim();
      sqlParams.push(cat, cat);
    }
    if (filter.tx_type && filter.tx_type.trim() !== "") {
      whereClauses.push("t.tx_type = ?");
      sqlParams.push(filter.tx_type.trim().toUpperCase());
    }
    if (filter.min_amount !== undefined && filter.min_amount !== null) {
      whereClauses.push("ABS(t.amount) >= ?");
      sqlParams.push(filter.min_amount);
    }
    if (filter.max_amount !== undefined && filter.max_amount !== null) {
      whereClauses.push("ABS(t.amount) <= ?");
      sqlParams.push(filter.max_amount);
    }
    if (filter.search && filter.search.trim() !== "") {
      whereClauses.push(
        "(COALESCE(t.note, '') LIKE ? OR COALESCE(a_src.name, '') LIKE ? OR COALESCE(c_canon.name, c.name, '') LIKE ?)"
      );
      const pattern = `%${filter.search.trim()}%`;
      sqlParams.push(pattern, pattern, pattern);
    }

    const whereSql = whereClauses.join(" AND ");
    const sortCol =
      filter.sort_by === "amount"
        ? "ABS(t.amount)"
        : filter.sort_by === "updated_hlc"
          ? "t.updated_hlc"
          : "t.tx_date";
    const sortDir =
      filter.sort_dir?.toLowerCase() === "asc" ? "ASC" : "DESC";

    const baseFromSql = `
      FROM transactions t
      LEFT JOIN account_roots ar_src ON ar_src.account_id = t.account_id
      LEFT JOIN accounts a_src ON a_src.id = COALESCE(ar_src.root_id, t.account_id)
      LEFT JOIN account_roots ar_dst ON ar_dst.account_id = t.to_account_id
      LEFT JOIN accounts a_dst ON a_dst.id = COALESCE(ar_dst.root_id, t.to_account_id)
      LEFT JOIN categories c ON c.id = t.category_id
      LEFT JOIN categories c_canon ON c_canon.id = COALESCE(c.merged_into_id, c.id)
      WHERE ${whereSql}`;

    const countSql = `${ACCOUNT_ROOTS_CTE_SQL} SELECT COUNT(*) ${baseFromSql}`;
    const total = Number(
      (sqlParams.length > 0
        ? db.selectValue(countSql, sqlParams)
        : db.selectValue(countSql)) ?? 0
    );

    const selectSql = `
      ${ACCOUNT_ROOTS_CTE_SQL}
      SELECT
        t.id,
        COALESCE(ar_src.root_id, t.account_id) AS resolved_account_id,
        COALESCE(a_src.name, 'Akun tidak diketahui') AS account_name,
        CASE WHEN t.to_account_id IS NULL THEN NULL ELSE COALESCE(ar_dst.root_id, t.to_account_id) END AS resolved_to_account_id,
        CASE WHEN t.to_account_id IS NULL THEN NULL ELSE COALESCE(a_dst.name, 'Akun tidak diketahui') END AS to_account_name,
        CASE WHEN t.category_id IS NULL THEN NULL ELSE COALESCE(c.merged_into_id, t.category_id) END AS resolved_category_id,
        CASE WHEN t.category_id IS NULL THEN NULL ELSE COALESCE(c_canon.name, c.name, 'Kategori tidak diketahui') END AS category_name,
        t.amount,
        t.tx_type,
        t.note,
        t.tx_date,
        t.created_by_device,
        t.link_id,
        t.updated_hlc
      ${baseFromSql}
      ORDER BY ${sortCol} ${sortDir}, t.updated_hlc DESC, t.id DESC
      LIMIT ? OFFSET ?`;

    const rows = db.selectArrays(selectSql, [...sqlParams, limit, offset]);
    const items: TransactionView[] = rows.map((r) => ({
      id: String(r[0]),
      account_id: String(r[1]),
      account_name: String(r[2]),
      to_account_id: r[3] !== null ? String(r[3]) : null,
      to_account_name: r[4] !== null ? String(r[4]) : null,
      category_id: r[5] !== null ? String(r[5]) : null,
      category_name: r[6] !== null ? String(r[6]) : null,
      amount: Number(r[7]),
      tx_type: String(r[8]) as TransactionType,
      note: r[9] !== null ? String(r[9]) : null,
      tx_date: String(r[10]),
      created_by_device: String(r[11]),
      link_id: r[12] !== null ? String(r[12]) : null,
      updated_hlc: String(r[13]),
    }));

    return {
      items,
      total,
      limit,
      offset,
    };
  }

  async listTransactions(
    bookId: string,
    filter: TransactionFilter
  ): Promise<PaginatedTransactions> {
    const db = await this.getOrOpenBook(bookId);
    return this.listTransactionsInDb(db, filter);
  }

  async transferBetweenBooks(
    input: TransferBetweenBooksInput
  ): Promise<TransferBetweenBooksResult> {
    const fromBookId = validateBookId(input.from_book_id);
    const toBookId = validateBookId(input.to_book_id);
    if (fromBookId === toBookId) {
      throw new TauriCommandError(
        "VALIDATION_ERROR",
        "Source and destination books must be different for cross-book transfer"
      );
    }
    if (input.amount <= 0) {
      throw new TauriCommandError(
        "VALIDATION_ERROR",
        "Cross-book transfer amount must be positive (> 0)"
      );
    }

    const linkId =
      input.link_id && input.link_id.trim() !== ""
        ? input.link_id.trim()
        : newUuidV7();

    const expenseTx = await this.withBookWrite(fromBookId, (db) => {
      const existing = db.selectArray(
        `SELECT id, account_id, to_account_id, category_id, amount, tx_type, note, tx_date, created_by_device, link_id, is_deleted, updated_hlc
         FROM transactions
         WHERE link_id = ?1 AND tx_type = 'EXPENSE' AND is_deleted = 0`,
        [linkId]
      );
      if (existing) {
        return {
          id: String(existing[0]),
          account_id: String(existing[1]),
          to_account_id: existing[2] !== null ? String(existing[2]) : null,
          category_id: existing[3] !== null ? String(existing[3]) : null,
          amount: Number(existing[4]),
          tx_type: String(existing[5]) as TransactionType,
          note: existing[6] !== null ? String(existing[6]) : null,
          tx_date: String(existing[7]),
          created_by_device: String(existing[8]),
          link_id: existing[9] !== null ? String(existing[9]) : null,
          is_deleted: Number(existing[10]),
          updated_hlc: String(existing[11]),
        };
      }

      const catId = db.transaction("IMMEDIATE", (tx) =>
        this.ensureSystemCategory(
          tx,
          SYSTEM_CATEGORY_PRIVE_ID,
          SYSTEM_CATEGORY_PRIVE_NAME,
          "EXPENSE"
        )
      );

      return this.addTransactionInDb(
        db,
        {
          id: null,
          account_id: input.from_account_id.trim(),
          to_account_id: null,
          category_id: catId,
          amount: -input.amount,
          tx_type: "EXPENSE",
          note: input.note ?? null,
          tx_date: input.tx_date.trim(),
          link_id: linkId,
        },
        fromBookId
      );
    });

    try {
      const incomeTx = await this.withBookWrite(toBookId, (db) => {
        const existing = db.selectArray(
          `SELECT id, account_id, to_account_id, category_id, amount, tx_type, note, tx_date, created_by_device, link_id, is_deleted, updated_hlc
           FROM transactions
           WHERE link_id = ?1 AND tx_type = 'INCOME' AND is_deleted = 0`,
          [linkId]
        );
        if (existing) {
          return {
            id: String(existing[0]),
            account_id: String(existing[1]),
            to_account_id: existing[2] !== null ? String(existing[2]) : null,
            category_id: existing[3] !== null ? String(existing[3]) : null,
            amount: Number(existing[4]),
            tx_type: String(existing[5]) as TransactionType,
            note: existing[6] !== null ? String(existing[6]) : null,
            tx_date: String(existing[7]),
            created_by_device: String(existing[8]),
            link_id: existing[9] !== null ? String(existing[9]) : null,
            is_deleted: Number(existing[10]),
            updated_hlc: String(existing[11]),
          };
        }

        const catId = db.transaction("IMMEDIATE", (tx) =>
          this.ensureSystemCategory(
            tx,
            SYSTEM_CATEGORY_MODAL_ID,
            SYSTEM_CATEGORY_MODAL_NAME,
            "INCOME"
          )
        );

        return this.addTransactionInDb(
          db,
          {
            id: null,
            account_id: input.to_account_id.trim(),
            to_account_id: null,
            category_id: catId,
            amount: input.amount,
            tx_type: "INCOME",
            note: input.note ?? null,
            tx_date: input.tx_date.trim(),
            link_id: linkId,
          },
          toBookId
        );
      });

      return {
        link_id: linkId,
        expense_tx: expenseTx,
        income_tx: incomeTx,
      };
    } catch (err) {
      await this.withBookWrite(fromBookId, (db) => {
        this.deleteTransactionInDb(db, expenseTx.id);
      }).catch(() => {});
      throw err;
    }
  }

  async getAccountBalances(bookId: string): Promise<AccountBalanceItem[]> {
    const db = await this.getOrOpenBook(bookId);
    const roots = this.resolveAccountRootsMap(db);

    const accRows = db.selectArrays(
      `SELECT id, name, account_type, initial_balance
       FROM accounts
       WHERE is_deleted = 0
       ORDER BY id ASC`
    );

    const activeAccounts = new Map<
      string,
      { id: string; name: string; account_type: AccountType; initial_balance: number }
    >();
    for (const r of accRows) {
      const id = String(r[0]);
      activeAccounts.set(id, {
        id,
        name: String(r[1]),
        account_type: String(r[2]) as AccountType,
        initial_balance: Number(r[3]),
      });
    }

    const rootItems = new Map<string, AccountBalanceItem>();
    for (const [accId, acc] of activeAccounts.entries()) {
      const rootId = roots.get(accId) ?? accId;
      const rootMeta = activeAccounts.get(rootId) ?? acc;

      let entry = rootItems.get(rootId);
      if (!entry) {
        entry = {
          account_id: rootId,
          name: rootMeta.name,
          account_type: rootMeta.account_type,
          initial_balance: 0,
          current_balance: 0,
          merged_member_ids: [],
        };
        rootItems.set(rootId, entry);
      }

      entry.initial_balance += acc.initial_balance;
      entry.current_balance += acc.initial_balance;
      if (accId !== rootId) {
        entry.merged_member_ids.push(accId);
      }
    }

    const txRows = db.selectArrays(
      `SELECT account_id, to_account_id, amount, tx_type
       FROM transactions
       WHERE is_deleted = 0`
    );

    for (const r of txRows) {
      const accId = String(r[0]);
      const toAccId = r[1] !== null ? String(r[1]) : null;
      const amount = Number(r[2]);
      const txType = String(r[3]);
      const srcRoot = roots.get(accId) ?? accId;

      if (txType === "INCOME" || txType === "EXPENSE") {
        const item = rootItems.get(srcRoot);
        if (item) {
          item.current_balance += amount;
        }
      } else if (txType === "TRANSFER") {
        const srcItem = rootItems.get(srcRoot);
        if (srcItem) {
          srcItem.current_balance -= amount;
        }
        if (toAccId) {
          const dstRoot = roots.get(toAccId) ?? toAccId;
          const dstItem = rootItems.get(dstRoot);
          if (dstItem) {
            dstItem.current_balance += amount;
          }
        }
      }
    }

    const result = Array.from(rootItems.values());
    result.sort(
      (a, b) =>
        a.name.localeCompare(b.name) || a.account_id.localeCompare(b.account_id)
    );
    return result;
  }

  async getCashFlowSummary(
    bookId: string,
    monthsLimit?: number
  ): Promise<CashFlowMonthItem[]> {
    const db = await this.getOrOpenBook(bookId);
    const limit = Math.min(36, Math.max(1, monthsLimit ?? 6));
    const rows = db.selectArrays(
      `SELECT
          substr(tx_date, 1, 7) AS month,
          COALESCE(SUM(CASE WHEN tx_type = 'INCOME' THEN amount ELSE 0 END), 0) AS income,
          COALESCE(SUM(CASE WHEN tx_type = 'EXPENSE' THEN -amount ELSE 0 END), 0) AS expense
       FROM transactions
       WHERE is_deleted = 0
         AND tx_type IN ('INCOME', 'EXPENSE')
       GROUP BY substr(tx_date, 1, 7)
       ORDER BY month DESC
       LIMIT ?1`,
      [limit]
    );

    const items: CashFlowMonthItem[] = rows.map((r) => {
      const income = Number(r[1]);
      const expense = Number(r[2]);
      return {
        month: String(r[0]),
        income,
        expense,
        net: income - expense,
      };
    });
    items.reverse();
    return items;
  }

  async listBudgets(bookId: string): Promise<BudgetRow[]> {
    const db = await this.getOrOpenBook(bookId);
    const rows = db.selectArrays(
      `WITH active_budgets_raw AS (
          SELECT
              b.id,
              CASE
                  WHEN b.category_id IS NULL THEN NULL
                  ELSE COALESCE(c.merged_into_id, c.id)
              END AS resolved_category_id,
              b.period,
              b.amount_limit,
              b.alert_threshold_pct,
              b.is_deleted,
              b.updated_hlc,
              ROW_NUMBER() OVER (
                  PARTITION BY
                      CASE
                          WHEN b.category_id IS NULL THEN '__ALL__'
                          ELSE COALESCE(c.merged_into_id, c.id)
                      END,
                      b.period
                  ORDER BY b.updated_hlc DESC, b.id ASC
              ) AS rn
          FROM budgets b
          LEFT JOIN categories c ON b.category_id = c.id
          LEFT JOIN categories c_canon ON c_canon.id = COALESCE(c.merged_into_id, c.id)
          WHERE b.is_deleted = 0
            AND (
                b.category_id IS NULL
                OR (c.id IS NOT NULL AND c.is_deleted = 0 AND c_canon.is_deleted = 0)
            )
      )
      SELECT id, resolved_category_id, period, amount_limit, alert_threshold_pct, is_deleted, updated_hlc
      FROM active_budgets_raw
      WHERE rn = 1
      ORDER BY resolved_category_id IS NOT NULL ASC, id ASC`
    );

    return rows.map((r) => ({
      id: String(r[0]),
      category_id: r[1] !== null ? String(r[1]) : null,
      period: String(r[2]) as BudgetPeriod,
      amount_limit: Number(r[3]),
      alert_threshold_pct: Number(r[4]),
      is_deleted: Number(r[5]),
      updated_hlc: String(r[6]),
    }));
  }

  async upsertBudget(
    bookId: string,
    input: UpsertBudgetInput
  ): Promise<BudgetRow> {
    return this.withBookWrite(bookId, (db) =>
      db.transaction("IMMEDIATE", (tx) => {
        const period = (input.period?.trim() || "MONTHLY").toUpperCase() as BudgetPeriod;
        const alertThresholdPct = input.alert_threshold_pct ?? 80;
        const categoryId =
          input.category_id && input.category_id.trim() !== ""
            ? input.category_id.trim()
            : null;

        if (categoryId) {
          const catKind = tx.selectValue(
            "SELECT kind FROM categories WHERE id = ?1",
            [categoryId]
          );
          if (catKind && String(catKind) !== "EXPENSE") {
            throw new TauriCommandError(
              "VALIDATION_ERROR",
              "Budgets can only be created for EXPENSE categories"
            );
          }
        }

        const id = deterministicBudgetId(categoryId, period);
        const clock = this.loadClockFromDb(tx);
        const hlc = clock.tick(systemNowMs()).toString();
        const deviceId = clock.deviceId();

        const row: BudgetRow = {
          id,
          category_id: categoryId,
          period,
          amount_limit: input.amount_limit,
          alert_threshold_pct: alertThresholdPct,
          is_deleted: 0,
          updated_hlc: hlc,
        };

        this.validateBudgetRow(row);
        this.writeLocalBudgetOp(tx, row, deviceId, bookId);
        this.saveClockToDb(tx, clock);
        return row;
      })
    );
  }

  async deleteBudget(bookId: string, budgetId: string): Promise<void> {
    await this.withBookWrite(bookId, (db) => {
      db.transaction("IMMEDIATE", (tx) => {
        const r = tx.selectArray(
          `SELECT id, category_id, period, amount_limit, alert_threshold_pct, is_deleted, updated_hlc
           FROM budgets WHERE id = ?1`,
          [budgetId]
        );
        if (!r) {
          throw new TauriCommandError("NOT_FOUND", `Budget ${budgetId}`);
        }
        const clock = this.loadClockFromDb(tx);
        const row: BudgetRow = {
          id: String(r[0]),
          category_id: r[1] !== null ? String(r[1]) : null,
          period: String(r[2]) as BudgetPeriod,
          amount_limit: Number(r[3]),
          alert_threshold_pct: Number(r[4]),
          is_deleted: 1,
          updated_hlc: clock.tick(systemNowMs()).toString(),
        };
        this.writeLocalBudgetOp(tx, row, clock.deviceId(), bookId);
        this.saveClockToDb(tx, clock);
      });
    });
  }

  private getBudgetProgressInDb(
    db: Database,
    month: string
  ): BudgetProgressItem[] {
    const [startDate, endDate] = parseMonthBounds(month);
    const priveNorm = normalizeCategoryName(SYSTEM_CATEGORY_PRIVE_NAME);

    const rows = db.selectArrays(
      `WITH active_budgets_raw AS (
          SELECT
              b.id,
              CASE
                  WHEN b.category_id IS NULL THEN NULL
                  ELSE COALESCE(c.merged_into_id, c.id)
              END AS resolved_category_id,
              b.period,
              b.amount_limit,
              b.alert_threshold_pct,
              b.updated_hlc,
              ROW_NUMBER() OVER (
                  PARTITION BY
                      CASE
                          WHEN b.category_id IS NULL THEN '__ALL__'
                          ELSE COALESCE(c.merged_into_id, c.id)
                      END,
                      b.period
                  ORDER BY b.updated_hlc DESC, b.id ASC
              ) AS rn
          FROM budgets b
          LEFT JOIN categories c ON b.category_id = c.id
          LEFT JOIN categories c_canon ON c_canon.id = COALESCE(c.merged_into_id, c.id)
          WHERE b.is_deleted = 0
            AND b.period = 'MONTHLY'
            AND (
                b.category_id IS NULL
                OR (c.id IS NOT NULL AND c.is_deleted = 0 AND c_canon.is_deleted = 0)
            )
      ),
      deduped_budgets AS (
          SELECT
              ab.id,
              ab.resolved_category_id AS category_id,
              COALESCE(c_canon.name, 'Total Pengeluaran') AS category_name,
              ab.period,
              ab.amount_limit,
              ab.alert_threshold_pct,
              ab.updated_hlc
          FROM active_budgets_raw ab
          LEFT JOIN categories c_canon ON ab.resolved_category_id = c_canon.id
          WHERE ab.rn = 1
      ),
      tx_resolved AS (
          SELECT
              t.amount,
              COALESCE(c.merged_into_id, t.category_id) AS resolved_cat_id,
              COALESCE(c_canon.normalized_name, c.normalized_name, '') AS resolved_norm_name
          FROM transactions t
          LEFT JOIN categories c ON t.category_id = c.id
          LEFT JOIN categories c_canon ON c_canon.id = COALESCE(c.merged_into_id, c.id)
          WHERE t.is_deleted = 0
            AND t.tx_type = 'EXPENSE'
            AND t.tx_date >= ?1
            AND t.tx_date < ?2
      )
      SELECT
          db.id,
          db.category_id,
          db.category_name,
          db.period,
          db.amount_limit,
          db.alert_threshold_pct,
          db.updated_hlc,
          COALESCE((
              SELECT SUM(-tr.amount)
              FROM tx_resolved tr
              WHERE (
                  (db.category_id IS NOT NULL AND tr.resolved_cat_id = db.category_id)
                  OR (
                      db.category_id IS NULL
                      AND (tr.resolved_cat_id IS NULL OR tr.resolved_cat_id != ?3)
                      AND tr.resolved_norm_name != ?4
                  )
              )
          ), 0) AS spent
      FROM deduped_budgets db`,
      [startDate, endDate, SYSTEM_CATEGORY_PRIVE_ID, priveNorm]
    );

    const items: BudgetProgressItem[] = rows.map((r) => {
      const id = String(r[0]);
      const categoryId = r[1] !== null ? String(r[1]) : null;
      const categoryName = String(r[2]);
      const period = String(r[3]) as BudgetPeriod;
      const amountLimit = Number(r[4]);
      const alertThresholdPct = Number(r[5]);
      const updatedHlc = String(r[6]);
      const spent = Math.max(0, Number(r[7]));
      const remaining = amountLimit - spent;
      const pct = Math.trunc((spent * 100) / amountLimit);
      const status: BudgetStatus =
        pct < alertThresholdPct ? "OK" : pct <= 100 ? "WARNING" : "OVER";

      return {
        id,
        category_id: categoryId,
        category_name: categoryName,
        period,
        amount_limit: amountLimit,
        alert_threshold_pct: alertThresholdPct,
        spent,
        remaining,
        pct,
        status,
        updated_hlc: updatedHlc,
      };
    });

    items.sort((a, b) => b.pct - a.pct || a.id.localeCompare(b.id));
    return items;
  }

  async getBudgetProgress(
    bookId: string,
    month: string
  ): Promise<BudgetProgressItem[]> {
    const db = await this.getOrOpenBook(bookId);
    return this.getBudgetProgressInDb(db, month);
  }

  async getMonthlyReport(
    bookId: string,
    month: string
  ): Promise<MonthlyReportResponse> {
    const db = await this.getOrOpenBook(bookId);
    const trimmedMonth = month.trim();
    const [startDate, endDate] = parseMonthBounds(trimmedMonth);
    const prevMonth = previousYearMonth(trimmedMonth);
    const [prevStartDate, prevEndDate] = parseMonthBounds(prevMonth);

    const year = Number(trimmedMonth.slice(0, 4));
    const monthNum = Number(trimmedMonth.slice(5, 7));
    const daysInMonth = daysInYearMonth(year, monthNum);

    const priveNorm = normalizeCategoryName(SYSTEM_CATEGORY_PRIVE_NAME);
    const modalNorm = normalizeCategoryName(SYSTEM_CATEGORY_MODAL_NAME);

    // 1. Resolve canonical category metadata
    const catMeta = new Map<
      string,
      { canonId: string; canonName: string; canonNorm: string }
    >();
    const catRows = db.selectArrays(
      `SELECT
          c.id,
          COALESCE(c_canon.id, c.id) AS canonical_id,
          COALESCE(c_canon.name, c.name) AS canonical_name,
          COALESCE(c_canon.normalized_name, c.normalized_name) AS canonical_norm
       FROM categories c
       LEFT JOIN categories c_canon ON c_canon.id = COALESCE(c.merged_into_id, c.id)`
    );
    for (const r of catRows) {
      const rawId = String(r[0]);
      const canonId = String(r[1]);
      const canonName = String(r[2]);
      const canonNorm = String(r[3]);
      catMeta.set(rawId, { canonId, canonName, canonNorm });
      if (!catMeta.has(canonId)) {
        catMeta.set(canonId, { canonId, canonName, canonNorm });
      }
    }

    // 2. Scan previous month transactions
    let prevOperationalIncome = 0;
    let prevOperationalExpense = 0;
    const prevCatTotals = new Map<string, number>();

    const prevTxRows = db.selectArrays(
      `SELECT category_id, amount, tx_type
       FROM transactions
       WHERE is_deleted = 0
         AND tx_date >= ?1
         AND tx_date < ?2
         AND tx_type IN ('INCOME', 'EXPENSE')`,
      [prevStartDate, prevEndDate]
    );
    for (const r of prevTxRows) {
      const catIdOpt = r[0] !== null ? String(r[0]) : null;
      const amount = Number(r[1]);
      const txType = String(r[2]);
      const meta = (catIdOpt && catMeta.get(catIdOpt)) || {
        canonId: "__UNCATEGORIZED__",
        canonName: "Tanpa Kategori",
        canonNorm: "",
      };
      const absAmt = Math.abs(amount);
      const isSys =
        meta.canonId === SYSTEM_CATEGORY_PRIVE_ID ||
        meta.canonId === SYSTEM_CATEGORY_MODAL_ID ||
        meta.canonNorm === priveNorm ||
        meta.canonNorm === modalNorm;

      if (txType === "INCOME" && !isSys) {
        prevOperationalIncome += absAmt;
      } else if (txType === "EXPENSE" && !isSys) {
        prevOperationalExpense += absAmt;
      }
      const key = `${meta.canonId}:::${txType}`;
      prevCatTotals.set(key, (prevCatTotals.get(key) ?? 0) + absAmt);
    }

    // 3. Scan current month transactions
    const dailyIncome = new Array<number>(daysInMonth).fill(0);
    const dailyExpense = new Array<number>(daysInMonth).fill(0);
    const dailyTxCount = new Array<number>(daysInMonth).fill(0);

    let operationalIncome = 0;
    let operationalExpense = 0;
    let capitalInjection = 0;
    let capitalWithdrawal = 0;
    let txCount = 0;
    let maxActiveDay = 1;

    const currCatMap = new Map<
      string,
      {
        canonId: string;
        kind: CategoryKind;
        canonName: string;
        isSystem: boolean;
        currentAmount: number;
        txCount: number;
      }
    >();
    const deviceMap = new Map<
      string,
      { txCount: number; income: number; expense: number }
    >();

    const currTxRows = db.selectArrays(
      `SELECT category_id, amount, tx_type, tx_date, created_by_device
       FROM transactions
       WHERE is_deleted = 0
         AND tx_date >= ?1
         AND tx_date < ?2`,
      [startDate, endDate]
    );

    for (const r of currTxRows) {
      const catIdOpt = r[0] !== null ? String(r[0]) : null;
      const amount = Number(r[1]);
      const txType = String(r[2]);
      const txDate = String(r[3]);
      const deviceId = String(r[4]);

      txCount += 1;
      const parsedDay = Number(txDate.slice(8, 10));
      const dayNum = Math.min(
        daysInMonth,
        Math.max(1, Number.isFinite(parsedDay) ? parsedDay : 1)
      );
      maxActiveDay = Math.max(maxActiveDay, dayNum);
      const dayIdx = dayNum - 1;
      dailyTxCount[dayIdx] += 1;

      const absAmt = Math.abs(amount);
      const devEntry = deviceMap.get(deviceId) ?? {
        txCount: 0,
        income: 0,
        expense: 0,
      };
      devEntry.txCount += 1;
      deviceMap.set(deviceId, devEntry);

      if (txType === "INCOME" || txType === "EXPENSE") {
        const meta = (catIdOpt && catMeta.get(catIdOpt)) || {
          canonId: "__UNCATEGORIZED__",
          canonName: "Tanpa Kategori",
          canonNorm: "",
        };
        const isPrive =
          meta.canonId === SYSTEM_CATEGORY_PRIVE_ID ||
          meta.canonNorm === priveNorm;
        const isModal =
          meta.canonId === SYSTEM_CATEGORY_MODAL_ID ||
          meta.canonNorm === modalNorm;
        const isSys = isPrive || isModal;

        if (txType === "INCOME") {
          devEntry.income += absAmt;
          if (isModal) {
            capitalInjection += absAmt;
          } else {
            operationalIncome += absAmt;
            dailyIncome[dayIdx] += absAmt;
          }
        } else {
          devEntry.expense += absAmt;
          if (isPrive) {
            capitalWithdrawal += absAmt;
          } else {
            operationalExpense += absAmt;
            dailyExpense[dayIdx] += absAmt;
          }
        }

        const key = `${meta.canonId}:::${txType}`;
        const catEntry = currCatMap.get(key) ?? {
          canonId: meta.canonId,
          kind: txType as CategoryKind,
          canonName: meta.canonName,
          isSystem: isSys,
          currentAmount: 0,
          txCount: 0,
        };
        catEntry.currentAmount += absAmt;
        catEntry.txCount += 1;
        currCatMap.set(key, catEntry);
      }
    }

    for (const key of prevCatTotals.keys()) {
      if (!currCatMap.has(key)) {
        const [prevCatId, prevKind] = key.split(":::");
        const meta = catMeta.get(prevCatId) ?? {
          canonId: prevCatId,
          canonName: "Kategori Lainnya",
          canonNorm: "",
        };
        const isSys =
          meta.canonId === SYSTEM_CATEGORY_PRIVE_ID ||
          meta.canonId === SYSTEM_CATEGORY_MODAL_ID ||
          meta.canonNorm === priveNorm ||
          meta.canonNorm === modalNorm;
        currCatMap.set(key, {
          canonId: prevCatId,
          kind: prevKind as CategoryKind,
          canonName: meta.canonName,
          isSystem: isSys,
          currentAmount: 0,
          txCount: 0,
        });
      }
    }

    // Build daily series
    const dailySeries: DailyCashFlowPoint[] = [];
    let cumInc = 0;
    let cumExp = 0;
    for (let d = 1; d <= daysInMonth; d++) {
      const idx = d - 1;
      const inc = dailyIncome[idx];
      const exp = dailyExpense[idx];
      cumInc += inc;
      cumExp += exp;
      dailySeries.push({
        date: `${trimmedMonth}-${d.toString().padStart(2, "0")}`,
        day: d,
        income: inc,
        expense: exp,
        net: inc - exp,
        cumulative_income: cumInc,
        cumulative_expense: cumExp,
        tx_count: dailyTxCount[idx],
      });
    }

    const nowStr = nowIso8601();
    const currentYm = nowStr.slice(0, 7);
    const todayDay = Number(nowStr.slice(8, 10)) || daysInMonth;

    const elapsedDays =
      trimmedMonth < currentYm
        ? daysInMonth
        : trimmedMonth === currentYm
          ? Math.min(daysInMonth, Math.max(1, Math.max(todayDay, maxActiveDay)))
          : Math.min(daysInMonth, Math.max(1, maxActiveDay));

    let noSpendDays = 0;
    for (let d = 1; d <= elapsedDays; d++) {
      if (dailyExpense[d - 1] === 0) {
        noSpendDays += 1;
      }
    }

    const operationalNet = operationalIncome - operationalExpense;
    const savingsRateBps =
      operationalIncome > 0
        ? Math.trunc((operationalNet * 10_000) / operationalIncome)
        : 0;
    const dailyBurnRate = Math.trunc(
      operationalExpense / Math.max(1, elapsedDays)
    );
    const projectedMonthExpense = dailyBurnRate * daysInMonth;

    const budgetProgress = this.getBudgetProgressInDb(db, trimmedMonth);
    const allBudget = budgetProgress.find((b) => b.category_id === null);
    const totalBudgetLimit = allBudget
      ? allBudget.amount_limit
      : budgetProgress.length > 0
        ? budgetProgress.reduce((acc, b) => acc + b.amount_limit, 0)
        : null;

    const totalExpAll = operationalExpense + capitalWithdrawal;
    const totalIncAll = operationalIncome + capitalInjection;

    const categoryBreakdown: CategoryMonthlyBreakdownItem[] = [];
    for (const [key, item] of currCatMap.entries()) {
      const prevAmt = prevCatTotals.get(key) ?? 0;
      const deltaAmount = item.currentAmount - prevAmt;
      const deltaPct =
        prevAmt > 0 ? Math.trunc((deltaAmount * 100) / prevAmt) : null;
      const denom = item.kind === "EXPENSE" ? totalExpAll : totalIncAll;
      const shareBps =
        denom > 0 ? Math.trunc((item.currentAmount * 10_000) / denom) : 0;

      categoryBreakdown.push({
        category_id: item.canonId,
        category_name: item.canonName,
        kind: item.kind,
        is_system: item.isSystem,
        current_amount: item.currentAmount,
        prev_amount: prevAmt,
        delta_amount: deltaAmount,
        delta_pct: deltaPct,
        share_bps: shareBps,
        tx_count: item.txCount,
      });
    }
    categoryBreakdown.sort(
      (a, b) =>
        a.kind.localeCompare(b.kind) ||
        b.current_amount - a.current_amount ||
        b.prev_amount - a.prev_amount ||
        a.category_name.localeCompare(b.category_name)
    );

    // 4. Account Reconciliation
    const roots = this.resolveAccountRootsMap(db);
    const reconMap = new Map<string, AccountReconciliationItem>();
    const allAccs = db.selectArrays(
      `SELECT id, name, account_type, initial_balance, merged_into_id
       FROM accounts
       WHERE is_deleted = 0`
    );

    for (const r of allAccs) {
      const id = String(r[0]);
      const name = String(r[1]);
      const accType = String(r[2]) as AccountType;
      const initBal = Number(r[3]);
      const mergedInto = r[4] !== null ? String(r[4]) : null;
      const rootId = roots.get(id) ?? id;

      if (mergedInto === null || rootId === id) {
        const entry = reconMap.get(rootId) ?? {
          account_id: rootId,
          account_name: name,
          account_type: accType,
          opening_balance: 0,
          month_inflow: 0,
          month_outflow: 0,
          net_change: 0,
          closing_balance: 0,
          tx_count: 0,
        };
        entry.account_name = name;
        entry.account_type = accType;
        entry.opening_balance += initBal;
        reconMap.set(rootId, entry);
      }
    }
    for (const r of allAccs) {
      const id = String(r[0]);
      const initBal = Number(r[3]);
      const mergedInto = r[4] !== null ? String(r[4]) : null;
      if (mergedInto !== null) {
        const rootId = roots.get(id) ?? id;
        if (rootId !== id) {
          const rootItem = reconMap.get(rootId);
          if (rootItem) {
            rootItem.opening_balance += initBal;
          }
        }
      }
    }

    const reconTxRows = db.selectArrays(
      `SELECT account_id, to_account_id, amount, tx_type, tx_date
       FROM transactions
       WHERE is_deleted = 0
         AND tx_date < ?1`,
      [endDate]
    );
    for (const r of reconTxRows) {
      const accId = String(r[0]);
      const toAccId = r[1] !== null ? String(r[1]) : null;
      const amount = Number(r[2]);
      const txType = String(r[3]);
      const txDate = String(r[4]);
      const srcRoot = roots.get(accId) ?? accId;
      const isBeforeMonth = txDate < startDate;
      const absAmt = Math.abs(amount);

      if (isBeforeMonth) {
        if (txType === "INCOME" || txType === "EXPENSE") {
          const item = reconMap.get(srcRoot);
          if (item) item.opening_balance += amount;
        } else if (txType === "TRANSFER") {
          const item = reconMap.get(srcRoot);
          if (item) item.opening_balance -= absAmt;
          if (toAccId) {
            const dstRoot = roots.get(toAccId) ?? toAccId;
            const dstItem = reconMap.get(dstRoot);
            if (dstItem) dstItem.opening_balance += absAmt;
          }
        }
      } else {
        if (txType === "INCOME") {
          const item = reconMap.get(srcRoot);
          if (item) {
            item.month_inflow += absAmt;
            item.tx_count += 1;
          }
        } else if (txType === "EXPENSE") {
          const item = reconMap.get(srcRoot);
          if (item) {
            item.month_outflow += absAmt;
            item.tx_count += 1;
          }
        } else if (txType === "TRANSFER") {
          const item = reconMap.get(srcRoot);
          if (item) {
            item.month_outflow += absAmt;
            item.tx_count += 1;
          }
          if (toAccId) {
            const dstRoot = roots.get(toAccId) ?? toAccId;
            const dstItem = reconMap.get(dstRoot);
            if (dstItem) {
              dstItem.month_inflow += absAmt;
              dstItem.tx_count += 1;
            }
          }
        }
      }
    }

    const accountReconciliation = Array.from(reconMap.values()).map((item) => {
      const netChange = item.month_inflow - item.month_outflow;
      return {
        ...item,
        net_change: netChange,
        closing_balance: item.opening_balance + netChange,
      };
    });
    accountReconciliation.sort(
      (a, b) =>
        a.account_name.localeCompare(b.account_name) ||
        a.account_id.localeCompare(b.account_id)
    );

    // 5. Device Contributions
    const totalDevTx = Math.max(1, txCount);
    const localDevId = (db.selectValue("SELECT value FROM meta WHERE key = 'device_id'") as string) || null;
    const localDevName = (db.selectValue("SELECT value FROM meta WHERE key = 'device_name'") as string) || null;
    const peerNameRows = db.selectArrays(
      "SELECT device_id, device_name, custom_alias FROM sync_peers WHERE device_id IS NOT NULL"
    );
    const peerNameMap = new Map<string, string>();
    for (const r of peerNameRows) {
      const devId = String(r[0]);
      const aliasOrName = r[2] !== null ? String(r[2]) : r[1] !== null ? String(r[1]) : null;
      if (aliasOrName) {
        peerNameMap.set(devId, aliasOrName);
      }
    }

    const deviceContributions: DeviceContributionItem[] = Array.from(
      deviceMap.entries()
    ).map(([deviceId, stats]) => {
      const resolvedName = deviceId === localDevId ? localDevName : peerNameMap.get(deviceId) || null;
      return {
        device_id: deviceId,
        device_name: resolvedName,
        tx_count: stats.txCount,
        total_income: stats.income,
        total_expense: stats.expense,
        share_bps: Math.trunc((stats.txCount * 10_000) / totalDevTx),
      };
    });
    deviceContributions.sort(
      (a, b) =>
        b.tx_count - a.tx_count || a.device_id.localeCompare(b.device_id)
    );

    // 6. Top 5 Expenses in Month
    const monthEndInclusive = `${trimmedMonth}-${daysInMonth
      .toString()
      .padStart(2, "0")}`;
    const topTxPage = this.listTransactionsInDb(db, {
      start_date: startDate,
      end_date: monthEndInclusive,
      tx_type: "EXPENSE",
      sort_by: "amount",
      sort_dir: "desc",
      limit: 5,
      offset: 0,
    });

    return {
      month: trimmedMonth,
      prev_month: prevMonth,
      days_in_month: daysInMonth,
      elapsed_days: elapsedDays,
      no_spend_days: noSpendDays,
      tx_count: txCount,
      operational_income: operationalIncome,
      operational_expense: operationalExpense,
      operational_net: operationalNet,
      prev_operational_income: prevOperationalIncome,
      prev_operational_expense: prevOperationalExpense,
      capital_injection: capitalInjection,
      capital_withdrawal: capitalWithdrawal,
      savings_rate_bps: savingsRateBps,
      daily_burn_rate: dailyBurnRate,
      projected_month_expense: projectedMonthExpense,
      total_budget_limit: totalBudgetLimit,
      daily_series: dailySeries,
      category_breakdown: categoryBreakdown,
      account_reconciliation: accountReconciliation,
      device_contributions: deviceContributions,
      top_expenses: topTxPage.items,
    };
  }

  // ==========================================================================
  // Sync Engine Delegations (Langkah 3: WebRTC DataChannel + CRDT Sync)
  // ==========================================================================

  async getSyncStatus(bookId: string): Promise<SyncStatusPayload> {
    await this.init();
    return this.syncEngine.getSyncStatus(bookId);
  }

  async createInvite(
    bookId: string,
    ttlSecs?: number
  ): Promise<InviteResponse> {
    await this.init();
    return this.syncEngine.createInvite(bookId, ttlSecs);
  }

  async joinBookFromInvite(
    inviteQr: string,
    kind?: BookKind
  ): Promise<BookMetadata> {
    await this.init();
    return this.syncEngine.joinBookFromInvite(inviteQr, kind);
  }

  async listPeers(bookId: string): Promise<PeerInfo[]> {
    await this.init();
    return this.syncEngine.listPeers(bookId);
  }

  async getSyncTopology(bookId: string): Promise<SyncTopologyInfo> {
    await this.init();
    return this.syncEngine.getSyncTopology(bookId);
  }

  async setPreferredHub(
    bookId: string,
    hubNodeId: string | null
  ): Promise<SyncTopologyInfo> {
    const validId = validateBookId(bookId);
    const cleanHub = hubNodeId && hubNodeId.trim() !== "" ? hubNodeId.trim() : null;

    await this.withBookWrite(validId, (db) => {
      if (cleanHub) {
        db.exec({
          sql: `INSERT INTO meta (key, value) VALUES ('preferred_hub_node_id', ?1)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
          bind: [cleanHub],
        });
      } else {
        db.exec("DELETE FROM meta WHERE key = 'preferred_hub_node_id'");
      }
    });

    return this.syncEngine.getSyncTopology(validId);
  }

  async triggerManualSync(bookId: string): Promise<void> {
    await this.init();
    return this.syncEngine.triggerManualSync(bookId);
  }

  async setAppForeground(isForeground: boolean): Promise<void> {
    await this.init();
    return this.syncEngine.setAppForeground(isForeground);
  }

  async getOrCreateBookKey(bookId: string): Promise<string> {
    const validId = validateBookId(bookId);
    return await this.withBookWrite(validId, (db) => {
      let key = db.selectValue(
        "SELECT value FROM meta WHERE key = 'book_key'",
      ) as string | undefined;

      if (!key || key.trim().length !== 64) {
        key = randomHex(32);
        db.exec({
          sql: `INSERT INTO meta (key, value) VALUES ('book_key', ?1)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
          bind: [key],
        });
      }
      return key;
    });
  }

  async getSyncMeta(bookId: string): Promise<{
    bookId: string;
    bookName: string;
    bookKey: string;
    localNodeId: string;
    preferredHubNodeId: string | null;
  }> {
    await this.init();
    const validId = validateBookId(bookId);
    const registry = this.registryDb;
    const bookName = registry.selectValue(
      "SELECT name FROM books WHERE id = ?1",
      [validId],
    ) as string | undefined;

    if (!bookName) {
      throw new TauriCommandError("BOOK_NOT_FOUND", `Buku tidak ditemukan: ${validId}`);
    }

    const bookKey = await this.getOrCreateBookKey(validId);
    const bookDb = await this.getOrOpenBook(validId);
    const prefHub = bookDb.selectValue(
      "SELECT value FROM meta WHERE key = 'preferred_hub_node_id'",
    ) as string | undefined;

    return {
      bookId: validId,
      bookName,
      bookKey,
      localNodeId: this.localNodeId,
      preferredHubNodeId: prefHub && prefHub.trim() !== "" ? prefHub : null,
    };
  }

  async syncJoinBook(args: {
    bookId: string;
    bookName: string;
    bookKey?: string;
    kind?: BookKind;
  }): Promise<BookMetadata> {
    await this.init();
    const validId = validateBookId(args.bookId);
    const bookName = args.bookName.trim();
    const bookKind = (args.kind?.trim() || "PERSONAL").toUpperCase();
    const now = nowIso8601();

    const registry = this.registryDb;
    registry.exec({
      sql: `INSERT INTO books (id, name, kind, created_at, last_opened_at)
            VALUES (?1, ?2, ?3, ?4, ?5)
            ON CONFLICT(id) DO UPDATE SET
               name = excluded.name,
               last_opened_at = excluded.last_opened_at`,
      bind: [validId, bookName, bookKind, now, now],
    });
    await this.persistDatabaseFile("/registry.sqlite", registry);

    const vPath = this.bookVirtualPath(validId);
    const bookDb = await this.getOrOpenBook(validId);
    this.initBookDb(bookDb, validId, bookName, false);
    if (args.bookKey) {
      bookDb.exec({
        sql: `INSERT INTO meta (key, value) VALUES ('book_key', ?1)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        bind: [args.bookKey.trim()],
      });
    }
    await this.persistDatabaseFile(vPath, bookDb);

    return {
      id: validId,
      name: bookName,
      kind: bookKind,
      created_at: now,
      last_opened_at: now,
      file_exists: true,
    };
  }

  async getSyncFrontier(bookId: string): Promise<Record<string, string>> {
    await this.init();
    const validId = validateBookId(bookId);
    const db = await this.getOrOpenBook(validId);
    return computeLocalFrontier(db);
  }

  async getSyncDeltaOps(args: {
    bookId: string;
    remoteFrontier: Record<string, string>;
    limit?: number;
  }): Promise<CrdtOp[]> {
    await this.init();
    const validId = validateBookId(args.bookId);
    const db = await this.getOrOpenBook(validId);
    return collectOpsSinceFrontier(db, args.remoteFrontier ?? {}, args.limit ?? 500);
  }

  async applySyncDeltaOps(args: {
    bookId: string;
    ops: CrdtOp[];
    fromPeerId?: string;
  }): Promise<CrdtMergeReport> {
    await this.init();
    const validId = validateBookId(args.bookId);
    const ops = args.ops ?? [];
    let report: CrdtMergeReport = { appliedCount: 0, tables: [] };

    if (ops.length > 0) {
      report = await this.withBookWrite(validId, (writeDb) =>
        mergeRemoteOplog(writeDb, ops),
      );
    }

    if (args.fromPeerId) {
      await this.withBookWrite(validId, (writeDb) => {
        writeDb.exec({
          sql: `INSERT INTO sync_peers (node_id, last_seen_at)
                VALUES (?1, ?2)
                ON CONFLICT(node_id) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
          bind: [args.fromPeerId, nowIso8601()],
        });
      });
    }

    return report;
  }

  async recordPeerSeen(args: {
    bookId: string;
    nodeId: string;
    deviceId?: string | null;
    deviceName?: string | null;
  }): Promise<void> {
    await this.init();
    const validId = validateBookId(args.bookId);
    await this.withBookWrite(validId, (writeDb) => {
      writeDb.exec({
        sql: `INSERT INTO sync_peers (node_id, device_id, last_seen_at, device_name)
              VALUES (?1, ?2, ?3, ?4)
              ON CONFLICT(node_id) DO UPDATE SET
                 device_id = COALESCE(excluded.device_id, sync_peers.device_id),
                 last_seen_at = excluded.last_seen_at,
                 device_name = COALESCE(excluded.device_name, sync_peers.device_name)`,
        bind: [args.nodeId, args.deviceId ?? null, nowIso8601(), args.deviceName ?? null],
      });
    });
  }

  async getSyncPeers(bookId: string): Promise<Array<{
    node_id: string;
    device_id: string | null;
    last_seen_at: string | null;
    device_name: string | null;
    custom_alias: string | null;
  }>> {
    await this.init();
    const validId = validateBookId(bookId);
    const db = await this.getOrOpenBook(validId);
    const rows = db.selectArrays(
      "SELECT node_id, device_id, last_seen_at, device_name, custom_alias FROM sync_peers ORDER BY last_seen_at DESC",
    );
    return rows.map((r) => ({
      node_id: String(r[0]),
      device_id: r[1] !== null ? String(r[1]) : null,
      last_seen_at: r[2] !== null ? String(r[2]) : null,
      device_name: r[3] !== null ? String(r[3]) : null,
      custom_alias: r[4] !== null ? String(r[4]) : null,
    }));
  }

  async getDeviceIdentity(bookId: string): Promise<{ device_id: string; device_name: string }> {
    await this.init();
    const validId = validateBookId(bookId);
    const db = await this.getOrOpenBook(validId);
    const deviceId = (db.selectValue("SELECT value FROM meta WHERE key = 'device_id'") as string) || "00000000";
    const deviceName = (db.selectValue("SELECT value FROM meta WHERE key = 'device_name'") as string) || "Perangkat Ini";
    return { device_id: deviceId, device_name: deviceName };
  }

  async setDeviceName(bookId: string, deviceName: string): Promise<{ device_id: string; device_name: string }> {
    await this.init();
    const validId = validateBookId(bookId);
    const trimmed = deviceName.trim();
    if (!trimmed) {
      throw new TauriCommandError("VALIDATION_ERROR", "Nama perangkat tidak boleh kosong");
    }
    if (trimmed.length > 64) {
      throw new TauriCommandError("VALIDATION_ERROR", "Nama perangkat maksimal 64 karakter");
    }
    await this.withBookWrite(validId, (writeDb) => {
      writeDb.exec({
        sql: `INSERT INTO meta (key, value) VALUES ('device_name', ?1)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        bind: [trimmed],
      });
    });
    return this.getDeviceIdentity(validId);
  }

  async setPeerCustomAlias(bookId: string, nodeId: string, customAlias: string | null): Promise<void> {
    await this.init();
    const validId = validateBookId(bookId);
    const trimmedNode = nodeId.trim();
    const sanitizedAlias = customAlias?.trim() ? customAlias.trim() : null;
    if (sanitizedAlias && sanitizedAlias.length > 64) {
      throw new TauriCommandError("VALIDATION_ERROR", "Nama alias maksimal 64 karakter");
    }
    await this.withBookWrite(validId, (writeDb) => {
      writeDb.exec({
        sql: "UPDATE sync_peers SET custom_alias = ?1 WHERE node_id = ?2",
        bind: [sanitizedAlias, trimmedNode],
      });
    });
  }

  async getLocalNodeId(): Promise<string> {
    await this.init();
    return this.localNodeId;
  }

  async dispatch(
    cmd: string,
    args: Record<string, unknown> = {}
  ): Promise<unknown> {
    switch (cmd) {
      case "list_books":
        return this.listBooks();
      case "create_book":
        return this.createBook(
          String(args.name ?? ""),
          (args.kind as BookKind) ?? "PERSONAL"
        );
      case "rename_book":
        return this.renameBook(
          String(args.bookId ?? args.book_id ?? ""),
          String(args.newName ?? args.new_name ?? "")
        );
      case "delete_book":
        return this.deleteBook(String(args.bookId ?? args.book_id ?? ""));
      case "open_book":
        return this.openBook(String(args.bookId ?? args.book_id ?? ""));
      case "close_book":
        return this.closeBook(String(args.bookId ?? args.book_id ?? ""));
      case "export_book_encrypted_bytes":
        return this.exportBookEncryptedBytes(
          String(args.bookId ?? args.book_id ?? ""),
          String(args.passphrase ?? "")
        );
      case "import_book_encrypted_bytes":
        return this.importBookEncryptedBytes(
          args.encryptedBytes as Uint8Array,
          String(args.passphrase ?? ""),
          args.kind as BookKind | undefined
        );
      case "list_accounts":
        return this.listAccounts(String(args.bookId ?? args.book_id ?? ""));
      case "upsert_account":
        return this.upsertAccount(
          String(args.bookId ?? args.book_id ?? ""),
          args.input as UpsertAccountInput
        );
      case "delete_account":
        return this.deleteAccount(
          String(args.bookId ?? args.book_id ?? ""),
          String(args.accountId ?? args.account_id ?? "")
        );
      case "merge_accounts":
        return this.mergeAccounts(
          String(args.bookId ?? args.book_id ?? ""),
          String(args.sourceId ?? args.source_id ?? ""),
          String(args.targetId ?? args.target_id ?? "")
        );
      case "list_categories":
        return this.listCategories(String(args.bookId ?? args.book_id ?? ""));
      case "upsert_category":
        return this.upsertCategory(
          String(args.bookId ?? args.book_id ?? ""),
          args.input as UpsertCategoryInput
        );
      case "delete_category":
        return this.deleteCategory(
          String(args.bookId ?? args.book_id ?? ""),
          String(args.categoryId ?? args.category_id ?? "")
        );
      case "add_transaction":
        return this.addTransaction(
          String(args.bookId ?? args.book_id ?? ""),
          args.input as AddTransactionInput
        );
      case "update_transaction":
        return this.updateTransaction(
          String(args.bookId ?? args.book_id ?? ""),
          args.input as UpdateTransactionInput
        );
      case "delete_transaction":
        return this.deleteTransaction(
          String(args.bookId ?? args.book_id ?? ""),
          String(args.txId ?? args.tx_id ?? "")
        );
      case "list_transactions":
        return this.listTransactions(
          String(args.bookId ?? args.book_id ?? ""),
          (args.filter as TransactionFilter) ?? {}
        );
      case "transfer_between_books":
        return this.transferBetweenBooks(
          args.input as TransferBetweenBooksInput
        );
      case "get_account_balances":
        return this.getAccountBalances(
          String(args.bookId ?? args.book_id ?? "")
        );
      case "get_cash_flow_summary":
        return this.getCashFlowSummary(
          String(args.bookId ?? args.book_id ?? ""),
          args.monthsLimit as number | undefined
        );
      case "list_budgets":
        return this.listBudgets(String(args.bookId ?? args.book_id ?? ""));
      case "upsert_budget":
        return this.upsertBudget(
          String(args.bookId ?? args.book_id ?? ""),
          args.input as UpsertBudgetInput
        );
      case "delete_budget":
        return this.deleteBudget(
          String(args.bookId ?? args.book_id ?? ""),
          String(args.budgetId ?? args.budget_id ?? "")
        );
      case "get_budget_progress":
        return this.getBudgetProgress(
          String(args.bookId ?? args.book_id ?? ""),
          String(args.month ?? "")
        );
      case "get_monthly_report":
        return this.getMonthlyReport(
          String(args.bookId ?? args.book_id ?? ""),
          String(args.month ?? "")
        );
      case "get_sync_status":
        return this.getSyncStatus(String(args.bookId ?? args.book_id ?? ""));
      case "create_invite":
        return this.createInvite(
          String(args.bookId ?? args.book_id ?? ""),
          args.ttlSecs as number | undefined
        );
      case "join_book_from_invite":
        return this.joinBookFromInvite(
          String(args.inviteQr ?? args.invite_qr ?? ""),
          args.kind as BookKind | undefined
        );
      case "list_peers":
        return this.listPeers(String(args.bookId ?? args.book_id ?? ""));
      case "get_device_identity":
        return this.getDeviceIdentity(String(args.bookId ?? args.book_id ?? ""));
      case "set_device_name":
        return this.setDeviceName(
          String(args.bookId ?? args.book_id ?? ""),
          String(args.deviceName ?? args.device_name ?? "")
        );
      case "set_peer_custom_alias":
        return this.setPeerCustomAlias(
          String(args.bookId ?? args.book_id ?? ""),
          String(args.nodeId ?? args.node_id ?? ""),
          (args.customAlias ?? args.custom_alias ?? null) as string | null
        );
      case "get_sync_topology":
        return this.getSyncTopology(String(args.bookId ?? args.book_id ?? ""));
      case "set_preferred_hub":
        return this.setPreferredHub(
          String(args.bookId ?? args.book_id ?? ""),
          (args.hubNodeId ?? args.hub_node_id ?? null) as string | null
        );
      case "trigger_manual_sync":
        return this.triggerManualSync(
          String(args.bookId ?? args.book_id ?? "")
        );
      case "set_app_foreground":
        return this.setAppForeground(
          Boolean(args.isForeground ?? args.is_foreground)
        );
      case "get_sync_meta":
        return this.getSyncMeta(String(args.bookId ?? args.book_id ?? ""));
      case "sync_join_book":
        return this.syncJoinBook({
          bookId: String(args.bookId ?? args.book_id ?? ""),
          bookName: String(args.bookName ?? args.book_name ?? ""),
          bookKey: (args.bookKey ?? args.book_key) as string | undefined,
          kind: (args.kind) as BookKind | undefined,
        });
      case "get_sync_frontier":
        return this.getSyncFrontier(String(args.bookId ?? args.book_id ?? ""));
      case "get_sync_delta_ops":
        return this.getSyncDeltaOps({
          bookId: String(args.bookId ?? args.book_id ?? ""),
          remoteFrontier: (args.remoteFrontier ?? args.remote_frontier ?? {}) as Record<string, string>,
          limit: args.limit as number | undefined,
        });
      case "apply_sync_delta_ops":
        return this.applySyncDeltaOps({
          bookId: String(args.bookId ?? args.book_id ?? ""),
          ops: (args.ops ?? []) as CrdtOp[],
          fromPeerId: (args.fromPeerId ?? args.from_peer_id) as string | undefined,
        });
      case "record_peer_seen":
        return this.recordPeerSeen({
          bookId: String(args.bookId ?? args.book_id ?? ""),
          nodeId: String(args.nodeId ?? args.node_id ?? ""),
          deviceId: (args.deviceId ?? args.device_id ?? null) as string | null,
        });
      case "get_sync_peers":
        return this.getSyncPeers(String(args.bookId ?? args.book_id ?? ""));
      case "get_local_node_id":
        return this.getLocalNodeId();
      default:
        throw new TauriCommandError(
          "UNKNOWN_COMMAND",
          `Command '${cmd}' is not implemented in WebSqliteEngine`
        );
    }
  }
}
