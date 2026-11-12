import type { Database } from "@sqlite.org/sqlite-wasm";
import {
  TauriCommandError,
  type CategoryKind,
  type CategoryView,
  type UpsertCategoryInput,
} from "../../lib/tauri-api";
import {
  newUuidV7,
  normalizeCategoryName,
  systemNowMs,
} from "../../lib/web-core";
import {
  dedupeCategories,
  loadClockFromDb,
  saveClockToDb,
  validateCategoryRow,
  writeLocalCategoryOp,
  type CategoryRowInternal,
  type LocalOpBroadcastFn,
} from "./crdt-ops";

export function listCategoriesInDb(db: Database): CategoryView[] {
  const rows = db.selectArrays(
    `SELECT id, name, normalized_name, kind, merged_into_id, COALESCE(merged_into_id, id) AS canonical_id, is_deleted, updated_hlc
     FROM categories
     WHERE is_deleted = 0
     ORDER BY kind ASC, name ASC, id ASC`
  );
  return rows.map((r) => ({
    id: String(r[0]),
    name: String(r[1]),
    normalized_name: String(r[2]),
    kind: String(r[3]) as CategoryKind,
    merged_into_id: r[4] !== null ? String(r[4]) : null,
    canonical_id: String(r[5]),
    is_deleted: Number(r[6]),
    updated_hlc: String(r[7]),
  }));
}

export function upsertCategoryInDb(
  db: Database,
  input: UpsertCategoryInput,
  bookId?: string,
  onOp?: LocalOpBroadcastFn
): CategoryView {
  return db.transaction("IMMEDIATE", (tx) => {
    const clock = loadClockFromDb(tx);
    const hlc = clock.tick(systemNowMs()).toString();
    const deviceId = clock.deviceId();
    const id =
      input.id && input.id.trim() !== "" ? input.id.trim() : newUuidV7();
    const trimmedName = input.name.trim();
    const normalizedName = normalizeCategoryName(trimmedName);
    if (!normalizedName) {
      throw new TauriCommandError(
        "VALIDATION_ERROR",
        "Category name must contain at least one alphanumeric character"
      );
    }

    const row: CategoryRowInternal = {
      id,
      name: trimmedName,
      normalized_name: normalizedName,
      kind: input.kind.trim().toUpperCase() as CategoryKind,
      merged_into_id: null,
      is_deleted: 0,
      updated_hlc: hlc,
    };

    validateCategoryRow(row);
    writeLocalCategoryOp(tx, row, deviceId, bookId, onOp);
    dedupeCategories(tx);
    saveClockToDb(tx, clock);

    const v = tx.selectArray(
      `SELECT id, name, normalized_name, kind, merged_into_id, COALESCE(merged_into_id, id), is_deleted, updated_hlc
       FROM categories WHERE id = ?1`,
      [id]
    );
    if (!v) {
      throw new TauriCommandError("NOT_FOUND", `Category ${id}`);
    }
    return {
      id: String(v[0]),
      name: String(v[1]),
      normalized_name: String(v[2]),
      kind: String(v[3]) as CategoryKind,
      merged_into_id: v[4] !== null ? String(v[4]) : null,
      canonical_id: String(v[5]),
      is_deleted: Number(v[6]),
      updated_hlc: String(v[7]),
    };
  });
}

export function deleteCategoryInDb(
  db: Database,
  categoryId: string,
  bookId?: string,
  onOp?: LocalOpBroadcastFn
): void {
  db.transaction("IMMEDIATE", (tx) => {
    const r = tx.selectArray(
      `SELECT id, name, normalized_name, kind, merged_into_id, is_deleted, updated_hlc
       FROM categories WHERE id = ?1`,
      [categoryId]
    );
    if (!r) {
      throw new TauriCommandError("NOT_FOUND", `Category ${categoryId}`);
    }
    const clock = loadClockFromDb(tx);
    const row: CategoryRowInternal = {
      id: String(r[0]),
      name: String(r[1]),
      normalized_name: String(r[2]),
      kind: String(r[3]) as CategoryKind,
      merged_into_id: null,
      is_deleted: 1,
      updated_hlc: clock.tick(systemNowMs()).toString(),
    };
    writeLocalCategoryOp(tx, row, clock.deviceId(), bookId, onOp);
    dedupeCategories(tx);
    saveClockToDb(tx, clock);
  });
}

