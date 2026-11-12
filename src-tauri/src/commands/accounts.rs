use super::models::{AccountBalanceItem, AccountView, UpsertAccountInput};
use crate::crdt::{
    resolve_account_roots_map, validate_account_row, write_local_account_op, AccountRow,
};
use crate::db::{new_uuid_v7, AppState};
use crate::error::{AppError, AppResult};
use crate::hlc::{load_clock_from_tx, save_clock_to_tx, system_now_ms};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use std::collections::HashMap;
use tauri::State;
pub fn list_accounts_in_conn(conn: &Connection) -> AppResult<Vec<AccountView>> {
    let roots = resolve_account_roots_map(conn)?;
    let mut stmt = conn.prepare(
        "SELECT id, name, account_type, initial_balance, merged_into_id, is_deleted, updated_hlc
         FROM accounts
         WHERE is_deleted = 0
         ORDER BY name ASC, id ASC",
    )?;
    let rows = stmt.query_map([], |row| {
        let id: String = row.get(0)?;
        let root_id = roots.get(&id).cloned().unwrap_or_else(|| id.clone());
        Ok(AccountView {
            id,
            name: row.get(1)?,
            account_type: row.get(2)?,
            initial_balance: row.get(3)?,
            merged_into_id: row.get(4)?,
            root_id,
            is_deleted: row.get(5)?,
            updated_hlc: row.get(6)?,
        })
    })?;

    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

pub fn upsert_account_in_conn(
    conn: &mut Connection,
    input: UpsertAccountInput,
) -> AppResult<AccountRow> {
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let mut clock = load_clock_from_tx(&tx)?;
    let hlc = clock.tick(system_now_ms())?.to_string();
    let device_id = clock.device_id().to_string();

    let id = input
        .id
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(new_uuid_v7);

    let existing_merged_into: Option<String> = tx
        .query_row(
            "SELECT merged_into_id FROM accounts WHERE id = ?1",
            params![id],
            |r| r.get(0),
        )
        .optional()?
        .flatten();

    let row = AccountRow {
        id,
        name: input.name.trim().to_string(),
        account_type: input.account_type.trim().to_uppercase(),
        initial_balance: input.initial_balance,
        merged_into_id: existing_merged_into,
        is_deleted: 0,
        updated_hlc: hlc,
    };

    write_local_account_op(&tx, &row, &device_id)?;
    save_clock_to_tx(&tx, &clock)?;
    tx.commit()?;
    Ok(row)
}

pub fn delete_account_in_conn(conn: &mut Connection, account_id: &str) -> AppResult<()> {
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let existing: Option<AccountRow> = tx
        .query_row(
            "SELECT id, name, account_type, initial_balance, merged_into_id, is_deleted, updated_hlc
             FROM accounts WHERE id = ?1",
            params![account_id],
            |r| {
                Ok(AccountRow {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    account_type: r.get(2)?,
                    initial_balance: r.get(3)?,
                    merged_into_id: r.get(4)?,
                    is_deleted: r.get(5)?,
                    updated_hlc: r.get(6)?,
                })
            },
        )
        .optional()?;

    let mut row =
        existing.ok_or_else(|| AppError::NotFound(format!("Account {}", account_id)))?;
    let mut clock = load_clock_from_tx(&tx)?;
    row.is_deleted = 1;
    row.updated_hlc = clock.tick(system_now_ms())?.to_string();
    let device_id = clock.device_id().to_string();

    write_local_account_op(&tx, &row, &device_id)?;
    save_clock_to_tx(&tx, &clock)?;
    tx.commit()?;
    Ok(())
}

pub fn merge_accounts_in_conn(
    conn: &mut Connection,
    source_id: &str,
    target_id: &str,
) -> AppResult<AccountRow> {
    if source_id == target_id {
        return Err(AppError::Validation(
            "Cannot merge an account into itself".into(),
        ));
    }

    let roots = resolve_account_roots_map(conn)?;
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;

    let target_row: Option<(String, Option<String>, i64)> = tx
        .query_row(
            "SELECT id, merged_into_id, is_deleted FROM accounts WHERE id = ?1",
            params![target_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .optional()?;

    let (_, target_merged_into, target_deleted) =
        target_row.ok_or_else(|| AppError::NotFound(format!("Target account {}", target_id)))?;

    if target_deleted != 0 {
        return Err(AppError::MergeConflict(
            "Target account is deleted".into(),
        ));
    }

    let target_root = roots
        .get(target_id)
        .cloned()
        .unwrap_or_else(|| target_id.to_string());
    if target_merged_into.is_some() || target_root != target_id {
        return Err(AppError::MergeConflict(format!(
            "Target account '{}' is already merged into '{}'; resolve to root first",
            target_id, target_root
        )));
    }

    let source_opt: Option<AccountRow> = tx
        .query_row(
            "SELECT id, name, account_type, initial_balance, merged_into_id, is_deleted, updated_hlc
             FROM accounts WHERE id = ?1",
            params![source_id],
            |r| {
                Ok(AccountRow {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    account_type: r.get(2)?,
                    initial_balance: r.get(3)?,
                    merged_into_id: r.get(4)?,
                    is_deleted: r.get(5)?,
                    updated_hlc: r.get(6)?,
                })
            },
        )
        .optional()?;

    let mut source =
        source_opt.ok_or_else(|| AppError::NotFound(format!("Source account {}", source_id)))?;
    let mut clock = load_clock_from_tx(&tx)?;
    source.merged_into_id = Some(target_id.to_string());
    source.updated_hlc = clock.tick(system_now_ms())?.to_string();
    let device_id = clock.device_id().to_string();

    validate_account_row(&source)?;
    write_local_account_op(&tx, &source, &device_id)?;
    save_clock_to_tx(&tx, &clock)?;
    tx.commit()?;
    Ok(source)
}

pub fn get_account_balances_in_conn(conn: &Connection) -> AppResult<Vec<AccountBalanceItem>> {
    let roots = resolve_account_roots_map(conn)?;

    #[derive(Debug, Clone)]
    struct RawAccount {
        id: String,
        name: String,
        account_type: String,
        initial_balance: i64,
    }

    let mut stmt = conn.prepare(
        "SELECT id, name, account_type, initial_balance
         FROM accounts
         WHERE is_deleted = 0
         ORDER BY id ASC",
    )?;
    let acc_iter = stmt.query_map([], |r| {
        Ok(RawAccount {
            id: r.get(0)?,
            name: r.get(1)?,
            account_type: r.get(2)?,
            initial_balance: r.get(3)?,
        })
    })?;

    let mut active_accounts = HashMap::new();
    for a in acc_iter {
        let acc = a?;
        active_accounts.insert(acc.id.clone(), acc);
    }

    let mut root_items: HashMap<String, AccountBalanceItem> = HashMap::new();

    for (acc_id, acc) in &active_accounts {
        let root_id = roots
            .get(acc_id)
            .cloned()
            .unwrap_or_else(|| acc_id.clone());
        let root_meta = active_accounts.get(&root_id).unwrap_or(acc);

        let entry = root_items.entry(root_id.clone()).or_insert_with(|| {
            AccountBalanceItem {
                account_id: root_id.clone(),
                name: root_meta.name.clone(),
                account_type: root_meta.account_type.clone(),
                initial_balance: 0,
                current_balance: 0,
                merged_member_ids: Vec::new(),
            }
        });

        entry.initial_balance = entry
            .initial_balance
            .checked_add(acc.initial_balance)
            .ok_or(AppError::ArithmeticOverflow)?;
        entry.current_balance = entry
            .current_balance
            .checked_add(acc.initial_balance)
            .ok_or(AppError::ArithmeticOverflow)?;
        if acc_id != &root_id {
            entry.merged_member_ids.push(acc_id.clone());
        }
    }

    let mut tx_stmt = conn.prepare(
        "SELECT account_id, to_account_id, amount, tx_type
         FROM transactions
         WHERE is_deleted = 0",
    )?;
    let tx_rows = tx_stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, Option<String>>(1)?,
            r.get::<_, i64>(2)?,
            r.get::<_, String>(3)?,
        ))
    })?;

    for r in tx_rows {
        let (acc_id, to_acc_id, amount, tx_type) = r?;
        let src_root = roots.get(&acc_id).cloned().unwrap_or(acc_id);

        match tx_type.as_str() {
            "INCOME" | "EXPENSE" => {
                if let Some(item) = root_items.get_mut(&src_root) {
                    item.current_balance = item
                        .current_balance
                        .checked_add(amount)
                        .ok_or(AppError::ArithmeticOverflow)?;
                }
            }
            "TRANSFER" => {
                if let Some(src_item) = root_items.get_mut(&src_root) {
                    src_item.current_balance = src_item
                        .current_balance
                        .checked_sub(amount)
                        .ok_or(AppError::ArithmeticOverflow)?;
                }
                if let Some(dst_raw) = to_acc_id {
                    let dst_root = roots.get(&dst_raw).cloned().unwrap_or(dst_raw);
                    if let Some(dst_item) = root_items.get_mut(&dst_root) {
                        dst_item.current_balance = dst_item
                            .current_balance
                            .checked_add(amount)
                            .ok_or(AppError::ArithmeticOverflow)?;
                    }
                }
            }
            _ => {}
        }
    }

    let mut result: Vec<AccountBalanceItem> = root_items.into_values().collect();
    result.sort_by(|a, b| a.name.cmp(&b.name).then_with(|| a.account_id.cmp(&b.account_id)));
    Ok(result)
}

#[tauri::command]
pub async fn list_accounts(
    state: State<'_, AppState>,
    book_id: String,
) -> AppResult<Vec<AccountView>> {
    state
        .with_book(&book_id, |conn| list_accounts_in_conn(conn))
        .await
}

#[tauri::command]
pub async fn upsert_account(
    state: State<'_, AppState>,
    book_id: String,
    input: UpsertAccountInput,
) -> AppResult<AccountRow> {
    let res = state
        .with_book(&book_id, move |conn| upsert_account_in_conn(conn, input))
        .await?;
    state.sync.trigger_sync_now(state.inner(), &book_id);
    Ok(res)
}

#[tauri::command]
pub async fn delete_account(
    state: State<'_, AppState>,
    book_id: String,
    account_id: String,
) -> AppResult<()> {
    state
        .with_book(&book_id, move |conn| delete_account_in_conn(conn, &account_id))
        .await?;
    state.sync.trigger_sync_now(state.inner(), &book_id);
    Ok(())
}

#[tauri::command]
pub async fn merge_accounts(
    state: State<'_, AppState>,
    book_id: String,
    source_id: String,
    target_id: String,
) -> AppResult<AccountRow> {
    let res = state
        .with_book(&book_id, move |conn| {
            merge_accounts_in_conn(conn, &source_id, &target_id)
        })
        .await?;
    state.sync.trigger_sync_now(state.inner(), &book_id);
    Ok(res)
}

#[tauri::command]
pub async fn get_account_balances(
    state: State<'_, AppState>,
    book_id: String,
) -> AppResult<Vec<AccountBalanceItem>> {
    state
        .with_book(&book_id, |conn| get_account_balances_in_conn(conn))
        .await
}

