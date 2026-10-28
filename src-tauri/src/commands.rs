use crate::crdt::{
    dedupe_categories, resolve_account_roots_map, validate_account_row, validate_budget_row,
    validate_category_row, validate_transaction_row, write_local_account_op, write_local_budget_op,
    write_local_category_op, write_local_transaction_op, AccountRow, BudgetRow, CategoryRow,
    TransactionRow, ACCOUNT_ROOTS_CTE_SQL,
};
use crate::db::{
    check_book_file_exists, deterministic_budget_id, ensure_system_category_in_tx, init_book_db,
    new_uuid_v7, normalize_category_name, now_iso8601, validate_book_id, AppState, BookMetadata,
    SYSTEM_CATEGORY_MODAL_ID, SYSTEM_CATEGORY_MODAL_NAME, SYSTEM_CATEGORY_PRIVE_ID,
    SYSTEM_CATEGORY_PRIVE_NAME,
};
use crate::error::{AppError, AppResult};
use crate::hlc::{load_clock_from_tx, save_clock_to_tx, system_now_ms};
use argon2::Argon2;
use chacha20poly1305::aead::{Aead, KeyInit};
use chacha20poly1305::{Key, XChaCha20Poly1305, XNonce};
use rand::RngCore;
use rusqlite::{params, params_from_iter, Connection, OptionalExtension, TransactionBehavior};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use tauri::State;
use zeroize::Zeroize;

// ============================================================================
// DTOs
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AccountView {
    pub id: String,
    pub name: String,
    pub account_type: String,
    pub initial_balance: i64,
    pub merged_into_id: Option<String>,
    pub root_id: String,
    pub is_deleted: i64,
    pub updated_hlc: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpsertAccountInput {
    pub id: Option<String>,
    pub name: String,
    pub account_type: String,
    pub initial_balance: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CategoryView {
    pub id: String,
    pub name: String,
    pub normalized_name: String,
    pub kind: String,
    pub merged_into_id: Option<String>,
    pub canonical_id: String,
    pub is_deleted: i64,
    pub updated_hlc: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpsertCategoryInput {
    pub id: Option<String>,
    pub name: String,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AddTransactionInput {
    pub id: Option<String>,
    pub account_id: String,
    pub to_account_id: Option<String>,
    pub category_id: Option<String>,
    pub amount: i64,
    pub tx_type: String,
    pub note: Option<String>,
    pub tx_date: String,
    pub link_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpdateTransactionInput {
    pub id: String,
    pub account_id: String,
    pub to_account_id: Option<String>,
    pub category_id: Option<String>,
    pub amount: i64,
    pub tx_type: String,
    pub note: Option<String>,
    pub tx_date: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TransactionView {
    pub id: String,
    pub account_id: String,
    pub account_name: String,
    pub to_account_id: Option<String>,
    pub to_account_name: Option<String>,
    pub category_id: Option<String>,
    pub category_name: Option<String>,
    pub amount: i64,
    pub tx_type: String,
    pub note: Option<String>,
    pub tx_date: String,
    pub created_by_device: String,
    pub link_id: Option<String>,
    pub updated_hlc: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TransactionFilter {
    pub start_date: Option<String>,
    pub end_date: Option<String>,
    pub account_id: Option<String>,
    pub category_id: Option<String>,
    pub tx_type: Option<String>,
    pub search: Option<String>,
    pub min_amount: Option<i64>,
    pub max_amount: Option<i64>,
    pub sort_by: Option<String>,
    pub sort_dir: Option<String>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PaginatedTransactions {
    pub items: Vec<TransactionView>,
    pub total: i64,
    pub limit: i64,
    pub offset: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransferBetweenBooksInput {
    pub from_book_id: String,
    pub from_account_id: String,
    pub to_book_id: String,
    pub to_account_id: String,
    pub amount: i64,
    pub tx_date: String,
    pub note: Option<String>,
    pub link_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransferBetweenBooksResult {
    pub link_id: String,
    pub expense_tx: TransactionRow,
    pub income_tx: TransactionRow,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AccountBalanceItem {
    pub account_id: String,
    pub name: String,
    pub account_type: String,
    pub initial_balance: i64,
    pub current_balance: i64,
    pub merged_member_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CashFlowMonthItem {
    pub month: String,
    pub income: i64,
    pub expense: i64,
    pub net: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UpsertBudgetInput {
    pub category_id: Option<String>,
    pub period: Option<String>,
    pub amount_limit: i64,
    pub alert_threshold_pct: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BudgetProgressItem {
    pub id: String,
    pub category_id: Option<String>,
    pub category_name: String,
    pub period: String,
    pub amount_limit: i64,
    pub alert_threshold_pct: i64,
    pub spent: i64,
    pub remaining: i64,
    pub pct: i64,
    pub status: String,
    pub updated_hlc: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SyncStatusPayload {
    pub book_id: String,
    pub state: String,
    pub peers: usize,
    pub last_synced_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PeerInfo {
    pub node_id: String,
    pub device_id: Option<String>,
    pub last_seen_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DailyCashFlowPoint {
    pub date: String,
    pub day: u32,
    pub income: i64,
    pub expense: i64,
    pub net: i64,
    pub cumulative_income: i64,
    pub cumulative_expense: i64,
    pub tx_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CategoryMonthlyBreakdownItem {
    pub category_id: String,
    pub category_name: String,
    pub kind: String,
    pub is_system: bool,
    pub current_amount: i64,
    pub prev_amount: i64,
    pub delta_amount: i64,
    pub delta_pct: Option<i64>,
    pub share_bps: i64,
    pub tx_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AccountReconciliationItem {
    pub account_id: String,
    pub account_name: String,
    pub account_type: String,
    pub opening_balance: i64,
    pub month_inflow: i64,
    pub month_outflow: i64,
    pub net_change: i64,
    pub closing_balance: i64,
    pub tx_count: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeviceContributionItem {
    pub device_id: String,
    pub tx_count: u32,
    pub total_income: i64,
    pub total_expense: i64,
    pub share_bps: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MonthlyReportResponse {
    pub month: String,
    pub prev_month: String,
    pub days_in_month: u32,
    pub elapsed_days: u32,
    pub no_spend_days: u32,
    pub tx_count: u32,
    pub operational_income: i64,
    pub operational_expense: i64,
    pub operational_net: i64,
    pub prev_operational_income: i64,
    pub prev_operational_expense: i64,
    pub capital_injection: i64,
    pub capital_withdrawal: i64,
    pub savings_rate_bps: i64,
    pub daily_burn_rate: i64,
    pub projected_month_expense: i64,
    pub total_budget_limit: Option<i64>,
    pub daily_series: Vec<DailyCashFlowPoint>,
    pub category_breakdown: Vec<CategoryMonthlyBreakdownItem>,
    pub account_reconciliation: Vec<AccountReconciliationItem>,
    pub device_contributions: Vec<DeviceContributionItem>,
    pub top_expenses: Vec<TransactionView>,
}

// ============================================================================
// Pure Database Operations (Testable without Tauri Runtime)
// ============================================================================

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

pub fn list_categories_in_conn(conn: &Connection) -> AppResult<Vec<CategoryView>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, normalized_name, kind, merged_into_id, COALESCE(merged_into_id, id) AS canonical_id, is_deleted, updated_hlc
         FROM categories
         WHERE is_deleted = 0
         ORDER BY kind ASC, name ASC, id ASC",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok(CategoryView {
            id: r.get(0)?,
            name: r.get(1)?,
            normalized_name: r.get(2)?,
            kind: r.get(3)?,
            merged_into_id: r.get(4)?,
            canonical_id: r.get(5)?,
            is_deleted: r.get(6)?,
            updated_hlc: r.get(7)?,
        })
    })?;

    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

pub fn upsert_category_in_conn(
    conn: &mut Connection,
    input: UpsertCategoryInput,
) -> AppResult<CategoryView> {
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let mut clock = load_clock_from_tx(&tx)?;
    let hlc = clock.tick(system_now_ms())?.to_string();
    let device_id = clock.device_id().to_string();

    let id = input
        .id
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(new_uuid_v7);
    let trimmed_name = input.name.trim().to_string();
    let normalized_name = normalize_category_name(&trimmed_name);
    if normalized_name.is_empty() {
        return Err(AppError::Validation(
            "Category name must contain at least one alphanumeric character".into(),
        ));
    }

    let row = CategoryRow {
        id: id.clone(),
        name: trimmed_name,
        normalized_name,
        kind: input.kind.trim().to_uppercase(),
        merged_into_id: None,
        is_deleted: 0,
        updated_hlc: hlc,
    };

    validate_category_row(&row)?;
    write_local_category_op(&tx, &row, &device_id)?;
    dedupe_categories(&tx)?;
    save_clock_to_tx(&tx, &clock)?;

    let view = tx.query_row(
        "SELECT id, name, normalized_name, kind, merged_into_id, COALESCE(merged_into_id, id), is_deleted, updated_hlc
         FROM categories WHERE id = ?1",
        params![id],
        |r| {
            Ok(CategoryView {
                id: r.get(0)?,
                name: r.get(1)?,
                normalized_name: r.get(2)?,
                kind: r.get(3)?,
                merged_into_id: r.get(4)?,
                canonical_id: r.get(5)?,
                is_deleted: r.get(6)?,
                updated_hlc: r.get(7)?,
            })
        },
    )?;

    tx.commit()?;
    Ok(view)
}

pub fn delete_category_in_conn(conn: &mut Connection, category_id: &str) -> AppResult<()> {
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let existing: Option<CategoryRow> = tx
        .query_row(
            "SELECT id, name, normalized_name, kind, merged_into_id, is_deleted, updated_hlc
             FROM categories WHERE id = ?1",
            params![category_id],
            |r| {
                Ok(CategoryRow {
                    id: r.get(0)?,
                    name: r.get(1)?,
                    normalized_name: r.get(2)?,
                    kind: r.get(3)?,
                    merged_into_id: r.get(4)?,
                    is_deleted: r.get(5)?,
                    updated_hlc: r.get(6)?,
                })
            },
        )
        .optional()?;

    let mut row =
        existing.ok_or_else(|| AppError::NotFound(format!("Category {}", category_id)))?;
    let mut clock = load_clock_from_tx(&tx)?;
    row.is_deleted = 1;
    row.merged_into_id = None;
    row.updated_hlc = clock.tick(system_now_ms())?.to_string();
    let device_id = clock.device_id().to_string();

    write_local_category_op(&tx, &row, &device_id)?;
    dedupe_categories(&tx)?;
    save_clock_to_tx(&tx, &clock)?;
    tx.commit()?;
    Ok(())
}

pub fn add_transaction_in_conn(
    conn: &mut Connection,
    input: AddTransactionInput,
) -> AppResult<TransactionRow> {
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let mut clock = load_clock_from_tx(&tx)?;
    let hlc = clock.tick(system_now_ms())?.to_string();
    let device_id = clock.device_id().to_string();

    let id = input
        .id
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(new_uuid_v7);

    let row = TransactionRow {
        id,
        account_id: input.account_id.trim().to_string(),
        to_account_id: input
            .to_account_id
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty()),
        category_id: input
            .category_id
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty()),
        amount: input.amount,
        tx_type: input.tx_type.trim().to_uppercase(),
        note: input
            .note
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty()),
        tx_date: input.tx_date.trim().to_string(),
        created_by_device: device_id.clone(),
        link_id: input
            .link_id
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty()),
        is_deleted: 0,
        updated_hlc: hlc,
    };

    validate_transaction_row(&row)?;
    write_local_transaction_op(&tx, &row, &device_id)?;
    save_clock_to_tx(&tx, &clock)?;
    tx.commit()?;
    Ok(row)
}

pub fn update_transaction_in_conn(
    conn: &mut Connection,
    input: UpdateTransactionInput,
) -> AppResult<TransactionRow> {
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let existing: Option<(String, Option<String>)> = tx
        .query_row(
            "SELECT created_by_device, link_id FROM transactions WHERE id = ?1 AND is_deleted = 0",
            params![input.id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;

    let (created_by_device, link_id) = existing
        .ok_or_else(|| AppError::NotFound(format!("Transaction {}", input.id)))?;

    let mut clock = load_clock_from_tx(&tx)?;
    let hlc = clock.tick(system_now_ms())?.to_string();
    let device_id = clock.device_id().to_string();

    let row = TransactionRow {
        id: input.id,
        account_id: input.account_id.trim().to_string(),
        to_account_id: input
            .to_account_id
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty()),
        category_id: input
            .category_id
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty()),
        amount: input.amount,
        tx_type: input.tx_type.trim().to_uppercase(),
        note: input
            .note
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty()),
        tx_date: input.tx_date.trim().to_string(),
        created_by_device,
        link_id,
        is_deleted: 0,
        updated_hlc: hlc,
    };

    validate_transaction_row(&row)?;
    write_local_transaction_op(&tx, &row, &device_id)?;
    save_clock_to_tx(&tx, &clock)?;
    tx.commit()?;
    Ok(row)
}

pub fn delete_transaction_in_conn(conn: &mut Connection, tx_id: &str) -> AppResult<()> {
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let existing: Option<TransactionRow> = tx
        .query_row(
            "SELECT id, account_id, to_account_id, category_id, amount, tx_type, note, tx_date, created_by_device, link_id, is_deleted, updated_hlc
             FROM transactions WHERE id = ?1",
            params![tx_id],
            |r| {
                Ok(TransactionRow {
                    id: r.get(0)?,
                    account_id: r.get(1)?,
                    to_account_id: r.get(2)?,
                    category_id: r.get(3)?,
                    amount: r.get(4)?,
                    tx_type: r.get(5)?,
                    note: r.get(6)?,
                    tx_date: r.get(7)?,
                    created_by_device: r.get(8)?,
                    link_id: r.get(9)?,
                    is_deleted: r.get(10)?,
                    updated_hlc: r.get(11)?,
                })
            },
        )
        .optional()?;

    let mut row =
        existing.ok_or_else(|| AppError::NotFound(format!("Transaction {}", tx_id)))?;
    let mut clock = load_clock_from_tx(&tx)?;
    row.is_deleted = 1;
    row.updated_hlc = clock.tick(system_now_ms())?.to_string();
    let device_id = clock.device_id().to_string();

    write_local_transaction_op(&tx, &row, &device_id)?;
    save_clock_to_tx(&tx, &clock)?;
    tx.commit()?;
    Ok(())
}

pub fn list_transactions_in_conn(
    conn: &Connection,
    filter: TransactionFilter,
) -> AppResult<PaginatedTransactions> {
    let limit = filter.limit.unwrap_or(50).clamp(1, 500);
    let offset = filter.offset.unwrap_or(0).max(0);

    let mut where_clauses = vec!["t.is_deleted = 0".to_string()];
    let mut sql_params: Vec<rusqlite::types::Value> = Vec::new();

    if let Some(ref start_date) = filter.start_date {
        if !start_date.trim().is_empty() {
            where_clauses.push("t.tx_date >= ?".to_string());
            sql_params.push(rusqlite::types::Value::Text(start_date.trim().to_string()));
        }
    }
    if let Some(ref end_date) = filter.end_date {
        if !end_date.trim().is_empty() {
            where_clauses.push("t.tx_date <= ?".to_string());
            sql_params.push(rusqlite::types::Value::Text(end_date.trim().to_string()));
        }
    }
    if let Some(ref account_id) = filter.account_id {
        if !account_id.trim().is_empty() {
            where_clauses.push(
                "(COALESCE(ar_src.root_id, t.account_id) = COALESCE((SELECT root_id FROM account_roots WHERE account_id = ?), ?)
                  OR COALESCE(ar_dst.root_id, t.to_account_id) = COALESCE((SELECT root_id FROM account_roots WHERE account_id = ?), ?))"
                    .to_string(),
            );
            let acc = account_id.trim().to_string();
            sql_params.push(rusqlite::types::Value::Text(acc.clone()));
            sql_params.push(rusqlite::types::Value::Text(acc.clone()));
            sql_params.push(rusqlite::types::Value::Text(acc.clone()));
            sql_params.push(rusqlite::types::Value::Text(acc));
        }
    }
    if let Some(ref category_id) = filter.category_id {
        if !category_id.trim().is_empty() {
            where_clauses.push(
                "COALESCE(c.merged_into_id, t.category_id) = COALESCE((SELECT COALESCE(merged_into_id, id) FROM categories WHERE id = ?), ?)"
                    .to_string(),
            );
            let cat = category_id.trim().to_string();
            sql_params.push(rusqlite::types::Value::Text(cat.clone()));
            sql_params.push(rusqlite::types::Value::Text(cat));
        }
    }
    if let Some(ref tx_type) = filter.tx_type {
        if !tx_type.trim().is_empty() {
            where_clauses.push("t.tx_type = ?".to_string());
            sql_params.push(rusqlite::types::Value::Text(
                tx_type.trim().to_uppercase(),
            ));
        }
    }
    if let Some(min_amount) = filter.min_amount {
        where_clauses.push("ABS(t.amount) >= ?".to_string());
        sql_params.push(rusqlite::types::Value::Integer(min_amount));
    }
    if let Some(max_amount) = filter.max_amount {
        where_clauses.push("ABS(t.amount) <= ?".to_string());
        sql_params.push(rusqlite::types::Value::Integer(max_amount));
    }
    if let Some(ref search) = filter.search {
        let trimmed = search.trim();
        if !trimmed.is_empty() {
            where_clauses.push(
                "(COALESCE(t.note, '') LIKE ? OR COALESCE(a_src.name, '') LIKE ? OR COALESCE(c_canon.name, c.name, '') LIKE ?)"
                    .to_string(),
            );
            let pattern = format!("%{}%", trimmed);
            sql_params.push(rusqlite::types::Value::Text(pattern.clone()));
            sql_params.push(rusqlite::types::Value::Text(pattern.clone()));
            sql_params.push(rusqlite::types::Value::Text(pattern));
        }
    }

    let where_sql = where_clauses.join(" AND ");

    let sort_col = match filter.sort_by.as_deref() {
        Some("amount") => "ABS(t.amount)",
        Some("updated_hlc") => "t.updated_hlc",
        _ => "t.tx_date",
    };
    let sort_dir = match filter.sort_dir.as_deref() {
        Some("asc") | Some("ASC") => "ASC",
        _ => "DESC",
    };

    let base_from_sql = format!(
        "FROM transactions t
         LEFT JOIN account_roots ar_src ON ar_src.account_id = t.account_id
         LEFT JOIN accounts a_src ON a_src.id = COALESCE(ar_src.root_id, t.account_id)
         LEFT JOIN account_roots ar_dst ON ar_dst.account_id = t.to_account_id
         LEFT JOIN accounts a_dst ON a_dst.id = COALESCE(ar_dst.root_id, t.to_account_id)
         LEFT JOIN categories c ON c.id = t.category_id
         LEFT JOIN categories c_canon ON c_canon.id = COALESCE(c.merged_into_id, c.id)
         WHERE {}",
        where_sql
    );

    let count_sql = format!(
        "{} SELECT COUNT(*) {}",
        ACCOUNT_ROOTS_CTE_SQL, base_from_sql
    );
    let total: i64 = conn.query_row(&count_sql, params_from_iter(sql_params.iter()), |r| {
        r.get(0)
    })?;

    let mut data_params = sql_params;
    data_params.push(rusqlite::types::Value::Integer(limit));
    data_params.push(rusqlite::types::Value::Integer(offset));

    let select_sql = format!(
        "{}
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
         {}
         ORDER BY {} {}, t.updated_hlc DESC, t.id DESC
         LIMIT ? OFFSET ?",
        ACCOUNT_ROOTS_CTE_SQL, base_from_sql, sort_col, sort_dir
    );

    let mut stmt = conn.prepare(&select_sql)?;
    let rows = stmt.query_map(params_from_iter(data_params.iter()), |r| {
        Ok(TransactionView {
            id: r.get(0)?,
            account_id: r.get(1)?,
            account_name: r.get(2)?,
            to_account_id: r.get(3)?,
            to_account_name: r.get(4)?,
            category_id: r.get(5)?,
            category_name: r.get(6)?,
            amount: r.get(7)?,
            tx_type: r.get(8)?,
            note: r.get(9)?,
            tx_date: r.get(10)?,
            created_by_device: r.get(11)?,
            link_id: r.get(12)?,
            updated_hlc: r.get(13)?,
        })
    })?;

    let mut items = Vec::new();
    for r in rows {
        items.push(r?);
    }

    Ok(PaginatedTransactions {
        items,
        total,
        limit,
        offset,
    })
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

pub fn get_cash_flow_summary_in_conn(
    conn: &Connection,
    months_limit: usize,
) -> AppResult<Vec<CashFlowMonthItem>> {
    let limit = months_limit.clamp(1, 36) as i64;
    let mut stmt = conn.prepare(
        "SELECT
            substr(tx_date, 1, 7) AS month,
            COALESCE(SUM(CASE WHEN tx_type = 'INCOME' THEN amount ELSE 0 END), 0) AS income,
            COALESCE(SUM(CASE WHEN tx_type = 'EXPENSE' THEN -amount ELSE 0 END), 0) AS expense
         FROM transactions
         WHERE is_deleted = 0
           AND tx_type IN ('INCOME', 'EXPENSE')
         GROUP BY substr(tx_date, 1, 7)
         ORDER BY month DESC
         LIMIT ?1",
    )?;

    let rows = stmt.query_map(params![limit], |r| {
        let month: String = r.get(0)?;
        let income: i64 = r.get(1)?;
        let expense: i64 = r.get(2)?;
        let net = income.saturating_sub(expense);
        Ok(CashFlowMonthItem {
            month,
            income,
            expense,
            net,
        })
    })?;

    let mut items = Vec::new();
    for r in rows {
        items.push(r?);
    }
    items.reverse();
    Ok(items)
}

pub fn upsert_budget_in_conn(
    conn: &mut Connection,
    input: UpsertBudgetInput,
) -> AppResult<BudgetRow> {
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let period = input
        .period
        .unwrap_or_else(|| "MONTHLY".to_string())
        .trim()
        .to_uppercase();
    let alert_threshold_pct = input.alert_threshold_pct.unwrap_or(80);
    let category_id = input
        .category_id
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    if let Some(ref cat_id) = category_id {
        let cat_kind: Option<String> = tx
            .query_row(
                "SELECT kind FROM categories WHERE id = ?1",
                params![cat_id],
                |r| r.get(0),
            )
            .optional()?;
        if let Some(kind) = cat_kind {
            if kind != "EXPENSE" {
                return Err(AppError::Validation(
                    "Budgets can only be created for EXPENSE categories".into(),
                ));
            }
        }
    }

    let id = deterministic_budget_id(category_id.as_deref(), &period);
    let mut clock = load_clock_from_tx(&tx)?;
    let hlc = clock.tick(system_now_ms())?.to_string();
    let device_id = clock.device_id().to_string();

    let row = BudgetRow {
        id,
        category_id,
        period,
        amount_limit: input.amount_limit,
        alert_threshold_pct,
        is_deleted: 0,
        updated_hlc: hlc,
    };

    validate_budget_row(&row)?;
    write_local_budget_op(&tx, &row, &device_id)?;
    save_clock_to_tx(&tx, &clock)?;
    tx.commit()?;
    Ok(row)
}

pub fn delete_budget_in_conn(conn: &mut Connection, budget_id: &str) -> AppResult<()> {
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let existing: Option<BudgetRow> = tx
        .query_row(
            "SELECT id, category_id, period, amount_limit, alert_threshold_pct, is_deleted, updated_hlc
             FROM budgets WHERE id = ?1",
            params![budget_id],
            |r| {
                Ok(BudgetRow {
                    id: r.get(0)?,
                    category_id: r.get(1)?,
                    period: r.get(2)?,
                    amount_limit: r.get(3)?,
                    alert_threshold_pct: r.get(4)?,
                    is_deleted: r.get(5)?,
                    updated_hlc: r.get(6)?,
                })
            },
        )
        .optional()?;

    let mut row = existing.ok_or_else(|| AppError::NotFound(format!("Budget {}", budget_id)))?;
    let mut clock = load_clock_from_tx(&tx)?;
    row.is_deleted = 1;
    row.updated_hlc = clock.tick(system_now_ms())?.to_string();
    let device_id = clock.device_id().to_string();

    write_local_budget_op(&tx, &row, &device_id)?;
    save_clock_to_tx(&tx, &clock)?;
    tx.commit()?;
    Ok(())
}

pub fn list_budgets_in_conn(conn: &Connection) -> AppResult<Vec<BudgetRow>> {
    let mut stmt = conn.prepare(
        "WITH active_budgets_raw AS (
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
        ORDER BY resolved_category_id IS NOT NULL ASC, id ASC",
    )?;

    let rows = stmt.query_map([], |r| {
        Ok(BudgetRow {
            id: r.get(0)?,
            category_id: r.get(1)?,
            period: r.get(2)?,
            amount_limit: r.get(3)?,
            alert_threshold_pct: r.get(4)?,
            is_deleted: r.get(5)?,
            updated_hlc: r.get(6)?,
        })
    })?;

    let mut out = Vec::new();
    for r in rows {
        out.push(r?);
    }
    Ok(out)
}

pub fn parse_month_bounds(month: &str) -> AppResult<(String, String)> {
    let trimmed = month.trim();
    if trimmed.len() != 7 || trimmed.as_bytes()[4] != b'-' {
        return Err(AppError::Validation(format!(
            "Invalid month format '{}', expected YYYY-MM",
            month
        )));
    }
    let year: i32 = trimmed[0..4]
        .parse()
        .map_err(|_| AppError::Validation(format!("Invalid year in month '{}'", month)))?;
    let month_num: u32 = trimmed[5..7]
        .parse()
        .map_err(|_| AppError::Validation(format!("Invalid month number in '{}'", month)))?;
    if !(1..=12).contains(&month_num) {
        return Err(AppError::Validation(format!(
            "Month number must be between 01 and 12 in '{}'",
            month
        )));
    }

    let start_date = format!("{:04}-{:02}-01", year, month_num);
    let end_date = if month_num == 12 {
        format!("{:04}-01-01", year + 1)
    } else {
        format!("{:04}-{:02}-01", year, month_num + 1)
    };
    Ok((start_date, end_date))
}

pub fn get_budget_progress_in_conn(
    conn: &Connection,
    month: &str,
) -> AppResult<Vec<BudgetProgressItem>> {
    let (start_date, end_date) = parse_month_bounds(month)?;
    let prive_norm = normalize_category_name(SYSTEM_CATEGORY_PRIVE_NAME);

    // Single query without N+1 (Section 7.4)
    let mut stmt = conn.prepare(
        "WITH active_budgets_raw AS (
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
        FROM deduped_budgets db",
    )?;

    let rows = stmt.query_map(
        params![
            start_date,
            end_date,
            SYSTEM_CATEGORY_PRIVE_ID,
            prive_norm
        ],
        |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, Option<String>>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, i64>(4)?,
                r.get::<_, i64>(5)?,
                r.get::<_, String>(6)?,
                r.get::<_, i64>(7)?,
            ))
        },
    )?;

    let mut items = Vec::new();
    for r in rows {
        let (
            id,
            category_id,
            category_name,
            period,
            amount_limit,
            alert_threshold_pct,
            updated_hlc,
            spent,
        ) = r?;
        let spent = spent.max(0);
        let remaining = amount_limit
            .checked_sub(spent)
            .ok_or(AppError::ArithmeticOverflow)?;
        let pct_i128 = (spent as i128)
            .checked_mul(100)
            .ok_or(AppError::ArithmeticOverflow)?
            / (amount_limit as i128);
        let pct = i64::try_from(pct_i128).map_err(|_| AppError::ArithmeticOverflow)?;

        let status = if pct < alert_threshold_pct {
            "OK".to_string()
        } else if pct <= 100 {
            "WARNING".to_string()
        } else {
            "OVER".to_string()
        };

        items.push(BudgetProgressItem {
            id,
            category_id,
            category_name,
            period,
            amount_limit,
            alert_threshold_pct,
            spent,
            remaining,
            pct,
            status,
            updated_hlc,
        });
    }

    items.sort_by(|a, b| b.pct.cmp(&a.pct).then_with(|| a.id.cmp(&b.id)));
    Ok(items)
}

pub fn days_in_year_month(year: i32, month_num: u32) -> u32 {
    match month_num {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => {
            if (year % 4 == 0 && year % 100 != 0) || (year % 400 == 0) {
                29
            } else {
                28
            }
        }
        _ => 30,
    }
}

pub fn previous_year_month(month: &str) -> AppResult<String> {
    let trimmed = month.trim();
    if trimmed.len() != 7 || trimmed.as_bytes()[4] != b'-' {
        return Err(AppError::Validation(format!(
            "Invalid month format '{}', expected YYYY-MM",
            month
        )));
    }
    let year: i32 = trimmed[0..4]
        .parse()
        .map_err(|_| AppError::Validation(format!("Invalid year in month '{}'", month)))?;
    let month_num: u32 = trimmed[5..7]
        .parse()
        .map_err(|_| AppError::Validation(format!("Invalid month number in '{}'", month)))?;
    if !(1..=12).contains(&month_num) {
        return Err(AppError::Validation(format!(
            "Month number must be between 01 and 12 in '{}'",
            month
        )));
    }
    if month_num == 1 {
        Ok(format!("{:04}-12", year - 1))
    } else {
        Ok(format!("{:04}-{:02}", year, month_num - 1))
    }
}

pub fn get_monthly_report_in_conn(
    conn: &Connection,
    month: &str,
) -> AppResult<MonthlyReportResponse> {
    let trimmed_month = month.trim().to_string();
    let (start_date, end_date) = parse_month_bounds(&trimmed_month)?;
    let prev_month = previous_year_month(&trimmed_month)?;
    let (prev_start_date, prev_end_date) = parse_month_bounds(&prev_month)?;

    let year: i32 = trimmed_month[0..4]
        .parse()
        .map_err(|_| AppError::Validation("Invalid year".into()))?;
    let month_num: u32 = trimmed_month[5..7]
        .parse()
        .map_err(|_| AppError::Validation("Invalid month".into()))?;
    let days_in_month = days_in_year_month(year, month_num);

    let prive_norm = normalize_category_name(SYSTEM_CATEGORY_PRIVE_NAME);
    let modal_norm = normalize_category_name(SYSTEM_CATEGORY_MODAL_NAME);

    // 1. Resolve canonical category metadata
    let mut cat_meta: HashMap<String, (String, String, String)> = HashMap::new();
    {
        let mut stmt = conn.prepare(
            "SELECT
                c.id,
                COALESCE(c_canon.id, c.id) AS canonical_id,
                COALESCE(c_canon.name, c.name) AS canonical_name,
                COALESCE(c_canon.normalized_name, c.normalized_name) AS canonical_norm,
                COALESCE(c_canon.kind, c.kind) AS canonical_kind
             FROM categories c
             LEFT JOIN categories c_canon ON c_canon.id = COALESCE(c.merged_into_id, c.id)",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
            ))
        })?;
        for r in rows {
            let (raw_id, canon_id, canon_name, canon_norm, canon_kind) = r?;
            cat_meta.insert(
                raw_id,
                (canon_id.clone(), canon_name.clone(), canon_norm.clone()),
            );
            cat_meta
                .entry(canon_id.clone())
                .or_insert((canon_id, canon_name, canon_norm));
            let _ = canon_kind;
        }
    }

    // 2. Scan previous month transactions for MoM comparison
    let mut prev_operational_income: i64 = 0;
    let mut prev_operational_expense: i64 = 0;
    let mut prev_cat_totals: HashMap<(String, String), i64> = HashMap::new();
    {
        let mut stmt = conn.prepare(
            "SELECT category_id, amount, tx_type
             FROM transactions
             WHERE is_deleted = 0
               AND tx_date >= ?1
               AND tx_date < ?2
               AND tx_type IN ('INCOME', 'EXPENSE')",
        )?;
        let rows = stmt.query_map(params![prev_start_date, prev_end_date], |r| {
            Ok((
                r.get::<_, Option<String>>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, String>(2)?,
            ))
        })?;
        for r in rows {
            let (cat_id_opt, amount, tx_type) = r?;
            let (canon_id, _canon_name, canon_norm) = cat_id_opt
                .as_deref()
                .and_then(|cid| cat_meta.get(cid).cloned())
                .unwrap_or_else(|| {
                    (
                        "__UNCATEGORIZED__".to_string(),
                        "Tanpa Kategori".to_string(),
                        String::new(),
                    )
                });
            let abs_amt = amount.unsigned_abs() as i64;
            let is_sys = canon_id == SYSTEM_CATEGORY_PRIVE_ID
                || canon_id == SYSTEM_CATEGORY_MODAL_ID
                || canon_norm == prive_norm
                || canon_norm == modal_norm;

            if tx_type == "INCOME" && !is_sys {
                prev_operational_income = prev_operational_income.saturating_add(abs_amt);
            } else if tx_type == "EXPENSE" && !is_sys {
                prev_operational_expense = prev_operational_expense.saturating_add(abs_amt);
            }
            let entry = prev_cat_totals
                .entry((canon_id, tx_type))
                .or_insert(0);
            *entry = entry.saturating_add(abs_amt);
        }
    }

    // 3. Scan current month transactions for KPIs, Daily Series, Category Breakdown, Device Breakdown
    let mut daily_income = vec![0i64; days_in_month as usize];
    let mut daily_expense = vec![0i64; days_in_month as usize];
    let mut daily_tx_count = vec![0u32; days_in_month as usize];

    let mut operational_income: i64 = 0;
    let mut operational_expense: i64 = 0;
    let mut capital_injection: i64 = 0;
    let mut capital_withdrawal: i64 = 0;
    let mut tx_count: u32 = 0;
    let mut max_active_day: u32 = 1;

    // Key: (canon_cat_id, tx_type) -> (canon_name, is_system, current_amount, tx_count)
    let mut curr_cat_map: HashMap<(String, String), (String, bool, i64, u32)> = HashMap::new();
    // Key: device_id -> (tx_count, income, expense)
    let mut device_map: HashMap<String, (u32, i64, i64)> = HashMap::new();

    {
        let mut stmt = conn.prepare(
            "SELECT category_id, amount, tx_type, tx_date, created_by_device
             FROM transactions
             WHERE is_deleted = 0
               AND tx_date >= ?1
               AND tx_date < ?2",
        )?;
        let rows = stmt.query_map(params![start_date, end_date], |r| {
            Ok((
                r.get::<_, Option<String>>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
            ))
        })?;

        for r in rows {
            let (cat_id_opt, amount, tx_type, tx_date, device_id) = r?;
            tx_count = tx_count.saturating_add(1);

            let day_num: u32 = tx_date
                .get(8..10)
                .and_then(|s| s.parse::<u32>().ok())
                .unwrap_or(1)
                .clamp(1, days_in_month);
            max_active_day = max_active_day.max(day_num);
            let day_idx = (day_num - 1) as usize;
            daily_tx_count[day_idx] = daily_tx_count[day_idx].saturating_add(1);

            let abs_amt = amount.unsigned_abs() as i64;
            let dev_entry = device_map.entry(device_id).or_insert((0, 0, 0));
            dev_entry.0 = dev_entry.0.saturating_add(1);

            if tx_type == "INCOME" || tx_type == "EXPENSE" {
                let (canon_id, canon_name, canon_norm) = cat_id_opt
                    .as_deref()
                    .and_then(|cid| cat_meta.get(cid).cloned())
                    .unwrap_or_else(|| {
                        (
                            "__UNCATEGORIZED__".to_string(),
                            "Tanpa Kategori".to_string(),
                            String::new(),
                        )
                    });

                let is_prive =
                    canon_id == SYSTEM_CATEGORY_PRIVE_ID || canon_norm == prive_norm;
                let is_modal =
                    canon_id == SYSTEM_CATEGORY_MODAL_ID || canon_norm == modal_norm;
                let is_sys = is_prive || is_modal;

                if tx_type == "INCOME" {
                    dev_entry.1 = dev_entry.1.saturating_add(abs_amt);
                    if is_modal {
                        capital_injection = capital_injection.saturating_add(abs_amt);
                    } else {
                        operational_income = operational_income.saturating_add(abs_amt);
                        daily_income[day_idx] = daily_income[day_idx].saturating_add(abs_amt);
                    }
                } else {
                    dev_entry.2 = dev_entry.2.saturating_add(abs_amt);
                    if is_prive {
                        capital_withdrawal = capital_withdrawal.saturating_add(abs_amt);
                    } else {
                        operational_expense = operational_expense.saturating_add(abs_amt);
                        daily_expense[day_idx] = daily_expense[day_idx].saturating_add(abs_amt);
                    }
                }

                let cat_entry = curr_cat_map
                    .entry((canon_id, tx_type))
                    .or_insert((canon_name, is_sys, 0, 0));
                cat_entry.2 = cat_entry.2.saturating_add(abs_amt);
                cat_entry.3 = cat_entry.3.saturating_add(1);
            }
        }
    }

    // Also include categories that had transactions in prev_month but 0 in current_month
    for ((prev_cat_id, prev_kind), _prev_amt) in &prev_cat_totals {
        if !curr_cat_map.contains_key(&(prev_cat_id.clone(), prev_kind.clone())) {
            let (canon_id, canon_name, canon_norm) = cat_meta
                .get(prev_cat_id)
                .cloned()
                .unwrap_or_else(|| {
                    (
                        prev_cat_id.clone(),
                        "Kategori Lainnya".to_string(),
                        String::new(),
                    )
                });
            let is_sys = canon_id == SYSTEM_CATEGORY_PRIVE_ID
                || canon_id == SYSTEM_CATEGORY_MODAL_ID
                || canon_norm == prive_norm
                || canon_norm == modal_norm;
            curr_cat_map.insert(
                (prev_cat_id.clone(), prev_kind.clone()),
                (canon_name, is_sys, 0, 0),
            );
        }
    }

    // Build daily series
    let mut daily_series = Vec::with_capacity(days_in_month as usize);
    let mut cum_inc: i64 = 0;
    let mut cum_exp: i64 = 0;
    for d in 1..=days_in_month {
        let idx = (d - 1) as usize;
        let inc = daily_income[idx];
        let exp = daily_expense[idx];
        cum_inc = cum_inc.saturating_add(inc);
        cum_exp = cum_exp.saturating_add(exp);
        daily_series.push(DailyCashFlowPoint {
            date: format!("{}-{:02}", trimmed_month, d),
            day: d,
            income: inc,
            expense: exp,
            net: inc.saturating_sub(exp),
            cumulative_income: cum_inc,
            cumulative_expense: cum_exp,
            tx_count: daily_tx_count[idx],
        });
    }

    // Determine elapsed days for burn rate & no-spend days
    let now_str = now_iso8601();
    let current_ym = now_str.get(0..7).unwrap_or("");
    let today_day = now_str
        .get(8..10)
        .and_then(|s| s.parse::<u32>().ok())
        .unwrap_or(days_in_month);

    let elapsed_days = if trimmed_month.as_str() < current_ym {
        days_in_month
    } else if trimmed_month.as_str() == current_ym {
        today_day.max(max_active_day).clamp(1, days_in_month)
    } else {
        max_active_day.clamp(1, days_in_month)
    };

    let mut no_spend_days: u32 = 0;
    for d in 1..=elapsed_days {
        if daily_expense[(d - 1) as usize] == 0 {
            no_spend_days += 1;
        }
    }

    let operational_net = operational_income.saturating_sub(operational_expense);
    let savings_rate_bps = if operational_income > 0 {
        let bps = (operational_net as i128) * 10_000 / (operational_income as i128);
        i64::try_from(bps).unwrap_or(0)
    } else {
        0
    };

    let daily_burn_rate = operational_expense / (elapsed_days.max(1) as i64);
    let projected_month_expense = daily_burn_rate.saturating_mul(days_in_month as i64);

    // Budget ceiling for month (use Total Pengeluaran budget if set, otherwise sum of category budgets)
    let budget_progress = get_budget_progress_in_conn(conn, &trimmed_month)?;
    let total_budget_limit = if let Some(all_b) =
        budget_progress.iter().find(|b| b.category_id.is_none())
    {
        Some(all_b.amount_limit)
    } else if !budget_progress.is_empty() {
        Some(
            budget_progress
                .iter()
                .fold(0i64, |acc, b| acc.saturating_add(b.amount_limit)),
        )
    } else {
        None
    };

    // Build Category Breakdown
    let total_exp_all = operational_expense.saturating_add(capital_withdrawal);
    let total_inc_all = operational_income.saturating_add(capital_injection);

    let mut category_breakdown = Vec::with_capacity(curr_cat_map.len());
    for ((cat_id, kind), (cat_name, is_system, curr_amt, cnt)) in curr_cat_map {
        let prev_amt = prev_cat_totals
            .get(&(cat_id.clone(), kind.clone()))
            .copied()
            .unwrap_or(0);
        let delta_amount = curr_amt.saturating_sub(prev_amt);
        let delta_pct = if prev_amt > 0 {
            let p = (delta_amount as i128) * 100 / (prev_amt as i128);
            Some(i64::try_from(p).unwrap_or(0))
        } else {
            None
        };
        let denom = if kind == "EXPENSE" {
            total_exp_all
        } else {
            total_inc_all
        };
        let share_bps = if denom > 0 {
            let bps = (curr_amt as i128) * 10_000 / (denom as i128);
            i64::try_from(bps).unwrap_or(0)
        } else {
            0
        };
        category_breakdown.push(CategoryMonthlyBreakdownItem {
            category_id: cat_id,
            category_name: cat_name,
            kind,
            is_system,
            current_amount: curr_amt,
            prev_amount: prev_amt,
            delta_amount,
            delta_pct,
            share_bps,
            tx_count: cnt,
        });
    }
    category_breakdown.sort_by(|a, b| {
        a.kind
            .cmp(&b.kind)
            .then_with(|| b.current_amount.cmp(&a.current_amount))
            .then_with(|| b.prev_amount.cmp(&a.prev_amount))
            .then_with(|| a.category_name.cmp(&b.category_name))
    });

    // 4. Account Reconciliation (Opening Balance < start_date, Inflow/Outflow in [start_date, end_date), Closing Balance)
    let roots = resolve_account_roots_map(conn)?;
    let mut recon_map: HashMap<String, AccountReconciliationItem> = HashMap::new();
    {
        let mut stmt = conn.prepare(
            "SELECT id, name, account_type, initial_balance, merged_into_id
             FROM accounts
             WHERE is_deleted = 0",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, i64>(3)?,
                r.get::<_, Option<String>>(4)?,
            ))
        })?;
        let mut all_accs = Vec::new();
        for r in rows {
            all_accs.push(r?);
        }
        for (id, name, acc_type, init_bal, merged_into) in &all_accs {
            let root_id = roots.get(id).cloned().unwrap_or_else(|| id.clone());
            if merged_into.is_none() || &root_id == id {
                let entry = recon_map
                    .entry(root_id.clone())
                    .or_insert(AccountReconciliationItem {
                        account_id: root_id,
                        account_name: name.clone(),
                        account_type: acc_type.clone(),
                        opening_balance: 0,
                        month_inflow: 0,
                        month_outflow: 0,
                        net_change: 0,
                        closing_balance: 0,
                        tx_count: 0,
                    });
                entry.account_name = name.clone();
                entry.account_type = acc_type.clone();
                entry.opening_balance = entry.opening_balance.saturating_add(*init_bal);
            }
        }
        for (id, _name, _acc_type, init_bal, merged_into) in &all_accs {
            if merged_into.is_some() {
                let root_id = roots.get(id).cloned().unwrap_or_else(|| id.clone());
                if &root_id != id {
                    if let Some(root_item) = recon_map.get_mut(&root_id) {
                        root_item.opening_balance =
                            root_item.opening_balance.saturating_add(*init_bal);
                    }
                }
            }
        }
    }

    {
        let mut stmt = conn.prepare(
            "SELECT account_id, to_account_id, amount, tx_type, tx_date
             FROM transactions
             WHERE is_deleted = 0
               AND tx_date < ?1",
        )?;
        let rows = stmt.query_map(params![end_date], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, Option<String>>(1)?,
                r.get::<_, i64>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
            ))
        })?;
        for r in rows {
            let (acc_id, to_acc_id, amount, tx_type, tx_date) = r?;
            let src_root = roots.get(&acc_id).cloned().unwrap_or(acc_id);
            let is_before_month = tx_date < start_date;
            let abs_amt = amount.unsigned_abs() as i64;

            if is_before_month {
                match tx_type.as_str() {
                    "INCOME" | "EXPENSE" => {
                        if let Some(item) = recon_map.get_mut(&src_root) {
                            item.opening_balance = item.opening_balance.saturating_add(amount);
                        }
                    }
                    "TRANSFER" => {
                        if let Some(item) = recon_map.get_mut(&src_root) {
                            item.opening_balance = item.opening_balance.saturating_sub(abs_amt);
                        }
                        if let Some(dst_raw) = to_acc_id {
                            let dst_root = roots.get(&dst_raw).cloned().unwrap_or(dst_raw);
                            if let Some(dst_item) = recon_map.get_mut(&dst_root) {
                                dst_item.opening_balance =
                                    dst_item.opening_balance.saturating_add(abs_amt);
                            }
                        }
                    }
                    _ => {}
                }
            } else {
                // Inside [start_date, end_date)
                match tx_type.as_str() {
                    "INCOME" => {
                        if let Some(item) = recon_map.get_mut(&src_root) {
                            item.month_inflow = item.month_inflow.saturating_add(abs_amt);
                            item.tx_count = item.tx_count.saturating_add(1);
                        }
                    }
                    "EXPENSE" => {
                        if let Some(item) = recon_map.get_mut(&src_root) {
                            item.month_outflow = item.month_outflow.saturating_add(abs_amt);
                            item.tx_count = item.tx_count.saturating_add(1);
                        }
                    }
                    "TRANSFER" => {
                        if let Some(item) = recon_map.get_mut(&src_root) {
                            item.month_outflow = item.month_outflow.saturating_add(abs_amt);
                            item.tx_count = item.tx_count.saturating_add(1);
                        }
                        if let Some(dst_raw) = to_acc_id {
                            let dst_root = roots.get(&dst_raw).cloned().unwrap_or(dst_raw);
                            if let Some(dst_item) = recon_map.get_mut(&dst_root) {
                                dst_item.month_inflow =
                                    dst_item.month_inflow.saturating_add(abs_amt);
                                dst_item.tx_count = dst_item.tx_count.saturating_add(1);
                            }
                        }
                    }
                    _ => {}
                }
            }
        }
    }

    let mut account_reconciliation: Vec<AccountReconciliationItem> = recon_map
        .into_values()
        .map(|mut item| {
            item.net_change = item.month_inflow.saturating_sub(item.month_outflow);
            item.closing_balance = item.opening_balance.saturating_add(item.net_change);
            item
        })
        .collect();
    account_reconciliation.sort_by(|a, b| {
        a.account_name
            .cmp(&b.account_name)
            .then_with(|| a.account_id.cmp(&b.account_id))
    });

    // 5. Device Contributions
    let total_dev_tx = tx_count.max(1) as i128;
    let mut device_contributions: Vec<DeviceContributionItem> = device_map
        .into_iter()
        .map(|(device_id, (cnt, inc, exp))| {
            let share_bps = i64::try_from((cnt as i128) * 10_000 / total_dev_tx).unwrap_or(0);
            DeviceContributionItem {
                device_id,
                tx_count: cnt,
                total_income: inc,
                total_expense: exp,
                share_bps,
            }
        })
        .collect();
    device_contributions.sort_by(|a, b| {
        b.tx_count
            .cmp(&a.tx_count)
            .then_with(|| a.device_id.cmp(&b.device_id))
    });

    // 6. Top 5 Expenses in Month
    let month_end_inclusive = format!("{}-{:02}", trimmed_month, days_in_month);
    let top_tx_page = list_transactions_in_conn(
        conn,
        TransactionFilter {
            start_date: Some(start_date),
            end_date: Some(month_end_inclusive),
            tx_type: Some("EXPENSE".to_string()),
            sort_by: Some("amount".to_string()),
            sort_dir: Some("asc".to_string()), // Most negative first = largest expense
            limit: Some(5),
            offset: Some(0),
            ..Default::default()
        },
    )?;

    Ok(MonthlyReportResponse {
        month: trimmed_month,
        prev_month,
        days_in_month,
        elapsed_days,
        no_spend_days,
        tx_count,
        operational_income,
        operational_expense,
        operational_net,
        prev_operational_income,
        prev_operational_expense,
        capital_injection,
        capital_withdrawal,
        savings_rate_bps,
        daily_burn_rate,
        projected_month_expense,
        total_budget_limit,
        daily_series,
        category_breakdown,
        account_reconciliation,
        device_contributions,
        top_expenses: top_tx_page.items,
    })
}

// ============================================================================
// Tauri IPC Commands (Section 7)
// ============================================================================

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

#[tauri::command]
pub async fn create_book(
    state: State<'_, AppState>,
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

    let state_clone = state.inner().clone();
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
        pool_guard.insert(meta_clone.id, std::sync::Arc::new(std::sync::Mutex::new(conn)));
        Ok(())
    })
    .await
    .map_err(|e| AppError::TaskJoin(e.to_string()))??;

    let _ = state.sync.start_book_sync(state.inner(), &meta.id).await;
    Ok(meta)
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
pub async fn list_categories(
    state: State<'_, AppState>,
    book_id: String,
) -> AppResult<Vec<CategoryView>> {
    state
        .with_book(&book_id, |conn| list_categories_in_conn(conn))
        .await
}

#[tauri::command]
pub async fn upsert_category(
    state: State<'_, AppState>,
    book_id: String,
    input: UpsertCategoryInput,
) -> AppResult<CategoryView> {
    let res = state
        .with_book(&book_id, move |conn| upsert_category_in_conn(conn, input))
        .await?;
    state.sync.trigger_sync_now(state.inner(), &book_id);
    Ok(res)
}

#[tauri::command]
pub async fn delete_category(
    state: State<'_, AppState>,
    book_id: String,
    category_id: String,
) -> AppResult<()> {
    state
        .with_book(&book_id, move |conn| {
            delete_category_in_conn(conn, &category_id)
        })
        .await?;
    state.sync.trigger_sync_now(state.inner(), &book_id);
    Ok(())
}

#[tauri::command]
pub async fn add_transaction(
    state: State<'_, AppState>,
    book_id: String,
    input: AddTransactionInput,
) -> AppResult<TransactionRow> {
    let res = state
        .with_book(&book_id, move |conn| add_transaction_in_conn(conn, input))
        .await?;
    state.sync.trigger_sync_now(state.inner(), &book_id);
    Ok(res)
}

#[tauri::command]
pub async fn update_transaction(
    state: State<'_, AppState>,
    book_id: String,
    input: UpdateTransactionInput,
) -> AppResult<TransactionRow> {
    let res = state
        .with_book(&book_id, move |conn| update_transaction_in_conn(conn, input))
        .await?;
    state.sync.trigger_sync_now(state.inner(), &book_id);
    Ok(res)
}

#[tauri::command]
pub async fn delete_transaction(
    state: State<'_, AppState>,
    book_id: String,
    tx_id: String,
) -> AppResult<()> {
    state
        .with_book(&book_id, move |conn| delete_transaction_in_conn(conn, &tx_id))
        .await?;
    state.sync.trigger_sync_now(state.inner(), &book_id);
    Ok(())
}

#[tauri::command]
pub async fn list_transactions(
    state: State<'_, AppState>,
    book_id: String,
    filter: TransactionFilter,
) -> AppResult<PaginatedTransactions> {
    state
        .with_book(&book_id, move |conn| list_transactions_in_conn(conn, filter))
        .await
}

#[tauri::command]
pub async fn transfer_between_books(
    state: State<'_, AppState>,
    input: TransferBetweenBooksInput,
) -> AppResult<TransferBetweenBooksResult> {
    let from_book_id = validate_book_id(&input.from_book_id)?;
    let to_book_id = validate_book_id(&input.to_book_id)?;
    if from_book_id == to_book_id {
        return Err(AppError::Validation(
            "Source and destination books must be different for cross-book transfer".into(),
        ));
    }
    if input.amount <= 0 {
        return Err(AppError::Validation(
            "Cross-book transfer amount must be positive (> 0)".into(),
        ));
    }

    let link_id = input
        .link_id
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(new_uuid_v7);

    let from_account_id = input.from_account_id.trim().to_string();
    let to_account_id = input.to_account_id.trim().to_string();
    let amount = input.amount;
    let tx_date = input.tx_date.trim().to_string();
    let note = input.note.clone();
    let link_id_step1 = link_id.clone();

    // Step 1: Write EXPENSE ("Prive/Penarikan") in source book (idempotent by link_id)
    let expense_tx = state
        .with_book(&from_book_id, move |conn| {
            let existing: Option<TransactionRow> = conn
                .query_row(
                    "SELECT id, account_id, to_account_id, category_id, amount, tx_type, note, tx_date, created_by_device, link_id, is_deleted, updated_hlc
                     FROM transactions
                     WHERE link_id = ?1 AND tx_type = 'EXPENSE' AND is_deleted = 0",
                    params![link_id_step1],
                    |r| {
                        Ok(TransactionRow {
                            id: r.get(0)?,
                            account_id: r.get(1)?,
                            to_account_id: r.get(2)?,
                            category_id: r.get(3)?,
                            amount: r.get(4)?,
                            tx_type: r.get(5)?,
                            note: r.get(6)?,
                            tx_date: r.get(7)?,
                            created_by_device: r.get(8)?,
                            link_id: r.get(9)?,
                            is_deleted: r.get(10)?,
                            updated_hlc: r.get(11)?,
                        })
                    },
                )
                .optional()?;

            if let Some(found) = existing {
                return Ok(found);
            }

            let cat_id = {
                let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
                let cid = ensure_system_category_in_tx(
                    &tx,
                    SYSTEM_CATEGORY_PRIVE_ID,
                    SYSTEM_CATEGORY_PRIVE_NAME,
                    "EXPENSE",
                )?;
                tx.commit()?;
                cid
            };

            add_transaction_in_conn(
                conn,
                AddTransactionInput {
                    id: None,
                    account_id: from_account_id,
                    to_account_id: None,
                    category_id: Some(cat_id),
                    amount: -amount,
                    tx_type: "EXPENSE".to_string(),
                    note,
                    tx_date,
                    link_id: Some(link_id_step1),
                },
            )
        })
        .await?;

    let link_id_step2 = link_id.clone();
    let tx_date_step2 = input.tx_date.trim().to_string();
    let note_step2 = input.note.clone();

    // Step 2: Write INCOME ("Bagi Hasil/Injeksi Modal") in destination book
    let step2_result = state
        .with_book(&to_book_id, move |conn| {
            let existing: Option<TransactionRow> = conn
                .query_row(
                    "SELECT id, account_id, to_account_id, category_id, amount, tx_type, note, tx_date, created_by_device, link_id, is_deleted, updated_hlc
                     FROM transactions
                     WHERE link_id = ?1 AND tx_type = 'INCOME' AND is_deleted = 0",
                    params![link_id_step2],
                    |r| {
                        Ok(TransactionRow {
                            id: r.get(0)?,
                            account_id: r.get(1)?,
                            to_account_id: r.get(2)?,
                            category_id: r.get(3)?,
                            amount: r.get(4)?,
                            tx_type: r.get(5)?,
                            note: r.get(6)?,
                            tx_date: r.get(7)?,
                            created_by_device: r.get(8)?,
                            link_id: r.get(9)?,
                            is_deleted: r.get(10)?,
                            updated_hlc: r.get(11)?,
                        })
                    },
                )
                .optional()?;

            if let Some(found) = existing {
                return Ok(found);
            }

            let cat_id = {
                let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
                let cid = ensure_system_category_in_tx(
                    &tx,
                    SYSTEM_CATEGORY_MODAL_ID,
                    SYSTEM_CATEGORY_MODAL_NAME,
                    "INCOME",
                )?;
                tx.commit()?;
                cid
            };

            add_transaction_in_conn(
                conn,
                AddTransactionInput {
                    id: None,
                    account_id: to_account_id,
                    to_account_id: None,
                    category_id: Some(cat_id),
                    amount,
                    tx_type: "INCOME".to_string(),
                    note: note_step2,
                    tx_date: tx_date_step2,
                    link_id: Some(link_id_step2),
                },
            )
        })
        .await;

    match step2_result {
        Ok(income_tx) => {
            state.sync.trigger_sync_now(state.inner(), &from_book_id);
            state.sync.trigger_sync_now(state.inner(), &to_book_id);
            Ok(TransferBetweenBooksResult {
                link_id,
                expense_tx,
                income_tx,
            })
        }
        Err(err) => {
            // Compensating soft-delete on source book (Assumption A5)
            let comp_tx_id = expense_tx.id.clone();
            let _ = state
                .with_book(&from_book_id, move |conn| {
                    delete_transaction_in_conn(conn, &comp_tx_id)
                })
                .await;
            Err(err)
        }
    }
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

#[tauri::command]
pub async fn get_cash_flow_summary(
    state: State<'_, AppState>,
    book_id: String,
    months_limit: Option<usize>,
) -> AppResult<Vec<CashFlowMonthItem>> {
    let limit = months_limit.unwrap_or(6);
    state
        .with_book(&book_id, move |conn| get_cash_flow_summary_in_conn(conn, limit))
        .await
}

#[tauri::command]
pub async fn list_budgets(
    state: State<'_, AppState>,
    book_id: String,
) -> AppResult<Vec<BudgetRow>> {
    state
        .with_book(&book_id, |conn| list_budgets_in_conn(conn))
        .await
}

#[tauri::command]
pub async fn upsert_budget(
    state: State<'_, AppState>,
    book_id: String,
    input: UpsertBudgetInput,
) -> AppResult<BudgetRow> {
    let res = state
        .with_book(&book_id, move |conn| upsert_budget_in_conn(conn, input))
        .await?;
    state.sync.trigger_sync_now(state.inner(), &book_id);
    Ok(res)
}

#[tauri::command]
pub async fn delete_budget(
    state: State<'_, AppState>,
    book_id: String,
    budget_id: String,
) -> AppResult<()> {
    state
        .with_book(&book_id, move |conn| delete_budget_in_conn(conn, &budget_id))
        .await?;
    state.sync.trigger_sync_now(state.inner(), &book_id);
    Ok(())
}

#[tauri::command]
pub async fn get_budget_progress(
    state: State<'_, AppState>,
    book_id: String,
    month: String,
) -> AppResult<Vec<BudgetProgressItem>> {
    state
        .with_book(&book_id, move |conn| get_budget_progress_in_conn(conn, &month))
        .await
}

#[tauri::command]
pub async fn get_monthly_report(
    state: State<'_, AppState>,
    book_id: String,
    month: String,
) -> AppResult<MonthlyReportResponse> {
    state
        .with_book(&book_id, move |conn| get_monthly_report_in_conn(conn, &month))
        .await
}

#[tauri::command]
pub async fn get_sync_status(
    state: State<'_, AppState>,
    book_id: String,
) -> AppResult<SyncStatusPayload> {
    let valid_id = validate_book_id(&book_id)?;
    let peers = state
        .with_book(&valid_id, |conn| {
            let count: i64 = conn.query_row(
                "SELECT COUNT(*) FROM sync_peers WHERE last_seen_at IS NOT NULL",
                [],
                |r| r.get(0),
            )?;
            Ok(count as usize)
        })
        .await?;

    let status = state.sync.get_status(&valid_id, peers).await;
    Ok(SyncStatusPayload {
        book_id: status.book_id,
        state: status.state,
        peers: status.peers,
        last_synced_at: status.last_synced_at,
    })
}

#[tauri::command]
pub async fn create_invite(
    state: State<'_, AppState>,
    book_id: String,
    ttl_secs: Option<i64>,
) -> AppResult<crate::sync::InviteResponse> {
    let valid_id = validate_book_id(&book_id)?;
    let book_name: String = {
        let valid_id_clone = valid_id.clone();
        state
            .with_registry(move |reg| {
                let name: Option<String> = reg
                    .query_row(
                        "SELECT name FROM books WHERE id = ?1",
                        params![valid_id_clone],
                        |r| r.get(0),
                    )
                    .optional()?;
                name.ok_or_else(|| AppError::BookNotFound(valid_id_clone))
            })
            .await?
    };

    let mut book_key = state.sync.keystore.get_or_create_book_key(&valid_id)?;
    let transport = state.sync.ensure_transport(state.inner()).await?;
    let node_addr = transport.local_node_addr()?;
    let ttl = ttl_secs.unwrap_or(crate::sync::DEFAULT_INVITE_TTL_SECS);

    let invite_res =
        crate::sync::build_invite_payload(&valid_id, &book_name, &book_key, node_addr, ttl);
    book_key.zeroize();
    let _ = state.sync.start_book_sync(state.inner(), &valid_id).await;
    invite_res
}

#[tauri::command]
pub async fn join_book_from_invite(
    state: State<'_, AppState>,
    mut invite_qr: String,
    kind: Option<String>,
) -> AppResult<BookMetadata> {
    let parse_res = crate::sync::parse_and_validate_invite(&invite_qr);
    invite_qr.zeroize();
    let (payload, mut book_key) = parse_res?;

    let valid_id = validate_book_id(&payload.book_id)?;
    let book_name = payload.book_name.trim().to_string();
    let book_kind = kind
        .map(|k| k.trim().to_uppercase())
        .filter(|k| !k.is_empty())
        .unwrap_or_else(|| "PERSONAL".to_string());
    let now = now_iso8601();

    // Save book_key to OS secure KeyStore (never in SQLite)
    let set_key_res = state.sync.keystore.set_book_key(&valid_id, &book_key);
    book_key.zeroize();
    set_key_res?;

    let meta = BookMetadata {
        id: valid_id.clone(),
        name: book_name.clone(),
        kind: book_kind.clone(),
        created_at: now.clone(),
        last_opened_at: now.clone(),
        file_exists: true,
    };

    let state_clone = state.inner().clone();
    let meta_clone = meta.clone();

    // Create empty book database with the invited book_id (seed_defaults = false so remote oplog populates cleanly)
    tokio::task::spawn_blocking(move || -> AppResult<()> {
        {
            let reg_guard = state_clone
                .registry
                .lock()
                .map_err(|_| AppError::Internal("Registry mutex poisoned".into()))?;
            reg_guard.execute(
                "INSERT INTO books (id, name, kind, created_at, last_opened_at)
                 VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(id) DO UPDATE SET
                    name = excluded.name,
                    last_opened_at = excluded.last_opened_at",
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
        init_book_db(&mut conn, &meta_clone.id, &meta_clone.name, false)?;

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

    // Await initial P2P sync with inviter (up to 10s timeout) so data is populated before navigating to dashboard
    let sync_engine = std::sync::Arc::clone(&state.sync);
    let state_for_sync = state.inner().clone();
    let bid_for_sync = valid_id.clone();
    let inviter_addr = payload.inviter_node_addr;
    let _ = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        sync_engine.sync_with_inviter_ticket(&state_for_sync, &bid_for_sync, &inviter_addr),
    )
    .await;

    Ok(meta)
}

#[tauri::command]
pub async fn set_app_foreground(
    state: State<'_, AppState>,
    is_foreground: bool,
) -> AppResult<()> {
    state.sync.set_foreground(state.inner(), is_foreground).await;
    Ok(())
}

#[tauri::command]
pub async fn list_peers(
    state: State<'_, AppState>,
    book_id: String,
) -> AppResult<Vec<PeerInfo>> {
    state
        .with_book(&book_id, |conn| {
            let mut stmt = conn.prepare(
                "SELECT node_id, device_id, last_seen_at FROM sync_peers ORDER BY last_seen_at DESC",
            )?;
            let rows = stmt.query_map([], |r| {
                Ok(PeerInfo {
                    node_id: r.get(0)?,
                    device_id: r.get(1)?,
                    last_seen_at: r.get(2)?,
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::crdt::{merge_remote_oplog, CrdtEnvelope, CrdtOp};
    use crate::db::open_in_memory_book;

    #[test]
    fn test_add_transaction_atomicity_on_failure() {
        let mut conn =
            open_in_memory_book("00000000-0000-7000-8000-000000000100", "AtomicBook").unwrap();

        // Trigger on crdt_oplog that aborts when note == 'SIMULATE_OPLOG_FAILURE'
        conn.execute_batch(
            "CREATE TRIGGER abort_on_simulated_failure
             BEFORE INSERT ON crdt_oplog
             WHEN NEW.payload_json LIKE '%SIMULATE_OPLOG_FAILURE%'
             BEGIN
                 SELECT RAISE(ABORT, 'simulated oplog failure');
             END;",
        )
        .unwrap();

        let res = add_transaction_in_conn(
            &mut conn,
            AddTransactionInput {
                id: Some("018f0000-0000-7000-8000-000000000999".into()),
                account_id: "00000000-0000-7000-8000-000000000001".into(),
                to_account_id: None,
                category_id: Some("cat-1".into()),
                amount: -50_000,
                tx_type: "EXPENSE".into(),
                note: Some("SIMULATE_OPLOG_FAILURE".into()),
                tx_date: "2026-04-01".into(),
                link_id: None,
            },
        );
        assert!(res.is_err());

        let tx_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM transactions", [], |r| r.get(0))
            .unwrap();
        let op_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM crdt_oplog WHERE table_name = 'transactions'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(tx_count, 0, "No orphan transaction row may remain");
        assert_eq!(op_count, 0, "No oplog entry may remain");
    }

    #[test]
    fn test_get_account_balances_merged_transfers_deleted_and_large_values() {
        let mut conn =
            open_in_memory_book("00000000-0000-7000-8000-000000000100", "BalanceBook").unwrap();

        let acc_root = upsert_account_in_conn(
            &mut conn,
            UpsertAccountInput {
                id: Some("acc-root".into()),
                name: "BCA Utama".into(),
                account_type: "BANK".into(),
                initial_balance: 100_000_000_000_000, // 100 Trillion
            },
        )
        .unwrap();

        let acc_child = upsert_account_in_conn(
            &mut conn,
            UpsertAccountInput {
                id: Some("acc-child".into()),
                name: "BCA Lama".into(),
                account_type: "BANK".into(),
                initial_balance: 50_000_000_000_000, // 50 Trillion
            },
        )
        .unwrap();

        let acc_wallet = upsert_account_in_conn(
            &mut conn,
            UpsertAccountInput {
                id: Some("acc-wallet".into()),
                name: "GoPay".into(),
                account_type: "EWALLET".into(),
                initial_balance: 1_000_000,
            },
        )
        .unwrap();

        // Merge acc_child into acc_root
        merge_accounts_in_conn(&mut conn, &acc_child.id, &acc_root.id).unwrap();

        // Income on merged child account (should credit acc-root)
        add_transaction_in_conn(
            &mut conn,
            AddTransactionInput {
                id: None,
                account_id: acc_child.id.clone(),
                to_account_id: None,
                category_id: Some("cat-inc".into()),
                amount: 10_000_000_000_000, // +10 Trillion
                tx_type: "INCOME".into(),
                note: None,
                tx_date: "2026-05-01".into(),
                link_id: None,
            },
        )
        .unwrap();

        // Expense on acc_root
        add_transaction_in_conn(
            &mut conn,
            AddTransactionInput {
                id: None,
                account_id: acc_root.id.clone(),
                to_account_id: None,
                category_id: Some("cat-exp".into()),
                amount: -5_000_000,
                tx_type: "EXPENSE".into(),
                note: None,
                tx_date: "2026-05-02".into(),
                link_id: None,
            },
        )
        .unwrap();

        // Transfer from acc_child (merged into acc_root) to acc_wallet
        add_transaction_in_conn(
            &mut conn,
            AddTransactionInput {
                id: None,
                account_id: acc_child.id.clone(),
                to_account_id: Some(acc_wallet.id.clone()),
                category_id: None,
                amount: 2_000_000,
                tx_type: "TRANSFER".into(),
                note: None,
                tx_date: "2026-05-03".into(),
                link_id: None,
            },
        )
        .unwrap();

        // Deleted transaction (must be ignored)
        let del_tx = add_transaction_in_conn(
            &mut conn,
            AddTransactionInput {
                id: None,
                account_id: acc_wallet.id.clone(),
                to_account_id: None,
                category_id: Some("cat-exp".into()),
                amount: -999_999,
                tx_type: "EXPENSE".into(),
                note: None,
                tx_date: "2026-05-04".into(),
                link_id: None,
            },
        )
        .unwrap();
        delete_transaction_in_conn(&mut conn, &del_tx.id).unwrap();

        let balances = get_account_balances_in_conn(&conn).unwrap();
        assert_eq!(balances.len(), 2);

        let bca = balances
            .iter()
            .find(|b| b.account_id == "acc-root")
            .unwrap();
        assert_eq!(bca.initial_balance, 150_000_000_000_000);
        // 150T + 10T - 5M - 2M = 159_999_993_000_000
        assert_eq!(bca.current_balance, 159_999_993_000_000);
        assert_eq!(bca.merged_member_ids, vec!["acc-child".to_string()]);

        let gopay = balances
            .iter()
            .find(|b| b.account_id == "acc-wallet")
            .unwrap();
        assert_eq!(gopay.current_balance, 3_000_000);
    }

    #[test]
    fn test_get_budget_progress_comprehensive() {
        let mut conn =
            open_in_memory_book("00000000-0000-7000-8000-000000000100", "BudgetBook").unwrap();

        let acc = upsert_account_in_conn(
            &mut conn,
            UpsertAccountInput {
                id: Some("acc-1".into()),
                name: "Cash".into(),
                account_type: "CASH".into(),
                initial_balance: 100_000_000,
            },
        )
        .unwrap();
        let acc2 = upsert_account_in_conn(
            &mut conn,
            UpsertAccountInput {
                id: Some("acc-2".into()),
                name: "Bank".into(),
                account_type: "BANK".into(),
                initial_balance: 100_000_000,
            },
        )
        .unwrap();

        // Two duplicate categories ("Makan" & "makan!") that auto-merge into cat_makan_1
        let cat_makan_1 = upsert_category_in_conn(
            &mut conn,
            UpsertCategoryInput {
                id: Some("018f0000-0000-7000-8000-000000000001".into()),
                name: "Makan".into(),
                kind: "EXPENSE".into(),
            },
        )
        .unwrap();
        let cat_makan_2 = upsert_category_in_conn(
            &mut conn,
            UpsertCategoryInput {
                id: Some("018f0000-0000-7000-8000-000000000002".into()),
                name: "makan!".into(),
                kind: "EXPENSE".into(),
            },
        )
        .unwrap();
        assert_eq!(cat_makan_2.canonical_id, cat_makan_1.id);

        // Categories for threshold tests: 79% (OK), 80% (WARNING), 100% (WARNING), 101% (OVER), and huge limit
        let cat_79 = upsert_category_in_conn(
            &mut conn,
            UpsertCategoryInput {
                id: Some("cat-79".into()),
                name: "Cat79".into(),
                kind: "EXPENSE".into(),
            },
        )
        .unwrap();
        let cat_80 = upsert_category_in_conn(
            &mut conn,
            UpsertCategoryInput {
                id: Some("cat-80".into()),
                name: "Cat80".into(),
                kind: "EXPENSE".into(),
            },
        )
        .unwrap();
        let cat_100 = upsert_category_in_conn(
            &mut conn,
            UpsertCategoryInput {
                id: Some("cat-100".into()),
                name: "Cat100".into(),
                kind: "EXPENSE".into(),
            },
        )
        .unwrap();
        let cat_101 = upsert_category_in_conn(
            &mut conn,
            UpsertCategoryInput {
                id: Some("cat-101".into()),
                name: "Cat101".into(),
                kind: "EXPENSE".into(),
            },
        )
        .unwrap();
        let cat_huge = upsert_category_in_conn(
            &mut conn,
            UpsertCategoryInput {
                id: Some("cat-huge".into()),
                name: "CatHuge".into(),
                kind: "EXPENSE".into(),
            },
        )
        .unwrap();

        // System Prive category (must be excluded from total budget!)
        let cat_prive = upsert_category_in_conn(
            &mut conn,
            UpsertCategoryInput {
                id: Some(SYSTEM_CATEGORY_PRIVE_ID.into()),
                name: SYSTEM_CATEGORY_PRIVE_NAME.into(),
                kind: "EXPENSE".into(),
            },
        )
        .unwrap();

        // Create budgets
        upsert_budget_in_conn(
            &mut conn,
            UpsertBudgetInput {
                category_id: Some(cat_makan_1.id.clone()),
                period: Some("MONTHLY".into()),
                amount_limit: 1_000_000,
                alert_threshold_pct: Some(80),
            },
        )
        .unwrap();
        upsert_budget_in_conn(
            &mut conn,
            UpsertBudgetInput {
                category_id: Some(cat_79.id.clone()),
                period: Some("MONTHLY".into()),
                amount_limit: 1_000,
                alert_threshold_pct: Some(80),
            },
        )
        .unwrap();
        upsert_budget_in_conn(
            &mut conn,
            UpsertBudgetInput {
                category_id: Some(cat_80.id.clone()),
                period: Some("MONTHLY".into()),
                amount_limit: 1_000,
                alert_threshold_pct: Some(80),
            },
        )
        .unwrap();
        upsert_budget_in_conn(
            &mut conn,
            UpsertBudgetInput {
                category_id: Some(cat_100.id.clone()),
                period: Some("MONTHLY".into()),
                amount_limit: 1_000,
                alert_threshold_pct: Some(80),
            },
        )
        .unwrap();
        upsert_budget_in_conn(
            &mut conn,
            UpsertBudgetInput {
                category_id: Some(cat_101.id.clone()),
                period: Some("MONTHLY".into()),
                amount_limit: 1_000,
                alert_threshold_pct: Some(80),
            },
        )
        .unwrap();
        upsert_budget_in_conn(
            &mut conn,
            UpsertBudgetInput {
                category_id: Some(cat_huge.id.clone()),
                period: Some("MONTHLY".into()),
                amount_limit: 500_000_000_000_000, // 500 Trillion
                alert_threshold_pct: Some(80),
            },
        )
        .unwrap();
        // Total budget (category_id = None)
        upsert_budget_in_conn(
            &mut conn,
            UpsertBudgetInput {
                category_id: None,
                period: Some("MONTHLY".into()),
                amount_limit: 10_000_000,
                alert_threshold_pct: Some(80),
            },
        )
        .unwrap();

        // Transactions in Jan 2026 vs Feb 2026
        // 1. Jan 31 on cat_makan_1 (300k) and cat_makan_2 (200k) -> both resolve to cat_makan_1 = 500k
        add_transaction_in_conn(
            &mut conn,
            AddTransactionInput {
                id: None,
                account_id: acc.id.clone(),
                to_account_id: None,
                category_id: Some(cat_makan_1.id.clone()),
                amount: -300_000,
                tx_type: "EXPENSE".into(),
                note: None,
                tx_date: "2026-01-31".into(),
                link_id: None,
            },
        )
        .unwrap();
        add_transaction_in_conn(
            &mut conn,
            AddTransactionInput {
                id: None,
                account_id: acc.id.clone(),
                to_account_id: None,
                category_id: Some(cat_makan_2.id.clone()),
                amount: -200_000,
                tx_type: "EXPENSE".into(),
                note: None,
                tx_date: "2026-01-31".into(),
                link_id: None,
            },
        )
        .unwrap();
        // Feb 01 transaction on cat_makan_1 (must NOT count in Jan 2026)
        add_transaction_in_conn(
            &mut conn,
            AddTransactionInput {
                id: None,
                account_id: acc.id.clone(),
                to_account_id: None,
                category_id: Some(cat_makan_1.id.clone()),
                amount: -400_000,
                tx_type: "EXPENSE".into(),
                note: None,
                tx_date: "2026-02-01".into(),
                link_id: None,
            },
        )
        .unwrap();

        // TRANSFER and INCOME in Jan 2026 (must NOT count in budgets)
        add_transaction_in_conn(
            &mut conn,
            AddTransactionInput {
                id: None,
                account_id: acc.id.clone(),
                to_account_id: Some(acc2.id.clone()),
                category_id: None,
                amount: 900_000,
                tx_type: "TRANSFER".into(),
                note: None,
                tx_date: "2026-01-15".into(),
                link_id: None,
            },
        )
        .unwrap();
        let cat_inc = upsert_category_in_conn(
            &mut conn,
            UpsertCategoryInput {
                id: Some("cat-inc".into()),
                name: "Gaji".into(),
                kind: "INCOME".into(),
            },
        )
        .unwrap();
        add_transaction_in_conn(
            &mut conn,
            AddTransactionInput {
                id: None,
                account_id: acc.id.clone(),
                to_account_id: None,
                category_id: Some(cat_inc.id),
                amount: 5_000_000,
                tx_type: "INCOME".into(),
                note: None,
                tx_date: "2026-01-15".into(),
                link_id: None,
            },
        )
        .unwrap();

        // System Prive expense in Jan 2026 (must NOT count in total budget!)
        add_transaction_in_conn(
            &mut conn,
            AddTransactionInput {
                id: None,
                account_id: acc.id.clone(),
                to_account_id: None,
                category_id: Some(cat_prive.id),
                amount: -2_000_000,
                tx_type: "EXPENSE".into(),
                note: None,
                tx_date: "2026-01-20".into(),
                link_id: None,
            },
        )
        .unwrap();

        // Deleted expense in Jan 2026 (must NOT count)
        let del = add_transaction_in_conn(
            &mut conn,
            AddTransactionInput {
                id: None,
                account_id: acc.id.clone(),
                to_account_id: None,
                category_id: Some(cat_makan_1.id.clone()),
                amount: -100_000,
                tx_type: "EXPENSE".into(),
                note: None,
                tx_date: "2026-01-10".into(),
                link_id: None,
            },
        )
        .unwrap();
        delete_transaction_in_conn(&mut conn, &del.id).unwrap();

        // Exact thresholds: 790/1000 (79%), 800/1000 (80%), 1000/1000 (100%), 1010/1000 (101%)
        for (cat_id, amt) in [
            (&cat_79.id, -790),
            (&cat_80.id, -800),
            (&cat_100.id, -1000),
            (&cat_101.id, -1010),
            (&cat_huge.id, -250_000_000_000_000),
        ] {
            add_transaction_in_conn(
                &mut conn,
                AddTransactionInput {
                    id: None,
                    account_id: acc.id.clone(),
                    to_account_id: None,
                    category_id: Some(cat_id.clone()),
                    amount: amt,
                    tx_type: "EXPENSE".into(),
                    note: None,
                    tx_date: "2026-01-12".into(),
                    link_id: None,
                },
            )
            .unwrap();
        }

        let progress = get_budget_progress_in_conn(&conn, "2026-01").unwrap();

        // Verify sorted descending by pct
        for pair in progress.windows(2) {
            assert!(pair[0].pct >= pair[1].pct);
        }

        let p_101 = progress
            .iter()
            .find(|p| p.category_id.as_deref() == Some("cat-101"))
            .unwrap();
        assert_eq!(p_101.pct, 101);
        assert_eq!(p_101.status, "OVER");
        assert_eq!(p_101.remaining, -10);

        let p_100 = progress
            .iter()
            .find(|p| p.category_id.as_deref() == Some("cat-100"))
            .unwrap();
        assert_eq!(p_100.pct, 100);
        assert_eq!(p_100.status, "WARNING");
        assert_eq!(p_100.remaining, 0);

        let p_80 = progress
            .iter()
            .find(|p| p.category_id.as_deref() == Some("cat-80"))
            .unwrap();
        assert_eq!(p_80.pct, 80);
        assert_eq!(p_80.status, "WARNING");

        let p_79 = progress
            .iter()
            .find(|p| p.category_id.as_deref() == Some("cat-79"))
            .unwrap();
        assert_eq!(p_79.pct, 79);
        assert_eq!(p_79.status, "OK");

        let p_makan = progress
            .iter()
            .find(|p| p.category_id.as_deref() == Some(cat_makan_1.id.as_str()))
            .unwrap();
        assert_eq!(p_makan.spent, 500_000);
        assert_eq!(p_makan.pct, 50);
        assert_eq!(p_makan.status, "OK");

        let p_huge = progress
            .iter()
            .find(|p| p.category_id.as_deref() == Some("cat-huge"))
            .unwrap();
        assert_eq!(p_huge.pct, 50);
        assert_eq!(p_huge.status, "OK");
    }

    #[test]
    fn test_budget_crdt_lww_and_merged_category_dedupe() {
        let mut conn =
            open_in_memory_book("00000000-0000-7000-8000-000000000100", "BudgetCrdt").unwrap();

        // 1. Two devices create budget for the exact same category + period concurrently -> same UUIDv5, LWW wins
        let budget_id = deterministic_budget_id(None, "MONTHLY");
        let b_dev1 = BudgetRow {
            id: budget_id.clone(),
            category_id: None,
            period: "MONTHLY".into(),
            amount_limit: 3_000_000,
            alert_threshold_pct: 80,
            is_deleted: 0,
            updated_hlc: "0000001000000-00001-aaaa1111".into(),
        };
        let b_dev2 = BudgetRow {
            id: budget_id.clone(),
            category_id: None,
            period: "MONTHLY".into(),
            amount_limit: 5_000_000,
            alert_threshold_pct: 85,
            is_deleted: 0,
            updated_hlc: "0000001000005-00001-bbbb2222".into(),
        };

        let op1 = CrdtOp {
            hlc_timestamp: b_dev1.updated_hlc.clone(),
            table_name: "budgets".into(),
            row_id: budget_id.clone(),
            payload_json: serde_json::to_string(&CrdtEnvelope {
                op: "upsert".into(),
                row: b_dev1,
            })
            .unwrap(),
            device_id: "aaaa1111".into(),
        };
        let op2 = CrdtOp {
            hlc_timestamp: b_dev2.updated_hlc.clone(),
            table_name: "budgets".into(),
            row_id: budget_id.clone(),
            payload_json: serde_json::to_string(&CrdtEnvelope {
                op: "upsert".into(),
                row: b_dev2,
            })
            .unwrap(),
            device_id: "bbbb2222".into(),
        };

        merge_remote_oplog(&mut conn, &[op2, op1], 2_000_000).unwrap();

        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM budgets WHERE id = ?1", params![budget_id], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(count, 1);

        let budgets = list_budgets_in_conn(&conn).unwrap();
        assert_eq!(budgets.len(), 1);
        assert_eq!(budgets[0].amount_limit, 5_000_000);
        assert_eq!(budgets[0].alert_threshold_pct, 85);

        // 2. Two categories ("Transport" and "transport") created on different devices, each with its own budget
        let c1 = upsert_category_in_conn(
            &mut conn,
            UpsertCategoryInput {
                id: Some("cat-trans-1".into()),
                name: "Transport".into(),
                kind: "EXPENSE".into(),
            },
        )
        .unwrap();
        let c2 = upsert_category_in_conn(
            &mut conn,
            UpsertCategoryInput {
                id: Some("cat-trans-2".into()),
                name: "transport!".into(),
                kind: "EXPENSE".into(),
            },
        )
        .unwrap();

        upsert_budget_in_conn(
            &mut conn,
            UpsertBudgetInput {
                category_id: Some(c1.id.clone()),
                period: Some("MONTHLY".into()),
                amount_limit: 400_000,
                alert_threshold_pct: Some(80),
            },
        )
        .unwrap();
        // Second budget created later for c2 (which auto-merged into c1) -> higher updated_hlc
        upsert_budget_in_conn(
            &mut conn,
            UpsertBudgetInput {
                category_id: Some(c2.id.clone()),
                period: Some("MONTHLY".into()),
                amount_limit: 750_000,
                alert_threshold_pct: Some(90),
            },
        )
        .unwrap();

        let active_budgets = list_budgets_in_conn(&conn).unwrap();
        // Should only return 2 budgets total: 1 for ALL, and 1 resolved for c1 (with 750_000 from higher HLC)
        assert_eq!(active_budgets.len(), 2);
        let trans_budget = active_budgets
            .iter()
            .find(|b| b.category_id.as_deref() == Some("cat-trans-1"))
            .unwrap();
        assert_eq!(trans_budget.amount_limit, 750_000);
        assert_eq!(trans_budget.alert_threshold_pct, 90);
    }

    #[test]
    fn test_get_monthly_report_comprehensive() {
        let mut conn =
            open_in_memory_book("00000000-0000-7000-8000-000000000105", "MonthlyReportBook")
                .unwrap();

        let acc_bca = upsert_account_in_conn(
            &mut conn,
            UpsertAccountInput {
                id: Some("acc-bca".into()),
                name: "BCA Utama".into(),
                account_type: "BANK".into(),
                initial_balance: 5_000_000,
            },
        )
        .unwrap();

        let acc_cash = upsert_account_in_conn(
            &mut conn,
            UpsertAccountInput {
                id: Some("acc-cash".into()),
                name: "Kas Tunai".into(),
                account_type: "CASH".into(),
                initial_balance: 500_000,
            },
        )
        .unwrap();

        let cat_gaji = upsert_category_in_conn(
            &mut conn,
            UpsertCategoryInput {
                id: Some("cat-gaji".into()),
                name: "Gaji Bulanan".into(),
                kind: "INCOME".into(),
            },
        )
        .unwrap();

        let cat_makan = upsert_category_in_conn(
            &mut conn,
            UpsertCategoryInput {
                id: Some("cat-makan".into()),
                name: "Makan & Minum".into(),
                kind: "EXPENSE".into(),
            },
        )
        .unwrap();

        // Previous month (2026-09) expense: 400_000
        add_transaction_in_conn(
            &mut conn,
            AddTransactionInput {
                id: None,
                account_id: acc_bca.id.clone(),
                to_account_id: None,
                category_id: Some(cat_makan.id.clone()),
                amount: -400_000,
                tx_type: "EXPENSE".into(),
                note: Some("Makan Sept".into()),
                tx_date: "2026-09-15".into(),
                link_id: None,
            },
        )
        .unwrap();

        // Current month (2026-10) income: 10_000_000 on 2026-10-01
        add_transaction_in_conn(
            &mut conn,
            AddTransactionInput {
                id: None,
                account_id: acc_bca.id.clone(),
                to_account_id: None,
                category_id: Some(cat_gaji.id.clone()),
                amount: 10_000_000,
                tx_type: "INCOME".into(),
                note: Some("Gaji Okt".into()),
                tx_date: "2026-10-01".into(),
                link_id: None,
            },
        )
        .unwrap();

        // Current month (2026-10) expense: 600_000 on 2026-10-05 (+50% vs Sept)
        add_transaction_in_conn(
            &mut conn,
            AddTransactionInput {
                id: None,
                account_id: acc_bca.id.clone(),
                to_account_id: None,
                category_id: Some(cat_makan.id.clone()),
                amount: -600_000,
                tx_type: "EXPENSE".into(),
                note: Some("Restoran Keluarga".into()),
                tx_date: "2026-10-05".into(),
                link_id: None,
            },
        )
        .unwrap();

        // Internal transfer BCA -> Cash: 200_000 on 2026-10-10
        add_transaction_in_conn(
            &mut conn,
            AddTransactionInput {
                id: None,
                account_id: acc_bca.id.clone(),
                to_account_id: Some(acc_cash.id.clone()),
                category_id: None,
                amount: 200_000,
                tx_type: "TRANSFER".into(),
                note: Some("Tarik Tunai ATM".into()),
                tx_date: "2026-10-10".into(),
                link_id: None,
            },
        )
        .unwrap();

        let report = get_monthly_report_in_conn(&conn, "2026-10").unwrap();
        assert_eq!(report.month, "2026-10");
        assert_eq!(report.prev_month, "2026-09");
        assert_eq!(report.days_in_month, 31);
        assert_eq!(report.operational_income, 10_000_000);
        assert_eq!(report.operational_expense, 600_000);
        assert_eq!(report.operational_net, 9_400_000);
        assert_eq!(report.prev_operational_expense, 400_000);
        assert_eq!(report.savings_rate_bps, 9400); // 94.00%

        // Check MoM category delta
        let makan_item = report
            .category_breakdown
            .iter()
            .find(|c| c.category_id == cat_makan.id)
            .unwrap();
        assert_eq!(makan_item.current_amount, 600_000);
        assert_eq!(makan_item.prev_amount, 400_000);
        assert_eq!(makan_item.delta_amount, 200_000);
        assert_eq!(makan_item.delta_pct, Some(50));

        // Check Account Reconciliation for BCA Utama:
        // Opening (before Oct 1) = 5_000_000 - 400_000 = 4_600_000
        // Oct Inflow = 10_000_000, Oct Outflow = 600_000 (expense) + 200_000 (transfer out) = 800_000
        // Closing = 4_600_000 + 9_200_000 = 13_800_000
        let bca_recon = report
            .account_reconciliation
            .iter()
            .find(|a| a.account_id == acc_bca.id)
            .unwrap();
        assert_eq!(bca_recon.opening_balance, 4_600_000);
        assert_eq!(bca_recon.month_inflow, 10_000_000);
        assert_eq!(bca_recon.month_outflow, 800_000);
        assert_eq!(bca_recon.closing_balance, 13_800_000);
    }
}

