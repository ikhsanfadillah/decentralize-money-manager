import type { Database } from "@sqlite.org/sqlite-wasm";
import {
  HlcTimestamp,
  MAX_REMOTE_BATCH_OPS,
  deterministicBudgetId,
  normalizeCategoryName,
  systemNowMs,
  validateIsoDate,
} from "../lib/web-core";
import {
  TauriCommandError,
  type AccountRow,
  type BudgetPeriod,
  type BudgetRow,
  type TransactionRow,
} from "../lib/tauri-api";

export interface CategoryRow {
  id: string;
  name: string;
  normalized_name?: string;
  kind: "EXPENSE" | "INCOME" | string;
  merged_into_id?: string | null;
  is_deleted: number;
  updated_hlc: string;
}

export interface CrdtOp {
  hlc_timestamp: string;
  table_name: string;
  row_id: string;
  payload_json: string;
  device_id: string;
}

export interface CrdtEnvelope<T> {
  op: "upsert" | string;
  row: T;
}

export interface CrdtMergeReport {
  appliedCount: number;
  tables: string[];
}

export function validateAccountRowForCrdt(row: AccountRow): void {
  if (!row.id || !row.id.trim()) {
    throw new TauriCommandError("VALIDATION_ERROR", "Account id cannot be empty");
  }
  if (!row.name || !row.name.trim()) {
    throw new TauriCommandError("VALIDATION_ERROR", "Account name cannot be empty");
  }
  if (!["BANK", "CASH", "EWALLET"].includes(row.account_type)) {
    throw new TauriCommandError("VALIDATION_ERROR", `Invalid account_type '${row.account_type}'`);
  }
  if (row.is_deleted !== 0 && row.is_deleted !== 1) {
    throw new TauriCommandError("VALIDATION_ERROR", "is_deleted must be 0 or 1");
  }
}

export function validateCategoryRowForCrdt(row: CategoryRow): void {
  if (!row.id || !row.id.trim()) {
    throw new TauriCommandError("VALIDATION_ERROR", "Category id cannot be empty");
  }
  if (!row.name || !row.name.trim()) {
    throw new TauriCommandError("VALIDATION_ERROR", "Category name cannot be empty");
  }
  if (!["EXPENSE", "INCOME"].includes(row.kind)) {
    throw new TauriCommandError("VALIDATION_ERROR", `Invalid category kind '${row.kind}'`);
  }
  if (row.is_deleted !== 0 && row.is_deleted !== 1) {
    throw new TauriCommandError("VALIDATION_ERROR", "is_deleted must be 0 or 1");
  }
}

export function validateTransactionRowForCrdt(row: TransactionRow): void {
  if (!row.id || !row.id.trim()) {
    throw new TauriCommandError("VALIDATION_ERROR", "Transaction id cannot be empty");
  }
  if (!row.account_id || !row.account_id.trim()) {
    throw new TauriCommandError("VALIDATION_ERROR", "Transaction account_id cannot be empty");
  }
  validateIsoDate(row.tx_date);
  if (row.is_deleted !== 0 && row.is_deleted !== 1) {
    throw new TauriCommandError("VALIDATION_ERROR", "is_deleted must be 0 or 1");
  }

  switch (row.tx_type) {
    case "EXPENSE":
      if (row.amount >= 0) {
        throw new TauriCommandError(
          "VALIDATION_ERROR",
          "EXPENSE transaction amount must be negative (< 0)",
        );
      }
      if (row.to_account_id !== null) {
        throw new TauriCommandError(
          "VALIDATION_ERROR",
          "EXPENSE transaction must not have to_account_id",
        );
      }
      if (!row.category_id || !row.category_id.trim()) {
        throw new TauriCommandError(
          "VALIDATION_ERROR",
          "EXPENSE transaction requires category_id",
        );
      }
      break;
    case "INCOME":
      if (row.amount <= 0) {
        throw new TauriCommandError(
          "VALIDATION_ERROR",
          "INCOME transaction amount must be positive (> 0)",
        );
      }
      if (row.to_account_id !== null) {
        throw new TauriCommandError(
          "VALIDATION_ERROR",
          "INCOME transaction must not have to_account_id",
        );
      }
      if (!row.category_id || !row.category_id.trim()) {
        throw new TauriCommandError(
          "VALIDATION_ERROR",
          "INCOME transaction requires category_id",
        );
      }
      break;
    case "TRANSFER":
      if (row.amount <= 0) {
        throw new TauriCommandError(
          "VALIDATION_ERROR",
          "TRANSFER transaction amount must be positive (> 0)",
        );
      }
      if (!row.to_account_id || !row.to_account_id.trim()) {
        throw new TauriCommandError(
          "VALIDATION_ERROR",
          "TRANSFER transaction requires to_account_id",
        );
      }
      if (row.to_account_id === row.account_id) {
        throw new TauriCommandError(
          "VALIDATION_ERROR",
          "TRANSFER account_id and to_account_id must be different",
        );
      }
      if (row.category_id !== null) {
        throw new TauriCommandError(
          "VALIDATION_ERROR",
          "TRANSFER transaction must have NULL category_id",
        );
      }
      break;
    default:
      throw new TauriCommandError(
        "VALIDATION_ERROR",
        `Invalid tx_type '${(row as { tx_type: string }).tx_type}'`,
      );
  }
}

export function validateBudgetRowForCrdt(row: BudgetRow): void {
  if (row.period !== "MONTHLY") {
    throw new TauriCommandError(
      "VALIDATION_ERROR",
      `Unsupported budget period '${row.period}', only MONTHLY is supported`,
    );
  }
  if (row.amount_limit <= 0) {
    throw new TauriCommandError("VALIDATION_ERROR", "Budget amount_limit must be > 0");
  }
  if (row.alert_threshold_pct < 1 || row.alert_threshold_pct > 100) {
    throw new TauriCommandError(
      "VALIDATION_ERROR",
      "Budget alert_threshold_pct must be between 1 and 100",
    );
  }
  if (row.is_deleted !== 0 && row.is_deleted !== 1) {
    throw new TauriCommandError("VALIDATION_ERROR", "is_deleted must be 0 or 1");
  }
  const expectedId = deterministicBudgetId(row.category_id, row.period as BudgetPeriod);
  if (row.id !== expectedId) {
    throw new TauriCommandError(
      "VALIDATION_ERROR",
      `Budget id '${row.id}' does not match deterministic UUIDv5 '${expectedId}'`,
    );
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

/**
 * Computes the vector clock frontier for a book: `{ [deviceId]: maxHlc }`.
 */
export function computeLocalFrontier(db: Database): Record<string, string> {
  const rows = db.selectArrays(
    "SELECT device_id, MAX(hlc_timestamp) FROM crdt_oplog GROUP BY device_id",
  );
  const frontier: Record<string, string> = {};
  for (const [devId, maxHlc] of rows) {
    if (devId && maxHlc) {
      frontier[String(devId)] = String(maxHlc);
    }
  }
  return frontier;
}

/**
 * Collects local operations that the remote peer hasn't seen yet based on remote frontier.
 */
export function collectOpsSinceFrontier(
  db: Database,
  remoteFrontier: Record<string, string>,
  maxOps = 500,
): CrdtOp[] {
  const rows = db.selectArrays(
    `SELECT hlc_timestamp, table_name, row_id, payload_json, device_id
     FROM crdt_oplog
     ORDER BY hlc_timestamp ASC`,
  );

  const missingOps: CrdtOp[] = [];

  for (const r of rows) {
    const hlc = String(r[0]);
    const tableName = String(r[1]);
    const rowId = String(r[2]);
    const payloadJson = String(r[3]);
    const deviceId = String(r[4]);

    const remoteMaxHlc = remoteFrontier[deviceId];
    if (!remoteMaxHlc || hlc > remoteMaxHlc) {
      missingOps.push({
        hlc_timestamp: hlc,
        table_name: tableName,
        row_id: rowId,
        payload_json: payloadJson,
        device_id: deviceId,
      });
      if (missingOps.length >= maxOps) {
        break;
      }
    }
  }

  return missingOps;
}

/**
 * Merges a batch of remote CRDT operations into the local SQLite book database
 * implementing Last-Write-Wins (LWW) per Section 6 & crdt.rs in Rust.
 */
export function mergeRemoteOplog(
  db: Database,
  ops: CrdtOp[],
  nowMs = systemNowMs(),
): CrdtMergeReport {
  if (ops.length > MAX_REMOTE_BATCH_OPS) {
    throw new TauriCommandError(
      "VALIDATION_ERROR",
      `Remote batch size ${ops.length} exceeds maximum allowed ${MAX_REMOTE_BATCH_OPS}`,
    );
  }
  if (ops.length === 0) {
    return { appliedCount: 0, tables: [] };
  }

  const changedTables = new Set<string>();
  let appliedCount = 0;

  db.transaction("IMMEDIATE", (tx) => {
    const localHlcRaw = tx.selectValue(
      "SELECT value FROM meta WHERE key = 'hlc_last'",
    ) as string | undefined;
    let localHlc = localHlcRaw ? HlcTimestamp.parse(localHlcRaw) : HlcTimestamp.zero("00000000");

    for (const op of ops) {
      const remoteHlc = HlcTimestamp.parse(op.hlc_timestamp);
      if (remoteHlc.device_id !== op.device_id) {
        throw new TauriCommandError(
          "VALIDATION_ERROR",
          `Op device_id '${op.device_id}' does not match HLC device_id '${remoteHlc.device_id}'`,
        );
      }

      // Advance local HLC
      const curWall = Math.max(localHlc.wall_ms, remoteHlc.wall_ms, nowMs);
      let curCounter = 0;
      if (curWall === localHlc.wall_ms && curWall === remoteHlc.wall_ms) {
        curCounter = Math.max(localHlc.counter, remoteHlc.counter) + 1;
      } else if (curWall === localHlc.wall_ms) {
        curCounter = localHlc.counter + 1;
      } else if (curWall === remoteHlc.wall_ms) {
        curCounter = remoteHlc.counter + 1;
      }
      localHlc = new HlcTimestamp(curWall, curCounter, localHlc.device_id);

      // 1. Insert or ignore into crdt_oplog
      tx.exec({
        sql: `INSERT OR IGNORE INTO crdt_oplog (hlc_timestamp, table_name, row_id, payload_json, device_id)
              VALUES (?1, ?2, ?3, ?4, ?5)`,
        bind: [op.hlc_timestamp, op.table_name, op.row_id, op.payload_json, op.device_id],
      });

      // 2. LWW Check per table
      switch (op.table_name) {
        case "accounts": {
          let env: CrdtEnvelope<AccountRow>;
          try {
            env = JSON.parse(op.payload_json) as CrdtEnvelope<AccountRow>;
          } catch {
            throw new TauriCommandError("VALIDATION_ERROR", "Invalid account payload JSON");
          }
          if (env.op !== "upsert") {
            throw new TauriCommandError("VALIDATION_ERROR", `Unsupported CRDT op '${env.op}'`);
          }
          const row = env.row;
          if (row.id !== op.row_id || row.updated_hlc !== op.hlc_timestamp) {
            throw new TauriCommandError(
              "VALIDATION_ERROR",
              "Account op row_id or updated_hlc mismatch",
            );
          }
          validateAccountRowForCrdt(row);

          const existingHlc = tx.selectValue(
            "SELECT updated_hlc FROM accounts WHERE id = ?1",
            [row.id],
          ) as string | undefined;

          const shouldApply = !existingHlc || op.hlc_timestamp > existingHlc;
          if (shouldApply) {
            tx.exec({
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
            changedTables.add("accounts");
            appliedCount += 1;
          }
          break;
        }

        case "categories": {
          let env: CrdtEnvelope<CategoryRow>;
          try {
            env = JSON.parse(op.payload_json) as CrdtEnvelope<CategoryRow>;
          } catch {
            throw new TauriCommandError("VALIDATION_ERROR", "Invalid category payload JSON");
          }
          if (env.op !== "upsert") {
            throw new TauriCommandError("VALIDATION_ERROR", `Unsupported CRDT op '${env.op}'`);
          }
          const row = env.row;
          if (row.id !== op.row_id || row.updated_hlc !== op.hlc_timestamp) {
            throw new TauriCommandError(
              "VALIDATION_ERROR",
              "Category op row_id or updated_hlc mismatch",
            );
          }
          validateCategoryRowForCrdt(row);
          const normalized = normalizeCategoryName(row.name);

          const existingHlc = tx.selectValue(
            "SELECT updated_hlc FROM categories WHERE id = ?1",
            [row.id],
          ) as string | undefined;

          const shouldApply = !existingHlc || op.hlc_timestamp > existingHlc;
          if (shouldApply) {
            tx.exec({
              sql: `INSERT INTO categories (id, name, normalized_name, kind, merged_into_id, is_deleted, updated_hlc)
                    VALUES (?1, ?2, ?3, ?4, NULL, ?5, ?6)
                    ON CONFLICT(id) DO UPDATE SET
                       name = excluded.name,
                       normalized_name = excluded.normalized_name,
                       kind = excluded.kind,
                       is_deleted = excluded.is_deleted,
                       updated_hlc = excluded.updated_hlc`,
              bind: [
                row.id,
                row.name,
                normalized,
                row.kind,
                row.is_deleted,
                row.updated_hlc,
              ],
            });
            changedTables.add("categories");
            appliedCount += 1;
          }
          break;
        }

        case "transactions": {
          let env: CrdtEnvelope<TransactionRow>;
          try {
            env = JSON.parse(op.payload_json) as CrdtEnvelope<TransactionRow>;
          } catch {
            throw new TauriCommandError("VALIDATION_ERROR", "Invalid transaction payload JSON");
          }
          if (env.op !== "upsert") {
            throw new TauriCommandError("VALIDATION_ERROR", `Unsupported CRDT op '${env.op}'`);
          }
          const row = env.row;
          if (row.id !== op.row_id || row.updated_hlc !== op.hlc_timestamp) {
            throw new TauriCommandError(
              "VALIDATION_ERROR",
              "Transaction op row_id or updated_hlc mismatch",
            );
          }
          validateTransactionRowForCrdt(row);

          const existingHlc = tx.selectValue(
            "SELECT updated_hlc FROM transactions WHERE id = ?1",
            [row.id],
          ) as string | undefined;

          const shouldApply = !existingHlc || op.hlc_timestamp > existingHlc;
          if (shouldApply) {
            tx.exec({
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
            changedTables.add("transactions");
            appliedCount += 1;
          }
          break;
        }

        case "budgets": {
          let env: CrdtEnvelope<BudgetRow>;
          try {
            env = JSON.parse(op.payload_json) as CrdtEnvelope<BudgetRow>;
          } catch {
            throw new TauriCommandError("VALIDATION_ERROR", "Invalid budget payload JSON");
          }
          if (env.op !== "upsert") {
            throw new TauriCommandError("VALIDATION_ERROR", `Unsupported CRDT op '${env.op}'`);
          }
          const row = env.row;
          if (row.id !== op.row_id || row.updated_hlc !== op.hlc_timestamp) {
            throw new TauriCommandError(
              "VALIDATION_ERROR",
              "Budget op row_id or updated_hlc mismatch",
            );
          }
          validateBudgetRowForCrdt(row);

          const existingHlc = tx.selectValue(
            "SELECT updated_hlc FROM budgets WHERE id = ?1",
            [row.id],
          ) as string | undefined;

          const shouldApply = !existingHlc || op.hlc_timestamp > existingHlc;
          if (shouldApply) {
            tx.exec({
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
            changedTables.add("budgets");
            appliedCount += 1;
          }
          break;
        }
      }
    }

    if (changedTables.has("categories")) {
      dedupeCategories(tx);
    }

    tx.exec({
      sql: `INSERT INTO meta (key, value) VALUES ('hlc_last', ?1)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      bind: [localHlc.toString()],
    });
  });

  return {
    appliedCount,
    tables: Array.from(changedTables),
  };
}
