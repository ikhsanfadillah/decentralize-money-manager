import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useBookFinance, useBookSyncEvents } from "../../hooks/useBookFinance";
import { useUiStore } from "../../stores/ui-store";
import {
  currentYearMonth,
  formatMonthLabel,
  formatRupiah,
  shiftYearMonth,
} from "../../lib/utils";
import { BudgetProgressBar } from "./BudgetProgressBar";
import { BudgetDialog } from "./BudgetDialog";
import { pushToast } from "../../lib/toast";

export interface BudgetsPageProps {
  bookId: string;
}

export const BudgetsPage: React.FC<BudgetsPageProps> = ({ bookId }) => {
  const [selectedMonth, setSelectedMonth] = React.useState<string>(() =>
    currentYearMonth()
  );

  // Ensure live crdt:synced invalidation is active when BudgetsPage is mounted
  useBookSyncEvents(bookId);

  const activeDrawerId = useUiStore((s) => s.activeDrawerId);
  const setActiveDrawerId = useUiStore((s) => s.setActiveDrawerId);

  const {
    budgetProgressQuery,
    categoriesQuery,
    upsertBudgetMutation,
    deleteBudgetMutation,
  } = useBookFinance({
    bookId,
    budgetMonth: selectedMonth,
  });

  const budgets = budgetProgressQuery.data ?? [];
  const categories = categoriesQuery.data ?? [];

  const isBudgetDrawerOpen =
    activeDrawerId !== null && activeDrawerId.startsWith("budget:");

  const initialCategoryId = React.useMemo(() => {
    if (!activeDrawerId || !activeDrawerId.startsWith("budget:")) {
      return undefined;
    }
    const suffix = activeDrawerId.slice("budget:".length);
    if (suffix === "new" || suffix === "__ALL__") {
      return null;
    }
    const existingById = budgets.find((b) => b.id === suffix);
    if (existingById) {
      return existingById.category_id;
    }
    return suffix;
  }, [activeDrawerId, budgets]);

  const handleDelete = async (budgetId: string, name: string) => {
    try {
      await deleteBudgetMutation.mutateAsync(budgetId);
      pushToast(`Anggaran "${name}" dihapus`, { variant: "info" });
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Gagal menghapus anggaran";
      pushToast("Gagal menghapus anggaran", {
        description: msg,
        variant: "error",
      });
    }
  };

  return (
    <div className="w-full">
      {/* Header & Month Selector */}
      <div className="tabular-grid-container grid grid-cols-1 md:grid-cols-3">
        <div className="tabular-grid-cell flex flex-col justify-between px-3 py-2.5 md:col-span-2">
          <div>
            <div className="flex items-center gap-2">
              <Link
                to="/books/$bookId/settings"
                params={{ bookId }}
                className="nav-touch-item inline-flex h-6 shrink-0 items-center rounded border border-border bg-background px-2 font-mono text-[10px] font-semibold text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
              >
                ← Pengaturan
              </Link>
              <h1 className="text-xs font-semibold tracking-tight text-foreground sm:text-sm">
                Manajemen Anggaran Bulanan
              </h1>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Pantau batas belanja bulanan Anda agar pengeluaran tetap terkontrol.
            </p>
          </div>
        </div>

        <div className="tabular-grid-cell flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex w-full items-center justify-between gap-1 sm:w-auto sm:justify-start">
            <button
              type="button"
              aria-label="Bulan Sebelumnya"
              onClick={() =>
                setSelectedMonth((m) => shiftYearMonth(m, -1))
              }
              className="nav-touch-item inline-flex h-7 items-center justify-center rounded border border-border bg-background px-2.5 font-mono text-xs text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
            >
              ←
            </button>
            <span
              data-testid="selected-budget-month"
              className="min-w-[120px] flex-1 text-center font-mono text-xs font-semibold text-foreground sm:flex-initial"
            >
              {formatMonthLabel(selectedMonth)}
            </span>
            <button
              type="button"
              aria-label="Bulan Berikutnya"
              onClick={() =>
                setSelectedMonth((m) => shiftYearMonth(m, 1))
              }
              className="nav-touch-item inline-flex h-7 items-center justify-center rounded border border-border bg-background px-2.5 font-mono text-xs text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
            >
              →
            </button>
          </div>

          <button
            type="button"
            onClick={() => setActiveDrawerId("budget:new")}
            className="nav-touch-item inline-flex h-7 w-full items-center justify-center rounded border border-border bg-primary px-2.5 text-xs font-semibold text-primary-foreground hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary sm:w-auto"
          >
            + Atur Anggaran
          </button>
        </div>
      </div>

      {/* Tabular Budget Grid (Section 8.2 & 9.5) */}
      <div className="tabular-grid-container grid grid-cols-1">
        <div className="tabular-grid-cell hidden grid-cols-12 items-center px-3 py-2 font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground md:grid">
          <div className="col-span-3">Kategori</div>
          <div className="col-span-3 text-right">Terpakai / Batas</div>
          <div className="col-span-2 text-right">Sisa Anggaran</div>
          <div className="col-span-3 px-3">Status & Realisasi</div>
          <div className="col-span-1 text-right">Aksi</div>
        </div>

        {budgets.length === 0 ? (
          <div className="tabular-grid-cell p-6 text-center">
            <p className="text-xs font-medium text-foreground">
              Belum ada anggaran aktif untuk periode ini
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Klik tombol &ldquo;+ Atur Anggaran&rdquo; untuk menetapkan batas
              pengeluaran per kategori atau total pengeluaran bulanan.
            </p>
          </div>
        ) : (
          budgets.map((item, idx) => {
            const isOver = item.remaining < 0;
            return (
              <div
                key={item.id}
                data-testid={`budget-row-${item.id}`}
                style={{ animationDelay: `${idx * 35}ms` }}
                className="tabular-grid-cell animate-card-up grid grid-cols-1 items-center gap-2 px-3 py-2.5 md:grid-cols-12"
              >
                <div className="md:col-span-3">
                  <p className="text-xs font-semibold text-foreground sm:text-sm">
                    {item.category_id === null
                      ? "Total Pengeluaran"
                      : item.category_name}
                  </p>
                  {item.category_id === null && (
                    <p className="font-mono text-[10px] text-muted-foreground">
                      Semua Kategori Belanja
                    </p>
                  )}
                </div>

                <div className="flex items-center justify-between font-mono text-xs tabular-nums tracking-tight md:col-span-3 md:block md:text-right">
                  <span className="font-sans text-[10px] uppercase text-muted-foreground md:hidden">
                    Realisasi:
                  </span>
                  <span>
                    <span className="font-semibold text-foreground">
                      {formatRupiah(item.spent)}
                    </span>
                    <span className="text-muted-foreground">
                      {" "}
                      / {formatRupiah(item.amount_limit)}
                    </span>
                  </span>
                </div>

                <div className="flex items-center justify-between font-mono text-xs tabular-nums tracking-tight md:col-span-2 md:block md:text-right">
                  <span className="font-sans text-[10px] uppercase text-muted-foreground md:hidden">
                    Sisa:
                  </span>
                  <span
                    className={
                      isOver
                        ? "font-semibold text-rose-500"
                        : "font-medium text-emerald-500"
                    }
                  >
                    {isOver
                      ? `- ${formatRupiah(Math.abs(item.remaining))}`
                      : formatRupiah(item.remaining)}
                  </span>
                </div>

                <div className="md:col-span-3 md:px-3">
                  <BudgetProgressBar
                    pct={item.pct}
                    status={item.status}
                    alertThresholdPct={item.alert_threshold_pct}
                  />
                </div>

                <div className="flex items-center justify-end gap-1.5 md:col-span-1">
                  <button
                    type="button"
                    onClick={() => setActiveDrawerId(`budget:${item.id}`)}
                    className="nav-touch-item rounded border border-border bg-background px-2 py-0.5 text-[11px] font-medium text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void handleDelete(item.id, item.category_name)
                    }
                    className="nav-touch-item rounded border border-border bg-background px-2 py-0.5 text-[11px] font-medium text-rose-500 hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
                  >
                    Hapus
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      <BudgetDialog
        isOpen={isBudgetDrawerOpen}
        onClose={() => setActiveDrawerId(null)}
        categories={categories}
        existingBudgets={budgets}
        initialCategoryId={initialCategoryId}
        onSave={(input) => upsertBudgetMutation.mutateAsync(input)}
        isSaving={upsertBudgetMutation.isPending}
      />
    </div>
  );
};

