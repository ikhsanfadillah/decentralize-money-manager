use super::models::{
    AddTransactionInput, PaginatedTransactions, TransactionFilter, TransactionView,
    TransferBetweenBooksInput, TransferBetweenBooksResult, UpdateTransactionInput,
};
use crate::crdt::{
    validate_transaction_row, write_local_transaction_op, TransactionRow, ACCOUNT_ROOTS_CTE_SQL,
};
use crate::db::{
    ensure_system_category_in_tx, new_uuid_v7, validate_book_id, AppState,
    SYSTEM_CATEGORY_MODAL_ID, SYSTEM_CATEGORY_MODAL_NAME, SYSTEM_CATEGORY_PRIVE_ID,
    SYSTEM_CATEGORY_PRIVE_NAME,
};
use crate::error::{AppError, AppResult};
use crate::hlc::{load_clock_from_tx, save_clock_to_tx, system_now_ms};
use rusqlite::{params, params_from_iter, Connection, OptionalExtension, TransactionBehavior};
use tauri::State;
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

