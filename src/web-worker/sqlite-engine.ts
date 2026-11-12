import sqlite3InitModule, {
  type Database,
  type SAHPoolUtil,
  type Sqlite3Static,
} from "@sqlite.org/sqlite-wasm";
import {
  TauriCommandError,
  type AccountBalanceItem,
  type AccountRow,
  type AccountView,
  type AddTransactionInput,
  type BookKind,
  type BookMetadata,
  type BudgetProgressItem,
  type BudgetRow,
  type CashFlowMonthItem,
  type CategoryView,
  type InviteResponse,
  type MonthlyReportResponse,
  type PaginatedTransactions,
  type PeerInfo,
  type SyncStatusPayload,
  type SyncTopologyInfo,
  type TransactionFilter,
  type TransactionRow,
  type TransactionType,
  type TransferBetweenBooksInput,
  type TransferBetweenBooksResult,
  type UpdateTransactionInput,
  type UpsertAccountInput,
  type UpsertBudgetInput,
  type UpsertCategoryInput,
} from "../lib/tauri-api";
import {
  SYSTEM_CATEGORY_MODAL_ID,
  SYSTEM_CATEGORY_MODAL_NAME,
  SYSTEM_CATEGORY_PRIVE_ID,
  SYSTEM_CATEGORY_PRIVE_NAME,
  decryptBookSnapshotBytes,
  encryptBookSnapshotBytes,
  generateDeviceId,
  newUuidV7,
  nowIso8601,
  validateBookId,
} from "../lib/web-core";
import {
  CrdtMergeReport,
  CrdtOp,
  collectOpsSinceFrontier,
  computeLocalFrontier,
  mergeRemoteOplog,
} from "./crdt-merge";
import { WebSyncEngine } from "./sync-engine";
import {
  deleteAccountInDb,
  getAccountBalancesInDb,
  listAccountsInDb,
  mergeAccountsInDb,
  upsertAccountInDb,
} from "./sqlite/accounts-repo";
import {
  deleteBudgetInDb,
  getBudgetProgressInDb,
  listBudgetsInDb,
  upsertBudgetInDb,
} from "./sqlite/budgets-repo";
import {
  deleteCategoryInDb,
  listCategoriesInDb,
  upsertCategoryInDb,
} from "./sqlite/categories-repo";
import {
  ensureSystemCategory,
  type LocalOpBroadcastFn,
} from "./sqlite/crdt-ops";
import {
  getCashFlowSummaryInDb,
  getMonthlyReportInDb,
} from "./sqlite/reports-repo";
import { initBookDb, initRegistryDb } from "./sqlite/schema";
import {
  idbDeleteFile,
  idbReadFile,
  idbWriteFile,
} from "./sqlite/sql-helpers";
import {
  getDeviceIdentityInDb,
  getOrCreateBookKeyInDb,
  getSyncPeersInDb,
  recordPeerSeenInDb,
  setDeviceNameInDb,
  setPeerCustomAliasInDb,
  setPreferredHubInDb,
} from "./sqlite/sync-repo";
import {
  addTransactionInDb,
  deleteTransactionInDb,
  listTransactionsInDb,
  updateTransactionInDb,
} from "./sqlite/transactions-repo";

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

  private readonly broadcastOp: LocalOpBroadcastFn = (bookId, op) => {
    this.onLocalOpCreated?.(bookId, op);
    void this.syncEngine.broadcastLocalOp(bookId, op);
  };

  constructor() {
    this.syncEngine = new WebSyncEngine(this.localNodeId, {
      getOrOpenBook: (bookId) => this.getOrOpenBook(bookId),
      withBookWrite: (bookId, action) => this.withBookWrite(bookId, action),
      getRegistryDb: () => this.registryDb,
      initBookDb: (db, bookId, bookName, seedDefaults) =>
        initBookDb(db, bookId, bookName, seedDefaults),
      persistDatabaseFile: (virtualPath, db) =>
        this.persistDatabaseFile(virtualPath, db),
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
    initRegistryDb(this.registryDb);
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
    initBookDb(db, validId, bookName, false);
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
  // Books & Encrypted Backup
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
    initBookDb(db, bookId, trimmedName, true);
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

  // ==========================================================================
  // Accounts & Categories
  // ==========================================================================

  async listAccounts(bookId: string): Promise<AccountView[]> {
    const db = await this.getOrOpenBook(bookId);
    return listAccountsInDb(db);
  }

  async upsertAccount(
    bookId: string,
    input: UpsertAccountInput
  ): Promise<AccountRow> {
    return this.withBookWrite(bookId, (db, validId) =>
      upsertAccountInDb(db, input, validId, this.broadcastOp)
    );
  }

  async deleteAccount(bookId: string, accountId: string): Promise<void> {
    await this.withBookWrite(bookId, (db, validId) => {
      deleteAccountInDb(db, accountId, validId, this.broadcastOp);
    });
  }

  async mergeAccounts(
    bookId: string,
    sourceId: string,
    targetId: string
  ): Promise<AccountRow> {
    return this.withBookWrite(bookId, (db, validId) =>
      mergeAccountsInDb(db, sourceId, targetId, validId, this.broadcastOp)
    );
  }

  async getAccountBalances(bookId: string): Promise<AccountBalanceItem[]> {
    const db = await this.getOrOpenBook(bookId);
    return getAccountBalancesInDb(db);
  }

  async listCategories(bookId: string): Promise<CategoryView[]> {
    const db = await this.getOrOpenBook(bookId);
    return listCategoriesInDb(db);
  }

  async upsertCategory(
    bookId: string,
    input: UpsertCategoryInput
  ): Promise<CategoryView> {
    return this.withBookWrite(bookId, (db, validId) =>
      upsertCategoryInDb(db, input, validId, this.broadcastOp)
    );
  }

  async deleteCategory(bookId: string, categoryId: string): Promise<void> {
    await this.withBookWrite(bookId, (db, validId) => {
      deleteCategoryInDb(db, categoryId, validId, this.broadcastOp);
    });
  }

  // ==========================================================================
  // Transactions & Cross-Book Transfers
  // ==========================================================================

  async addTransaction(
    bookId: string,
    input: AddTransactionInput
  ): Promise<TransactionRow> {
    return this.withBookWrite(bookId, (db, validId) =>
      addTransactionInDb(db, input, validId, this.broadcastOp)
    );
  }

  async updateTransaction(
    bookId: string,
    input: UpdateTransactionInput
  ): Promise<TransactionRow> {
    return this.withBookWrite(bookId, (db, validId) =>
      updateTransactionInDb(db, input, validId, this.broadcastOp)
    );
  }

  async deleteTransaction(bookId: string, txId: string): Promise<void> {
    await this.withBookWrite(bookId, (db, validId) => {
      deleteTransactionInDb(db, txId, validId, this.broadcastOp);
    });
  }

  async listTransactions(
    bookId: string,
    filter: TransactionFilter
  ): Promise<PaginatedTransactions> {
    const db = await this.getOrOpenBook(bookId);
    return listTransactionsInDb(db, filter);
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
        ensureSystemCategory(
          tx,
          SYSTEM_CATEGORY_PRIVE_ID,
          SYSTEM_CATEGORY_PRIVE_NAME,
          "EXPENSE",
          this.broadcastOp
        )
      );

      return addTransactionInDb(
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
        fromBookId,
        this.broadcastOp
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
          ensureSystemCategory(
            tx,
            SYSTEM_CATEGORY_MODAL_ID,
            SYSTEM_CATEGORY_MODAL_NAME,
            "INCOME",
            this.broadcastOp
          )
        );

        return addTransactionInDb(
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
          toBookId,
          this.broadcastOp
        );
      });

      return {
        link_id: linkId,
        expense_tx: expenseTx,
        income_tx: incomeTx,
      };
    } catch (err) {
      await this.withBookWrite(fromBookId, (db) => {
        deleteTransactionInDb(db, expenseTx.id);
      }).catch(() => {});
      throw err;
    }
  }

  // ==========================================================================
  // Budgets & Reports
  // ==========================================================================

  async getCashFlowSummary(
    bookId: string,
    monthsLimit?: number
  ): Promise<CashFlowMonthItem[]> {
    const db = await this.getOrOpenBook(bookId);
    return getCashFlowSummaryInDb(db, monthsLimit);
  }

  async listBudgets(bookId: string): Promise<BudgetRow[]> {
    const db = await this.getOrOpenBook(bookId);
    return listBudgetsInDb(db);
  }

  async upsertBudget(
    bookId: string,
    input: UpsertBudgetInput
  ): Promise<BudgetRow> {
    return this.withBookWrite(bookId, (db, validId) =>
      upsertBudgetInDb(db, input, validId, this.broadcastOp)
    );
  }

  async deleteBudget(bookId: string, budgetId: string): Promise<void> {
    await this.withBookWrite(bookId, (db, validId) => {
      deleteBudgetInDb(db, budgetId, validId, this.broadcastOp);
    });
  }

  async getBudgetProgress(
    bookId: string,
    month: string
  ): Promise<BudgetProgressItem[]> {
    const db = await this.getOrOpenBook(bookId);
    return getBudgetProgressInDb(db, month);
  }

  async getMonthlyReport(
    bookId: string,
    month: string
  ): Promise<MonthlyReportResponse> {
    const db = await this.getOrOpenBook(bookId);
    return getMonthlyReportInDb(db, month);
  }

  // ==========================================================================
  // Sync Engine & Device Metadata
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
    await this.withBookWrite(validId, (db) => {
      setPreferredHubInDb(db, hubNodeId);
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
    return await this.withBookWrite(validId, (db) => getOrCreateBookKeyInDb(db));
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
      [validId]
    ) as string | undefined;

    if (!bookName) {
      throw new TauriCommandError(
        "BOOK_NOT_FOUND",
        `Buku tidak ditemukan: ${validId}`
      );
    }

    const bookKey = await this.getOrCreateBookKey(validId);
    const bookDb = await this.getOrOpenBook(validId);
    const prefHub = bookDb.selectValue(
      "SELECT value FROM meta WHERE key = 'preferred_hub_node_id'"
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
    initBookDb(bookDb, validId, bookName, false);
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
    return collectOpsSinceFrontier(
      db,
      args.remoteFrontier ?? {},
      args.limit ?? 500
    );
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
        mergeRemoteOplog(writeDb, ops)
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
      recordPeerSeenInDb(writeDb, args);
    });
  }

  async getSyncPeers(bookId: string): Promise<
    Array<{
      node_id: string;
      device_id: string | null;
      last_seen_at: string | null;
      device_name: string | null;
      custom_alias: string | null;
    }>
  > {
    await this.init();
    const validId = validateBookId(bookId);
    const db = await this.getOrOpenBook(validId);
    return getSyncPeersInDb(db);
  }

  async getDeviceIdentity(
    bookId: string
  ): Promise<{ device_id: string; device_name: string }> {
    await this.init();
    const validId = validateBookId(bookId);
    const db = await this.getOrOpenBook(validId);
    return getDeviceIdentityInDb(db);
  }

  async setDeviceName(
    bookId: string,
    deviceName: string
  ): Promise<{ device_id: string; device_name: string }> {
    await this.init();
    const validId = validateBookId(bookId);
    await this.withBookWrite(validId, (writeDb) => {
      setDeviceNameInDb(writeDb, deviceName);
    });
    return this.getDeviceIdentity(validId);
  }

  async setPeerCustomAlias(
    bookId: string,
    nodeId: string,
    customAlias: string | null
  ): Promise<void> {
    await this.init();
    const validId = validateBookId(bookId);
    await this.withBookWrite(validId, (writeDb) => {
      setPeerCustomAliasInDb(writeDb, nodeId, customAlias);
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
          kind: args.kind as BookKind | undefined,
        });
      case "get_sync_frontier":
        return this.getSyncFrontier(String(args.bookId ?? args.book_id ?? ""));
      case "get_sync_delta_ops":
        return this.getSyncDeltaOps({
          bookId: String(args.bookId ?? args.book_id ?? ""),
          remoteFrontier: (args.remoteFrontier ??
            args.remote_frontier ??
            {}) as Record<string, string>,
          limit: args.limit as number | undefined,
        });
      case "apply_sync_delta_ops":
        return this.applySyncDeltaOps({
          bookId: String(args.bookId ?? args.book_id ?? ""),
          ops: (args.ops ?? []) as CrdtOp[],
          fromPeerId: (args.fromPeerId ?? args.from_peer_id) as
            | string
            | undefined,
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
