use super::models::{BudgetProgressItem, UpsertBudgetInput};
use crate::crdt::{validate_budget_row, write_local_budget_op, BudgetRow};
use crate::db::{
    deterministic_budget_id, normalize_category_name, AppState, SYSTEM_CATEGORY_PRIVE_ID,
    SYSTEM_CATEGORY_PRIVE_NAME,
};
use crate::error::{AppError, AppResult};
use crate::hlc::{load_clock_from_tx, save_clock_to_tx, system_now_ms};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use tauri::State;
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

