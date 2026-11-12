import type { Database, SqlValue } from "@sqlite.org/sqlite-wasm";
import {
  TauriCommandError,
  type AddTransactionInput,
  type PaginatedTransactions,
  type TransactionFilter,
  type TransactionRow,
  type TransactionType,
  type TransactionView,
  type UpdateTransactionInput,
} from "../../lib/tauri-api";
import {
  ACCOUNT_ROOTS_CTE_SQL,
  newUuidV7,
  systemNowMs,
} from "../../lib/web-core";
import {
  loadClockFromDb,
  saveClockToDb,
  validateTransactionRow,
  writeLocalTransactionOp,
  type LocalOpBroadcastFn,
} from "./crdt-ops";

export function addTransactionInDb(
  db: Database,
  input: AddTransactionInput,
  bookId?: string,
  onOp?: LocalOpBroadcastFn
): TransactionRow {
  return db.transaction("IMMEDIATE", (tx) => {
    const clock = loadClockFromDb(tx);
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

    validateTransactionRow(row);
    writeLocalTransactionOp(tx, row, deviceId, bookId, onOp);
    saveClockToDb(tx, clock);
    return row;
  });
}

export function updateTransactionInDb(
  db: Database,
  input: UpdateTransactionInput,
  bookId?: string,
  onOp?: LocalOpBroadcastFn
): TransactionRow {
  return db.transaction("IMMEDIATE", (tx) => {
    const existing = tx.selectArray(
      "SELECT created_by_device, link_id FROM transactions WHERE id = ?1 AND is_deleted = 0",
      [input.id]
    );
    if (!existing) {
      throw new TauriCommandError("NOT_FOUND", `Transaction ${input.id}`);
    }

    const clock = loadClockFromDb(tx);
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

    validateTransactionRow(row);
    writeLocalTransactionOp(tx, row, deviceId, bookId, onOp);
    saveClockToDb(tx, clock);
    return row;
  });
}

export function deleteTransactionInDb(
  db: Database,
  txId: string,
  bookId?: string,
  onOp?: LocalOpBroadcastFn
): void {
  db.transaction("IMMEDIATE", (tx) => {
    const r = tx.selectArray(
      `SELECT id, account_id, to_account_id, category_id, amount, tx_type, note, tx_date, created_by_device, link_id, is_deleted, updated_hlc
       FROM transactions WHERE id = ?1`,
      [txId]
    );
    if (!r) {
      throw new TauriCommandError("NOT_FOUND", `Transaction ${txId}`);
    }
    const clock = loadClockFromDb(tx);
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
    writeLocalTransactionOp(tx, row, clock.deviceId(), bookId, onOp);
    saveClockToDb(tx, clock);
  });
}

export function listTransactionsInDb(
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

