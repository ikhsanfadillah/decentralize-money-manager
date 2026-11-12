use super::models::{CategoryView, UpsertCategoryInput};
use crate::crdt::{dedupe_categories, validate_category_row, write_local_category_op, CategoryRow};
use crate::db::{new_uuid_v7, normalize_category_name, AppState};
use crate::error::{AppError, AppResult};
use crate::hlc::{load_clock_from_tx, save_clock_to_tx, system_now_ms};
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use tauri::State;
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

