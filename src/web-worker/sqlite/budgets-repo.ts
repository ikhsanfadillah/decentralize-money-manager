import type { Database } from "@sqlite.org/sqlite-wasm";
import {
  TauriCommandError,
  type BudgetPeriod,
  type BudgetProgressItem,
  type BudgetRow,
  type BudgetStatus,
  type UpsertBudgetInput,
} from "../../lib/tauri-api";
import {
  SYSTEM_CATEGORY_PRIVE_ID,
  SYSTEM_CATEGORY_PRIVE_NAME,
  deterministicBudgetId,
  normalizeCategoryName,
  parseMonthBounds,
  systemNowMs,
} from "../../lib/web-core";
import {
  loadClockFromDb,
  saveClockToDb,
  validateBudgetRow,
  writeLocalBudgetOp,
  type LocalOpBroadcastFn,
} from "./crdt-ops";

export function listBudgetsInDb(db: Database): BudgetRow[] {
  const rows = db.selectArrays(
    `WITH active_budgets_raw AS (
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
    ORDER BY resolved_category_id IS NOT NULL ASC, id ASC`
  );

  return rows.map((r) => ({
    id: String(r[0]),
    category_id: r[1] !== null ? String(r[1]) : null,
    period: String(r[2]) as BudgetPeriod,
    amount_limit: Number(r[3]),
    alert_threshold_pct: Number(r[4]),
    is_deleted: Number(r[5]),
    updated_hlc: String(r[6]),
  }));
}

export function upsertBudgetInDb(
  db: Database,
  input: UpsertBudgetInput,
  bookId?: string,
  onOp?: LocalOpBroadcastFn
): BudgetRow {
  return db.transaction("IMMEDIATE", (tx) => {
    const period = (input.period?.trim() || "MONTHLY").toUpperCase() as BudgetPeriod;
    const alertThresholdPct = input.alert_threshold_pct ?? 80;
    const categoryId =
      input.category_id && input.category_id.trim() !== ""
        ? input.category_id.trim()
        : null;

    if (categoryId) {
      const catKind = tx.selectValue(
        "SELECT kind FROM categories WHERE id = ?1",
        [categoryId]
      );
      if (catKind && String(catKind) !== "EXPENSE") {
        throw new TauriCommandError(
          "VALIDATION_ERROR",
          "Budgets can only be created for EXPENSE categories"
        );
      }
    }

    const id = deterministicBudgetId(categoryId, period);
    const clock = loadClockFromDb(tx);
    const hlc = clock.tick(systemNowMs()).toString();
    const deviceId = clock.deviceId();

    const row: BudgetRow = {
      id,
      category_id: categoryId,
      period,
      amount_limit: input.amount_limit,
      alert_threshold_pct: alertThresholdPct,
      is_deleted: 0,
      updated_hlc: hlc,
    };

    validateBudgetRow(row);
    writeLocalBudgetOp(tx, row, deviceId, bookId, onOp);
    saveClockToDb(tx, clock);
    return row;
  });
}

export function deleteBudgetInDb(
  db: Database,
  budgetId: string,
  bookId?: string,
  onOp?: LocalOpBroadcastFn
): void {
  db.transaction("IMMEDIATE", (tx) => {
    const r = tx.selectArray(
      `SELECT id, category_id, period, amount_limit, alert_threshold_pct, is_deleted, updated_hlc
       FROM budgets WHERE id = ?1`,
      [budgetId]
    );
    if (!r) {
      throw new TauriCommandError("NOT_FOUND", `Budget ${budgetId}`);
    }
    const clock = loadClockFromDb(tx);
    const row: BudgetRow = {
      id: String(r[0]),
      category_id: r[1] !== null ? String(r[1]) : null,
      period: String(r[2]) as BudgetPeriod,
      amount_limit: Number(r[3]),
      alert_threshold_pct: Number(r[4]),
      is_deleted: 1,
      updated_hlc: clock.tick(systemNowMs()).toString(),
    };
    writeLocalBudgetOp(tx, row, clock.deviceId(), bookId, onOp);
    saveClockToDb(tx, clock);
  });
}

export function getBudgetProgressInDb(
  db: Database,
  month: string
): BudgetProgressItem[] {
  const [startDate, endDate] = parseMonthBounds(month);
  const priveNorm = normalizeCategoryName(SYSTEM_CATEGORY_PRIVE_NAME);

  const rows = db.selectArrays(
    `WITH active_budgets_raw AS (
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
    FROM deduped_budgets db`,
    [startDate, endDate, SYSTEM_CATEGORY_PRIVE_ID, priveNorm]
  );

  const items: BudgetProgressItem[] = rows.map((r) => {
    const id = String(r[0]);
    const categoryId = r[1] !== null ? String(r[1]) : null;
    const categoryName = String(r[2]);
    const period = String(r[3]) as BudgetPeriod;
    const amountLimit = Number(r[4]);
    const alertThresholdPct = Number(r[5]);
    const updatedHlc = String(r[6]);
    const spent = Math.max(0, Number(r[7]));
    const remaining = amountLimit - spent;
    const pct = Math.trunc((spent * 100) / amountLimit);
    const status: BudgetStatus =
      pct < alertThresholdPct ? "OK" : pct <= 100 ? "WARNING" : "OVER";

    return {
      id,
      category_id: categoryId,
      category_name: categoryName,
      period,
      amount_limit: amountLimit,
      alert_threshold_pct: alertThresholdPct,
      spent,
      remaining,
      pct,
      status,
      updated_hlc: updatedHlc,
    };
  });

  items.sort((a, b) => b.pct - a.pct || a.id.localeCompare(b.id));
  return items;
}

