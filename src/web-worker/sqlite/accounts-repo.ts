import type { Database } from "@sqlite.org/sqlite-wasm";
import {
  TauriCommandError,
  type AccountBalanceItem,
  type AccountRow,
  type AccountType,
  type AccountView,
  type UpsertAccountInput,
} from "../../lib/tauri-api";
import { newUuidV7, systemNowMs } from "../../lib/web-core";
import {
  loadClockFromDb,
  resolveAccountRootsMap,
  saveClockToDb,
  validateAccountRow,
  writeLocalAccountOp,
  type LocalOpBroadcastFn,
} from "./crdt-ops";

export function listAccountsInDb(db: Database): AccountView[] {
  const roots = resolveAccountRootsMap(db);
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

export function upsertAccountInDb(
  db: Database,
  input: UpsertAccountInput,
  bookId?: string,
  onOp?: LocalOpBroadcastFn
): AccountRow {
  return db.transaction("IMMEDIATE", (tx) => {
    const clock = loadClockFromDb(tx);
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

    writeLocalAccountOp(tx, row, deviceId, bookId, onOp);
    saveClockToDb(tx, clock);
    return row;
  });
}

export function deleteAccountInDb(
  db: Database,
  accountId: string,
  bookId?: string,
  onOp?: LocalOpBroadcastFn
): void {
  db.transaction("IMMEDIATE", (tx) => {
    const r = tx.selectArray(
      `SELECT id, name, account_type, initial_balance, merged_into_id, is_deleted, updated_hlc
       FROM accounts WHERE id = ?1`,
      [accountId]
    );
    if (!r) {
      throw new TauriCommandError("NOT_FOUND", `Account ${accountId}`);
    }
    const clock = loadClockFromDb(tx);
    const row: AccountRow = {
      id: String(r[0]),
      name: String(r[1]),
      account_type: String(r[2]) as AccountType,
      initial_balance: Number(r[3]),
      merged_into_id: r[4] !== null ? String(r[4]) : null,
      is_deleted: 1,
      updated_hlc: clock.tick(systemNowMs()).toString(),
    };
    writeLocalAccountOp(tx, row, clock.deviceId(), bookId, onOp);
    saveClockToDb(tx, clock);
  });
}

export function mergeAccountsInDb(
  db: Database,
  sourceId: string,
  targetId: string,
  bookId?: string,
  onOp?: LocalOpBroadcastFn
): AccountRow {
  if (sourceId === targetId) {
    throw new TauriCommandError(
      "VALIDATION_ERROR",
      "Cannot merge an account into itself"
    );
  }

  const roots = resolveAccountRootsMap(db);
  return db.transaction("IMMEDIATE", (tx) => {
    const targetRow = tx.selectArray(
      "SELECT id, merged_into_id, is_deleted FROM accounts WHERE id = ?1",
      [targetId]
    );
    if (!targetRow) {
      throw new TauriCommandError("NOT_FOUND", `Target account ${targetId}`);
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
      throw new TauriCommandError("NOT_FOUND", `Source account ${sourceId}`);
    }

    const clock = loadClockFromDb(tx);
    const source: AccountRow = {
      id: String(s[0]),
      name: String(s[1]),
      account_type: String(s[2]) as AccountType,
      initial_balance: Number(s[3]),
      merged_into_id: targetId,
      is_deleted: Number(s[5]),
      updated_hlc: clock.tick(systemNowMs()).toString(),
    };

    validateAccountRow(source);
    writeLocalAccountOp(tx, source, clock.deviceId(), bookId, onOp);
    saveClockToDb(tx, clock);
    return source;
  });
}

export function getAccountBalancesInDb(db: Database): AccountBalanceItem[] {
  const roots = resolveAccountRootsMap(db);

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

