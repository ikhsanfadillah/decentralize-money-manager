use crate::db::{deterministic_budget_id, normalize_category_name};
use crate::error::{AppError, AppResult};
use crate::hlc::{load_clock_from_tx, save_clock_to_tx, HlcTimestamp};
use rusqlite::{params, Connection, OptionalExtension, Transaction, TransactionBehavior};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeSet, HashMap};
use std::str::FromStr;

pub const MAX_REMOTE_BATCH_OPS: usize = 500;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CrdtOp {
    pub hlc_timestamp: String,
    pub table_name: String,
    pub row_id: String,
    pub payload_json: String,
    pub device_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CrdtEnvelope<T> {
    pub op: String,
    pub row: T,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AccountRow {
    pub id: String,
    pub name: String,
    pub account_type: String,
    pub initial_balance: i64,
    pub merged_into_id: Option<String>,
    pub is_deleted: i64,
    pub updated_hlc: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CategoryRow {
    pub id: String,
    pub name: String,
    pub normalized_name: String,
    pub kind: String,
    pub merged_into_id: Option<String>,
    pub is_deleted: i64,
    pub updated_hlc: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TransactionRow {
    pub id: String,
    pub account_id: String,
    pub to_account_id: Option<String>,
    pub category_id: Option<String>,
    pub amount: i64,
    pub tx_type: String,
    pub note: Option<String>,
    pub tx_date: String,
    pub created_by_device: String,
    pub link_id: Option<String>,
    pub is_deleted: i64,
    pub updated_hlc: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct BudgetRow {
    pub id: String,
    pub category_id: Option<String>,
    pub period: String,
    pub amount_limit: i64,
    pub alert_threshold_pct: i64,
    pub is_deleted: i64,
    pub updated_hlc: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MergeReport {
    pub applied_count: usize,
    pub tables: Vec<String>,
}

pub fn validate_iso_date(date_str: &str) -> AppResult<()> {
    if date_str.len() != 10 {
        return Err(AppError::Validation(format!(
            "Invalid date format '{}', expected YYYY-MM-DD",
            date_str
        )));
    }
    chrono::NaiveDate::parse_from_str(date_str, "%Y-%m-%d").map_err(|_| {
        AppError::Validation(format!(
            "Invalid calendar date '{}', expected valid YYYY-MM-DD",
            date_str
        ))
    })?;
    Ok(())
}

pub fn validate_account_row(row: &AccountRow) -> AppResult<()> {
    if row.id.trim().is_empty() {
        return Err(AppError::Validation("Account id cannot be empty".into()));
    }
    if row.name.trim().is_empty() {
        return Err(AppError::Validation("Account name cannot be empty".into()));
    }
    if !matches!(row.account_type.as_str(), "BANK" | "CASH" | "EWALLET") {
        return Err(AppError::Validation(format!(
            "Invalid account_type '{}'",
            row.account_type
        )));
    }
    if row.is_deleted != 0 && row.is_deleted != 1 {
        return Err(AppError::Validation("is_deleted must be 0 or 1".into()));
    }
    if let Some(ref target) = row.merged_into_id {
        if target == &row.id {
            return Err(AppError::Validation(
                "Account cannot be merged into itself".into(),
            ));
        }
    }
    Ok(())
}

pub fn validate_category_row(row: &CategoryRow) -> AppResult<()> {
    if row.id.trim().is_empty() {
        return Err(AppError::Validation("Category id cannot be empty".into()));
    }
    if row.name.trim().is_empty() {
        return Err(AppError::Validation("Category name cannot be empty".into()));
    }
    if !matches!(row.kind.as_str(), "EXPENSE" | "INCOME") {
        return Err(AppError::Validation(format!(
            "Invalid category kind '{}'",
            row.kind
        )));
    }
    if row.is_deleted != 0 && row.is_deleted != 1 {
        return Err(AppError::Validation("is_deleted must be 0 or 1".into()));
    }
    Ok(())
}

pub fn validate_transaction_row(row: &TransactionRow) -> AppResult<()> {
    if row.id.trim().is_empty() {
        return Err(AppError::Validation(
            "Transaction id cannot be empty".into(),
        ));
    }
    if row.account_id.trim().is_empty() {
        return Err(AppError::Validation(
            "Transaction account_id cannot be empty".into(),
        ));
    }
    validate_iso_date(&row.tx_date)?;
    if row.is_deleted != 0 && row.is_deleted != 1 {
        return Err(AppError::Validation("is_deleted must be 0 or 1".into()));
    }

    match row.tx_type.as_str() {
        "EXPENSE" => {
            if row.amount >= 0 {
                return Err(AppError::Validation(
                    "EXPENSE transaction amount must be negative (< 0)".into(),
                ));
            }
            if row.to_account_id.is_some() {
                return Err(AppError::Validation(
                    "EXPENSE transaction must not have to_account_id".into(),
                ));
            }
            if row
                .category_id
                .as_deref()
                .map(|s| s.trim().is_empty())
                .unwrap_or(true)
            {
                return Err(AppError::Validation(
                    "EXPENSE transaction requires category_id".into(),
                ));
            }
        }
        "INCOME" => {
            if row.amount <= 0 {
                return Err(AppError::Validation(
                    "INCOME transaction amount must be positive (> 0)".into(),
                ));
            }
            if row.to_account_id.is_some() {
                return Err(AppError::Validation(
                    "INCOME transaction must not have to_account_id".into(),
                ));
            }
            if row
                .category_id
                .as_deref()
                .map(|s| s.trim().is_empty())
                .unwrap_or(true)
            {
                return Err(AppError::Validation(
                    "INCOME transaction requires category_id".into(),
                ));
            }
        }
        "TRANSFER" => {
            if row.amount <= 0 {
                return Err(AppError::Validation(
                    "TRANSFER transaction amount must be positive (> 0)".into(),
                ));
            }
            let to_acc = row.to_account_id.as_deref().ok_or_else(|| {
                AppError::Validation("TRANSFER transaction requires to_account_id".into())
            })?;
            if to_acc.trim().is_empty() {
                return Err(AppError::Validation(
                    "TRANSFER to_account_id cannot be empty".into(),
                ));
            }
            if to_acc == row.account_id {
                return Err(AppError::Validation(
                    "TRANSFER account_id and to_account_id must be different".into(),
                ));
            }
            if row.category_id.is_some() {
                return Err(AppError::Validation(
                    "TRANSFER transaction must have NULL category_id".into(),
                ));
            }
        }
        other => {
            return Err(AppError::Validation(format!(
                "Invalid tx_type '{}'",
                other
            )));
        }
    }

    Ok(())
}

pub fn validate_budget_row(row: &BudgetRow) -> AppResult<()> {
    if row.period != "MONTHLY" {
        return Err(AppError::Validation(format!(
            "Unsupported budget period '{}', only MONTHLY is supported in v1",
            row.period
        )));
    }
    if row.amount_limit <= 0 {
        return Err(AppError::Validation(
            "Budget amount_limit must be > 0".into(),
        ));
    }
    if !(1..=100).contains(&row.alert_threshold_pct) {
        return Err(AppError::Validation(
            "Budget alert_threshold_pct must be between 1 and 100".into(),
        ));
    }
    if row.is_deleted != 0 && row.is_deleted != 1 {
        return Err(AppError::Validation("is_deleted must be 0 or 1".into()));
    }
    let expected_id = deterministic_budget_id(row.category_id.as_deref(), &row.period);
    if row.id != expected_id {
        return Err(AppError::Validation(format!(
            "Budget id '{}' does not match deterministic UUIDv5 '{}'",
            row.id, expected_id
        )));
    }
    Ok(())
}

pub fn write_local_account_op(
    tx: &Transaction<'_>,
    row: &AccountRow,
    device_id: &str,
) -> AppResult<()> {
    validate_account_row(row)?;
    let envelope = CrdtEnvelope {
        op: "upsert".to_string(),
        row: row.clone(),
    };
    let payload_json = serde_json::to_string(&envelope)?;

    tx.execute(
        "INSERT INTO accounts (id, name, account_type, initial_balance, merged_into_id, is_deleted, updated_hlc)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            account_type = excluded.account_type,
            initial_balance = excluded.initial_balance,
            merged_into_id = excluded.merged_into_id,
            is_deleted = excluded.is_deleted,
            updated_hlc = excluded.updated_hlc",
        params![
            row.id,
            row.name,
            row.account_type,
            row.initial_balance,
            row.merged_into_id,
            row.is_deleted,
            row.updated_hlc
        ],
    )?;

    tx.execute(
        "INSERT INTO crdt_oplog (hlc_timestamp, table_name, row_id, payload_json, device_id)
         VALUES (?1, 'accounts', ?2, ?3, ?4)",
        params![row.updated_hlc, row.id, payload_json, device_id],
    )?;

    Ok(())
}

pub fn write_local_category_op(
    tx: &Transaction<'_>,
    row: &CategoryRow,
    device_id: &str,
) -> AppResult<()> {
    validate_category_row(row)?;
    let normalized = normalize_category_name(&row.name);
    let mut clean_row = row.clone();
    clean_row.normalized_name = normalized;
    // Auto-merge merged_into_id is derived state and must never be written to oplog
    clean_row.merged_into_id = None;

    let envelope = CrdtEnvelope {
        op: "upsert".to_string(),
        row: clean_row.clone(),
    };
    let payload_json = serde_json::to_string(&envelope)?;

    tx.execute(
        "INSERT INTO categories (id, name, normalized_name, kind, merged_into_id, is_deleted, updated_hlc)
         VALUES (?1, ?2, ?3, ?4, NULL, ?5, ?6)
         ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            normalized_name = excluded.normalized_name,
            kind = excluded.kind,
            is_deleted = excluded.is_deleted,
            updated_hlc = excluded.updated_hlc",
        params![
            clean_row.id,
            clean_row.name,
            clean_row.normalized_name,
            clean_row.kind,
            clean_row.is_deleted,
            clean_row.updated_hlc
        ],
    )?;

    tx.execute(
        "INSERT INTO crdt_oplog (hlc_timestamp, table_name, row_id, payload_json, device_id)
         VALUES (?1, 'categories', ?2, ?3, ?4)",
        params![clean_row.updated_hlc, clean_row.id, payload_json, device_id],
    )?;

    Ok(())
}

pub fn write_local_transaction_op(
    tx: &Transaction<'_>,
    row: &TransactionRow,
    device_id: &str,
) -> AppResult<()> {
    validate_transaction_row(row)?;
    let envelope = CrdtEnvelope {
        op: "upsert".to_string(),
        row: row.clone(),
    };
    let payload_json = serde_json::to_string(&envelope)?;

    tx.execute(
        "INSERT INTO transactions (
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
            updated_hlc = excluded.updated_hlc",
        params![
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
            row.updated_hlc
        ],
    )?;

    tx.execute(
        "INSERT INTO crdt_oplog (hlc_timestamp, table_name, row_id, payload_json, device_id)
         VALUES (?1, 'transactions', ?2, ?3, ?4)",
        params![row.updated_hlc, row.id, payload_json, device_id],
    )?;

    Ok(())
}

pub fn write_local_budget_op(
    tx: &Transaction<'_>,
    row: &BudgetRow,
    device_id: &str,
) -> AppResult<()> {
    validate_budget_row(row)?;
    let envelope = CrdtEnvelope {
        op: "upsert".to_string(),
        row: row.clone(),
    };
    let payload_json = serde_json::to_string(&envelope)?;

    tx.execute(
        "INSERT INTO budgets (id, category_id, period, amount_limit, alert_threshold_pct, is_deleted, updated_hlc)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(id) DO UPDATE SET
            category_id = excluded.category_id,
            period = excluded.period,
            amount_limit = excluded.amount_limit,
            alert_threshold_pct = excluded.alert_threshold_pct,
            is_deleted = excluded.is_deleted,
            updated_hlc = excluded.updated_hlc",
        params![
            row.id,
            row.category_id,
            row.period,
            row.amount_limit,
            row.alert_threshold_pct,
            row.is_deleted,
            row.updated_hlc
        ],
    )?;

    tx.execute(
        "INSERT INTO crdt_oplog (hlc_timestamp, table_name, row_id, payload_json, device_id)
         VALUES (?1, 'budgets', ?2, ?3, ?4)",
        params![row.updated_hlc, row.id, payload_json, device_id],
    )?;

    Ok(())
}

pub fn dedupe_categories(tx: &Transaction<'_>) -> AppResult<()> {
    tx.execute_batch(
        "WITH canonicals AS (
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
        END;",
    )?;
    Ok(())
}

pub fn merge_remote_oplog(
    conn: &mut Connection,
    ops: &[CrdtOp],
    now_ms: u64,
) -> AppResult<MergeReport> {
    if ops.len() > MAX_REMOTE_BATCH_OPS {
        return Err(AppError::Validation(format!(
            "Remote batch size {} exceeds maximum allowed {}",
            ops.len(),
            MAX_REMOTE_BATCH_OPS
        )));
    }

    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let mut clock = load_clock_from_tx(&tx)?;
    let mut changed_tables = BTreeSet::new();
    let mut applied_count = 0usize;

    for op in ops {
        let remote_hlc = HlcTimestamp::from_str(&op.hlc_timestamp)?;
        if remote_hlc.device_id != op.device_id {
            return Err(AppError::Validation(format!(
                "Op device_id '{}' does not match HLC device_id '{}'",
                op.device_id, remote_hlc.device_id
            )));
        }

        clock.receive(&remote_hlc, now_ms)?;

        match op.table_name.as_str() {
            "accounts" => {
                let env: CrdtEnvelope<AccountRow> = serde_json::from_str(&op.payload_json)?;
                if env.op != "upsert" {
                    return Err(AppError::Validation(format!(
                        "Unsupported CRDT op '{}'",
                        env.op
                    )));
                }
                let row = env.row;
                if row.id != op.row_id || row.updated_hlc != op.hlc_timestamp {
                    return Err(AppError::Validation(
                        "Account op row_id or updated_hlc mismatch".into(),
                    ));
                }
                validate_account_row(&row)?;

                tx.execute(
                    "INSERT OR IGNORE INTO crdt_oplog (hlc_timestamp, table_name, row_id, payload_json, device_id)
                     VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![op.hlc_timestamp, op.table_name, op.row_id, op.payload_json, op.device_id],
                )?;

                let existing_hlc: Option<String> = tx
                    .query_row(
                        "SELECT updated_hlc FROM accounts WHERE id = ?1",
                        params![row.id],
                        |r| r.get(0),
                    )
                    .optional()?;

                let should_apply = match existing_hlc {
                    None => true,
                    Some(ref cur) => op.hlc_timestamp.as_str() > cur.as_str(),
                };

                if should_apply {
                    tx.execute(
                        "INSERT INTO accounts (id, name, account_type, initial_balance, merged_into_id, is_deleted, updated_hlc)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                         ON CONFLICT(id) DO UPDATE SET
                            name = excluded.name,
                            account_type = excluded.account_type,
                            initial_balance = excluded.initial_balance,
                            merged_into_id = excluded.merged_into_id,
                            is_deleted = excluded.is_deleted,
                            updated_hlc = excluded.updated_hlc",
                        params![
                            row.id,
                            row.name,
                            row.account_type,
                            row.initial_balance,
                            row.merged_into_id,
                            row.is_deleted,
                            row.updated_hlc
                        ],
                    )?;
                    changed_tables.insert("accounts".to_string());
                    applied_count += 1;
                }
            }
            "categories" => {
                let env: CrdtEnvelope<CategoryRow> = serde_json::from_str(&op.payload_json)?;
                if env.op != "upsert" {
                    return Err(AppError::Validation(format!(
                        "Unsupported CRDT op '{}'",
                        env.op
                    )));
                }
                let mut row = env.row;
                if row.id != op.row_id || row.updated_hlc != op.hlc_timestamp {
                    return Err(AppError::Validation(
                        "Category op row_id or updated_hlc mismatch".into(),
                    ));
                }
                validate_category_row(&row)?;
                row.normalized_name = normalize_category_name(&row.name);
                row.merged_into_id = None;

                tx.execute(
                    "INSERT OR IGNORE INTO crdt_oplog (hlc_timestamp, table_name, row_id, payload_json, device_id)
                     VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![op.hlc_timestamp, op.table_name, op.row_id, op.payload_json, op.device_id],
                )?;

                let existing_hlc: Option<String> = tx
                    .query_row(
                        "SELECT updated_hlc FROM categories WHERE id = ?1",
                        params![row.id],
                        |r| r.get(0),
                    )
                    .optional()?;

                let should_apply = match existing_hlc {
                    None => true,
                    Some(ref cur) => op.hlc_timestamp.as_str() > cur.as_str(),
                };

                if should_apply {
                    tx.execute(
                        "INSERT INTO categories (id, name, normalized_name, kind, merged_into_id, is_deleted, updated_hlc)
                         VALUES (?1, ?2, ?3, ?4, NULL, ?5, ?6)
                         ON CONFLICT(id) DO UPDATE SET
                            name = excluded.name,
                            normalized_name = excluded.normalized_name,
                            kind = excluded.kind,
                            is_deleted = excluded.is_deleted,
                            updated_hlc = excluded.updated_hlc",
                        params![
                            row.id,
                            row.name,
                            row.normalized_name,
                            row.kind,
                            row.is_deleted,
                            row.updated_hlc
                        ],
                    )?;
                    changed_tables.insert("categories".to_string());
                    applied_count += 1;
                }
            }
            "transactions" => {
                let env: CrdtEnvelope<TransactionRow> = serde_json::from_str(&op.payload_json)?;
                if env.op != "upsert" {
                    return Err(AppError::Validation(format!(
                        "Unsupported CRDT op '{}'",
                        env.op
                    )));
                }
                let row = env.row;
                if row.id != op.row_id || row.updated_hlc != op.hlc_timestamp {
                    return Err(AppError::Validation(
                        "Transaction op row_id or updated_hlc mismatch".into(),
                    ));
                }
                validate_transaction_row(&row)?;

                tx.execute(
                    "INSERT OR IGNORE INTO crdt_oplog (hlc_timestamp, table_name, row_id, payload_json, device_id)
                     VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![op.hlc_timestamp, op.table_name, op.row_id, op.payload_json, op.device_id],
                )?;

                let existing_hlc: Option<String> = tx
                    .query_row(
                        "SELECT updated_hlc FROM transactions WHERE id = ?1",
                        params![row.id],
                        |r| r.get(0),
                    )
                    .optional()?;

                let should_apply = match existing_hlc {
                    None => true,
                    Some(ref cur) => op.hlc_timestamp.as_str() > cur.as_str(),
                };

                if should_apply {
                    tx.execute(
                        "INSERT INTO transactions (
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
                            updated_hlc = excluded.updated_hlc",
                        params![
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
                            row.updated_hlc
                        ],
                    )?;
                    changed_tables.insert("transactions".to_string());
                    applied_count += 1;
                }
            }
            "budgets" => {
                let env: CrdtEnvelope<BudgetRow> = serde_json::from_str(&op.payload_json)?;
                if env.op != "upsert" {
                    return Err(AppError::Validation(format!(
                        "Unsupported CRDT op '{}'",
                        env.op
                    )));
                }
                let row = env.row;
                if row.id != op.row_id || row.updated_hlc != op.hlc_timestamp {
                    return Err(AppError::Validation(
                        "Budget op row_id or updated_hlc mismatch".into(),
                    ));
                }
                validate_budget_row(&row)?;

                tx.execute(
                    "INSERT OR IGNORE INTO crdt_oplog (hlc_timestamp, table_name, row_id, payload_json, device_id)
                     VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![op.hlc_timestamp, op.table_name, op.row_id, op.payload_json, op.device_id],
                )?;

                let existing_hlc: Option<String> = tx
                    .query_row(
                        "SELECT updated_hlc FROM budgets WHERE id = ?1",
                        params![row.id],
                        |r| r.get(0),
                    )
                    .optional()?;

                let should_apply = match existing_hlc {
                    None => true,
                    Some(ref cur) => op.hlc_timestamp.as_str() > cur.as_str(),
                };

                if should_apply {
                    tx.execute(
                        "INSERT INTO budgets (id, category_id, period, amount_limit, alert_threshold_pct, is_deleted, updated_hlc)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                         ON CONFLICT(id) DO UPDATE SET
                            category_id = excluded.category_id,
                            period = excluded.period,
                            amount_limit = excluded.amount_limit,
                            alert_threshold_pct = excluded.alert_threshold_pct,
                            is_deleted = excluded.is_deleted,
                            updated_hlc = excluded.updated_hlc",
                        params![
                            row.id,
                            row.category_id,
                            row.period,
                            row.amount_limit,
                            row.alert_threshold_pct,
                            row.is_deleted,
                            row.updated_hlc
                        ],
                    )?;
                    changed_tables.insert("budgets".to_string());
                    applied_count += 1;
                }
            }
            other => {
                return Err(AppError::Validation(format!(
                    "Unknown table_name '{}' in remote oplog",
                    other
                )));
            }
        }
    }

    dedupe_categories(&tx)?;
    save_clock_to_tx(&tx, &clock)?;
    tx.commit()?;

    Ok(MergeReport {
        applied_count,
        tables: changed_tables.into_iter().collect(),
    })
}

pub const ACCOUNT_ROOTS_CTE_SQL: &str = "
WITH RECURSIVE walk(start_id, curr_id, next_id, depth, path) AS (
    SELECT id, id, merged_into_id, 0, ',' || id || ','
    FROM accounts
    UNION ALL
    SELECT w.start_id, a.id, a.merged_into_id, w.depth + 1, w.path || a.id || ','
    FROM walk w
    JOIN accounts a ON a.id = w.next_id
    WHERE w.depth < 16
      AND instr(w.path, ',' || w.next_id || ',') = 0
),
terminal AS (
    SELECT w.start_id, w.curr_id, w.next_id, w.depth AS max_depth, w.path
    FROM walk w
    WHERE w.depth = (SELECT MAX(w2.depth) FROM walk w2 WHERE w2.start_id = w.start_id)
),
cycle_entry AS (
    SELECT t.start_id,
           t.curr_id AS term_curr_id,
           w_cycle.depth AS cycle_start_depth
    FROM terminal t
    LEFT JOIN walk w_cycle
      ON w_cycle.start_id = t.start_id
     AND w_cycle.curr_id = t.next_id
),
account_roots AS (
    SELECT ce.start_id AS account_id,
           CASE
               WHEN ce.cycle_start_depth IS NOT NULL THEN (
                   SELECT MIN(w3.curr_id)
                   FROM walk w3
                   WHERE w3.start_id = ce.start_id
                     AND w3.depth >= ce.cycle_start_depth
               )
               ELSE ce.term_curr_id
           END AS root_id
    FROM cycle_entry ce
)";

pub fn resolve_account_roots_map(conn: &Connection) -> AppResult<HashMap<String, String>> {
    let sql = format!(
        "{} SELECT account_id, root_id FROM account_roots",
        ACCOUNT_ROOTS_CTE_SQL
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    })?;

    let mut map = HashMap::new();
    for r in rows {
        let (acc_id, root_id) = r?;
        map.insert(acc_id, root_id);
    }
    Ok(map)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::open_in_memory_book;
    use proptest::prelude::*;

    fn make_op<T: Serialize>(
        hlc_str: &str,
        table: &str,
        row_id: &str,
        device_id: &str,
        row: &T,
    ) -> CrdtOp {
        let env = CrdtEnvelope {
            op: "upsert".to_string(),
            row,
        };
        CrdtOp {
            hlc_timestamp: hlc_str.to_string(),
            table_name: table.to_string(),
            row_id: row_id.to_string(),
            payload_json: serde_json::to_string(&env).unwrap(),
            device_id: device_id.to_string(),
        }
    }

    #[test]
    fn test_category_auto_merge_deterministic_across_orders() {
        let cat_a = CategoryRow {
            id: "018f0000-0000-7000-8000-000000000002".to_string(),
            name: "Makan & Minum!".to_string(),
            normalized_name: "makanminum".to_string(),
            kind: "EXPENSE".to_string(),
            merged_into_id: None,
            is_deleted: 0,
            updated_hlc: "0000001000000-00001-aaaa1111".to_string(),
        };
        let cat_b = CategoryRow {
            id: "018f0000-0000-7000-8000-000000000001".to_string(),
            name: "makan   minum".to_string(),
            normalized_name: "makanminum".to_string(),
            kind: "EXPENSE".to_string(),
            merged_into_id: None,
            is_deleted: 0,
            updated_hlc: "0000001000005-00001-bbbb2222".to_string(),
        };

        let op_a = make_op(
            &cat_a.updated_hlc,
            "categories",
            &cat_a.id,
            "aaaa1111",
            &cat_a,
        );
        let op_b = make_op(
            &cat_b.updated_hlc,
            "categories",
            &cat_b.id,
            "bbbb2222",
            &cat_b,
        );

        let mut db1 = open_in_memory_book("00000000-0000-7000-8000-000000000100", "B1").unwrap();
        let mut db2 = open_in_memory_book("00000000-0000-7000-8000-000000000100", "B1").unwrap();

        merge_remote_oplog(&mut db1, &[op_a.clone(), op_b.clone()], 2_000_000).unwrap();
        merge_remote_oplog(&mut db2, &[op_b, op_a], 2_000_000).unwrap();

        let query = "SELECT id, merged_into_id FROM categories ORDER BY id ASC";
        let rows1: Vec<(String, Option<String>)> = db1
            .prepare(query)
            .unwrap()
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();
        let rows2: Vec<(String, Option<String>)> = db2
            .prepare(query)
            .unwrap()
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap()
            .map(|r| r.unwrap())
            .collect();

        assert_eq!(rows1, rows2);
        // Smaller ID (...0001) is canonical (merged_into_id = None)
        // Larger ID (...0002) is merged into ...0001
        assert_eq!(
            rows1[0],
            ("018f0000-0000-7000-8000-000000000001".to_string(), None)
        );
        assert_eq!(
            rows1[1],
            (
                "018f0000-0000-7000-8000-000000000002".to_string(),
                Some("018f0000-0000-7000-8000-000000000001".to_string())
            )
        );
    }

    #[test]
    fn test_account_root_resolution_chains_and_cycles() {
        let mut conn =
            open_in_memory_book("00000000-0000-7000-8000-000000000100", "Test").unwrap();

        // Chain: acc_c -> acc_b -> acc_a (root = acc_a)
        // Cycle: acc_y <-> acc_x, plus acc_d -> acc_y (where acc_d < acc_x < acc_y, root of cycle = acc_x)
        let accounts = vec![
            AccountRow {
                id: "acc_a".into(),
                name: "A".into(),
                account_type: "BANK".into(),
                initial_balance: 0,
                merged_into_id: None,
                is_deleted: 0,
                updated_hlc: "0000001000000-00001-aaaa1111".into(),
            },
            AccountRow {
                id: "acc_b".into(),
                name: "B".into(),
                account_type: "BANK".into(),
                initial_balance: 0,
                merged_into_id: Some("acc_a".into()),
                is_deleted: 0,
                updated_hlc: "0000001000000-00002-aaaa1111".into(),
            },
            AccountRow {
                id: "acc_c".into(),
                name: "C".into(),
                account_type: "BANK".into(),
                initial_balance: 0,
                merged_into_id: Some("acc_b".into()),
                is_deleted: 0,
                updated_hlc: "0000001000000-00003-aaaa1111".into(),
            },
            AccountRow {
                id: "acc_x".into(),
                name: "X".into(),
                account_type: "BANK".into(),
                initial_balance: 0,
                merged_into_id: Some("acc_y".into()),
                is_deleted: 0,
                updated_hlc: "0000001000000-00004-aaaa1111".into(),
            },
            AccountRow {
                id: "acc_y".into(),
                name: "Y".into(),
                account_type: "BANK".into(),
                initial_balance: 0,
                merged_into_id: Some("acc_x".into()),
                is_deleted: 0,
                updated_hlc: "0000001000000-00005-bbbb2222".into(),
            },
            AccountRow {
                id: "acc_d".into(),
                name: "D".into(),
                account_type: "BANK".into(),
                initial_balance: 0,
                merged_into_id: Some("acc_y".into()),
                is_deleted: 0,
                updated_hlc: "0000001000000-00006-aaaa1111".into(),
            },
        ];

        let ops: Vec<CrdtOp> = accounts
            .iter()
            .map(|a| {
                let dev = if a.id == "acc_y" {
                    "bbbb2222"
                } else {
                    "aaaa1111"
                };
                make_op(&a.updated_hlc, "accounts", &a.id, dev, a)
            })
            .collect();

        merge_remote_oplog(&mut conn, &ops, 2_000_000).unwrap();

        let roots = resolve_account_roots_map(&conn).unwrap();
        assert_eq!(roots.get("acc_a").unwrap(), "acc_a");
        assert_eq!(roots.get("acc_b").unwrap(), "acc_a");
        assert_eq!(roots.get("acc_c").unwrap(), "acc_a");
        assert_eq!(roots.get("acc_x").unwrap(), "acc_x");
        assert_eq!(roots.get("acc_y").unwrap(), "acc_x");
        assert_eq!(roots.get("acc_d").unwrap(), "acc_x");
    }

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(32))]
        #[test]
        fn prop_crdt_convergence_arbitrary_order_and_duplicates(
            raw_items in prop::collection::vec(
                (0u8..4u8, 1u64..500u64, 0u32..20u32, prop::bool::ANY, 1i64..10_000_000i64, prop::bool::ANY),
                1..40
            ),
            perm_seed in any::<u64>()
        ) {
            let mut ops = Vec::new();
            for (idx, (row_slot, wall_offset, counter, dev_flag, val, del_flag)) in raw_items.iter().enumerate() {
                let dev = if *dev_flag { "aaaa1111" } else { "bbbb2222" };
                let wall_ms = 1_700_000_000_000 + *wall_offset;
                let hlc = HlcTimestamp::new(wall_ms, *counter + (idx as u32), dev).unwrap().to_string();
                let is_deleted = if *del_flag { 1 } else { 0 };

                match row_slot % 4 {
                    0 => {
                        let id = format!("acc-{}", row_slot);
                        let row = AccountRow {
                            id: id.clone(),
                            name: format!("Account {}", val % 5),
                            account_type: "BANK".to_string(),
                            initial_balance: *val,
                            merged_into_id: None,
                            is_deleted,
                            updated_hlc: hlc.clone(),
                        };
                        ops.push(make_op(&hlc, "accounts", &id, dev, &row));
                    }
                    1 => {
                        let id = format!("cat-{}", row_slot);
                        let name = if val % 2 == 0 { "Makan".to_string() } else { "makan!".to_string() };
                        let row = CategoryRow {
                            id: id.clone(),
                            name: name.clone(),
                            normalized_name: normalize_category_name(&name),
                            kind: "EXPENSE".to_string(),
                            merged_into_id: None,
                            is_deleted,
                            updated_hlc: hlc.clone(),
                        };
                        ops.push(make_op(&hlc, "categories", &id, dev, &row));
                    }
                    2 => {
                        let id = format!("tx-{}", row_slot);
                        let row = TransactionRow {
                            id: id.clone(),
                            account_id: "acc-0".to_string(),
                            to_account_id: None,
                            category_id: Some("cat-1".to_string()),
                            amount: -(*val),
                            tx_type: "EXPENSE".to_string(),
                            note: Some(format!("note {}", val)),
                            tx_date: "2026-03-15".to_string(),
                            created_by_device: dev.to_string(),
                            link_id: None,
                            is_deleted,
                            updated_hlc: hlc.clone(),
                        };
                        ops.push(make_op(&hlc, "transactions", &id, dev, &row));
                    }
                    _ => {
                        let cat_opt = if val % 2 == 0 { None } else { Some("cat-1") };
                        let id = deterministic_budget_id(cat_opt, "MONTHLY");
                        let row = BudgetRow {
                            id: id.clone(),
                            category_id: cat_opt.map(|s| s.to_string()),
                            period: "MONTHLY".to_string(),
                            amount_limit: *val,
                            alert_threshold_pct: 80,
                            is_deleted,
                            updated_hlc: hlc.clone(),
                        };
                        ops.push(make_op(&hlc, "budgets", &id, dev, &row));
                    }
                }
            }

            let mut db1 = open_in_memory_book("00000000-0000-7000-8000-000000000100", "Book").unwrap();
            let mut db2 = open_in_memory_book("00000000-0000-7000-8000-000000000100", "Book").unwrap();

            let now_ms = 1_700_000_100_000;
            // Apply forward in db1
            merge_remote_oplog(&mut db1, &ops, now_ms).unwrap();

            // Apply shuffled + duplicated in chunks in db2
            let mut ops_shuffled = ops.clone();
            // Duplicate half of the ops
            for i in 0..(ops.len() / 2) {
                ops_shuffled.push(ops[i].clone());
            }
            // Deterministic shuffle using perm_seed
            let len = ops_shuffled.len();
            for i in 0..len {
                let j = ((perm_seed.wrapping_mul(i as u64 + 17).wrapping_add(31)) as usize) % len;
                ops_shuffled.swap(i, j);
            }
            for chunk in ops_shuffled.chunks(7) {
                merge_remote_oplog(&mut db2, chunk, now_ms).unwrap();
            }

            let dump_table = |conn: &Connection, query: &str| -> Vec<String> {
                let mut stmt = conn.prepare(query).unwrap();
                let col_count = stmt.column_count();
                stmt.query_map([], |r| {
                    let mut parts = Vec::new();
                    for c in 0..col_count {
                        let v: rusqlite::types::Value = r.get(c)?;
                        parts.push(format!("{:?}", v));
                    }
                    Ok(parts.join("|"))
                })
                .unwrap()
                .map(|r| r.unwrap())
                .collect()
            };

            assert_eq!(
                dump_table(&db1, "SELECT id, name, account_type, initial_balance, merged_into_id, is_deleted, updated_hlc FROM accounts ORDER BY id"),
                dump_table(&db2, "SELECT id, name, account_type, initial_balance, merged_into_id, is_deleted, updated_hlc FROM accounts ORDER BY id")
            );
            assert_eq!(
                dump_table(&db1, "SELECT id, name, normalized_name, kind, merged_into_id, is_deleted, updated_hlc FROM categories ORDER BY id"),
                dump_table(&db2, "SELECT id, name, normalized_name, kind, merged_into_id, is_deleted, updated_hlc FROM categories ORDER BY id")
            );
            assert_eq!(
                dump_table(&db1, "SELECT id, account_id, to_account_id, category_id, amount, tx_type, note, tx_date, created_by_device, link_id, is_deleted, updated_hlc FROM transactions ORDER BY id"),
                dump_table(&db2, "SELECT id, account_id, to_account_id, category_id, amount, tx_type, note, tx_date, created_by_device, link_id, is_deleted, updated_hlc FROM transactions ORDER BY id")
            );
            assert_eq!(
                dump_table(&db1, "SELECT id, category_id, period, amount_limit, alert_threshold_pct, is_deleted, updated_hlc FROM budgets ORDER BY id"),
                dump_table(&db2, "SELECT id, category_id, period, amount_limit, alert_threshold_pct, is_deleted, updated_hlc FROM budgets ORDER BY id")
            );
        }
    }
}

