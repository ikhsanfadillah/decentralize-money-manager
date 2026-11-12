import type { Database } from "@sqlite.org/sqlite-wasm";
import {
  TauriCommandError,
  type AccountRow,
  type BudgetRow,
  type CategoryKind,
  type TransactionRow,
} from "../../lib/tauri-api";
import {
  ACCOUNT_ROOTS_CTE_SQL,
  HlcClock,
  HlcTimestamp,
  deterministicBudgetId,
  normalizeCategoryName,
  systemNowMs,
  validateIsoDate,
} from "../../lib/web-core";
import type { CrdtOp } from "../crdt-merge";

export interface CategoryRowInternal {
  id: string;
  name: string;
  normalized_name: string;
  kind: CategoryKind;
  merged_into_id: string | null;
  is_deleted: number;
  updated_hlc: string;
}

export type LocalOpBroadcastFn = (bookId: string, op: CrdtOp) => void;

export function loadClockFromDb(db: Database): HlcClock {
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

export function saveClockToDb(db: Database, clock: HlcClock): void {
  db.exec({
    sql: `INSERT INTO meta (key, value) VALUES ('hlc_last', ?1)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    bind: [clock.last().toString()],
  });
}

export function validateAccountRow(row: AccountRow): void {
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

export function validateCategoryRow(row: CategoryRowInternal): void {
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

export function validateTransactionRow(row: TransactionRow): void {
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

export function validateBudgetRow(row: BudgetRow): void {
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

export function writeLocalAccountOp(
  db: Database,
  row: AccountRow,
  deviceId: string,
  bookId?: string,
  onOp?: LocalOpBroadcastFn
): void {
  validateAccountRow(row);
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

  if (bookId && onOp) {
    onOp(bookId, {
      hlc_timestamp: row.updated_hlc,
      table_name: "accounts",
      row_id: row.id,
      payload_json: payloadJson,
      device_id: deviceId,
    });
  }
}

export function writeLocalCategoryOp(
  db: Database,
  row: CategoryRowInternal,
  deviceId: string,
  bookId?: string,
  onOp?: LocalOpBroadcastFn
): void {
  validateCategoryRow(row);
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

  if (bookId && onOp) {
    onOp(bookId, {
      hlc_timestamp: cleanRow.updated_hlc,
      table_name: "categories",
      row_id: cleanRow.id,
      payload_json: payloadJson,
      device_id: deviceId,
    });
  }
}

export function writeLocalTransactionOp(
  db: Database,
  row: TransactionRow,
  deviceId: string,
  bookId?: string,
  onOp?: LocalOpBroadcastFn
): void {
  validateTransactionRow(row);
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

  if (bookId && onOp) {
    onOp(bookId, {
      hlc_timestamp: row.updated_hlc,
      table_name: "transactions",
      row_id: row.id,
      payload_json: payloadJson,
      device_id: deviceId,
    });
  }
}

export function writeLocalBudgetOp(
  db: Database,
  row: BudgetRow,
  deviceId: string,
  bookId?: string,
  onOp?: LocalOpBroadcastFn
): void {
  validateBudgetRow(row);
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

  if (bookId && onOp) {
    onOp(bookId, {
      hlc_timestamp: row.updated_hlc,
      table_name: "budgets",
      row_id: row.id,
      payload_json: payloadJson,
      device_id: deviceId,
    });
  }
}

export function dedupeCategories(db: Database): void {
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

export function resolveAccountRootsMap(db: Database): Map<string, string> {
  const sql = `${ACCOUNT_ROOTS_CTE_SQL} SELECT account_id, root_id FROM account_roots`;
  const rows = db.selectArrays(sql);
  const map = new Map<string, string>();
  for (const r of rows) {
    map.set(String(r[0]), String(r[1]));
  }
  return map;
}

export function ensureSystemCategory(
  db: Database,
  id: string,
  name: string,
  kind: CategoryKind,
  onOp?: LocalOpBroadcastFn
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

  const clock = loadClockFromDb(db);
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

  writeLocalCategoryOp(db, row, deviceId, undefined, onOp);
  saveClockToDb(db, clock);
  dedupeCategories(db);

  const resolved = db.selectValue(
    "SELECT COALESCE(merged_into_id, id) FROM categories WHERE id = ?1",
    [id]
  );
  return String(resolved ?? id);
}

