import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Plus,
  Trash2,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import * as React from "react";
import { useBookFinance, useBookSyncEvents } from "../../hooks/useBookFinance";
import type { BudgetProgressItem } from "../../lib/tauri-api";
import { pushToast } from "../../lib/toast";
import {
  currentYearMonth,
  formatMonthLabel,
  formatRupiah,
  shiftYearMonth,
} from "../../lib/utils";
import { useUiStore } from "../../stores/ui-store";
import { DeleteTransactionIllustration } from "../transactions/TransactionTable";
import { EmptyStateIllustration } from "../ui/EmptyStateIllustration";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "../ui/drawer";
import { BudgetDialog } from "./BudgetDialog";
import { BudgetProgressBar } from "./BudgetProgressBar";

export interface BudgetsPageProps {
  bookId: string;
}

export const BudgetsPage: React.FC<BudgetsPageProps> = ({ bookId }) => {
  const [selectedMonth, setSelectedMonth] = React.useState<string>(() =>
    currentYearMonth()
  );
  const [budgetPendingDelete, setBudgetPendingDelete] =
    React.useState<BudgetProgressItem | null>(null);

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

  const handleConfirmDeleteBudget = async () => {
    if (!budgetPendingDelete) return;

    try {
      await deleteBudgetMutation.mutateAsync(budgetPendingDelete.id);
      pushToast(
        `Anggaran "${budgetPendingDelete.category_name}" berhasil dihapus`,
        { variant: "info" }
      );
      setBudgetPendingDelete(null);
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
      {/* 1. Header with Inline Plus Action */}
      <div className="tabular-grid-container grid grid-cols-1">
        <div className="tabular-grid-cell px-3 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 items-center gap-2">
              <h1 className="truncate text-xs font-semibold tracking-tight text-foreground sm:text-sm">
                Budgets
              </h1>
            </div>
            <button
              type="button"
              onClick={() => setActiveDrawerId("budget:new")}
              title="Atur Anggaran Baru"
              aria-label="Atur Anggaran Baru"
              className="nav-touch-item inline-flex h-7 w-7 shrink-0 items-center justify-center rounded border border-border bg-primary text-primary-foreground hover:opacity-90 active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary transition-all"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* 2. Month Selector Strip */}
      <div className="tabular-grid-container grid grid-cols-1">
        <div className="tabular-grid-cell flex items-center justify-between px-3 py-2">
          <button
            type="button"
            aria-label="Bulan Sebelumnya"
            onClick={() => setSelectedMonth((m) => shiftYearMonth(m, -1))}
            className="nav-touch-item inline-flex h-7 w-7 items-center justify-center rounded border border-border bg-background font-mono text-xs text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <div className="flex items-center gap-2">
            <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
            <span
              data-testid="selected-budget-month"
              className="font-mono text-xs font-semibold text-foreground"
            >
              {formatMonthLabel(selectedMonth)}
            </span>
          </div>
          <button
            type="button"
            aria-label="Bulan Berikutnya"
            onClick={() => setSelectedMonth((m) => shiftYearMonth(m, 1))}
            className="nav-touch-item inline-flex h-7 w-7 items-center justify-center rounded border border-border bg-background font-mono text-xs text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* 3. Tabular Budget Grid (Master View with Progressive Disclosure) */}
      <div className="tabular-grid-container grid grid-cols-1">
        {/* Desktop Header */}
        <div className="tabular-grid-cell hidden grid-cols-12 items-center px-3 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground md:grid">
          <div className="col-span-4">Kategori</div>
          <div className="col-span-4 text-right">Terpakai / Batas (Sisa)</div>
          <div className="col-span-4 text-right">Status & Realisasi</div>
        </div>

        {budgets.length === 0 ? (
          <div className="tabular-grid-cell flex flex-col items-center justify-center p-6 text-center">
            <EmptyStateIllustration variant="active-budget-period" />
            <p className="mt-2 text-xs font-medium text-foreground">
              Belum ada anggaran aktif untuk periode ini
            </p>
            <p className="mt-1 text-[11px] text-muted-foreground max-w-sm">
              Klik tombol &ldquo;+&rdquo; di atas untuk menetapkan batas
              pengeluaran per kategori atau total pengeluaran bulanan.
            </p>
            <button
              type="button"
              onClick={() => setActiveDrawerId("budget:new")}
              className="mt-3 nav-touch-item inline-flex items-center gap-1 rounded border border-border bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90"
            >
              <Plus className="h-3.5 w-3.5" />
              Atur Anggaran Sekarang
            </button>
          </div>
        ) : (
          budgets.map((item, idx) => {
            const isOver = item.remaining < 0;
            return (
              <div
                key={item.id}
                data-testid={`budget-row-${item.id}`}
                role="button"
                tabIndex={0}
                onClick={() => setActiveDrawerId(`budget:${item.id}`)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setActiveDrawerId(`budget:${item.id}`);
                  }
                }}
                style={{ animationDelay: `${idx * 25}ms` }}
                className="tabular-grid-cell group nav-touch-item animate-card-up flex cursor-pointer flex-col gap-2 px-3 py-2.5 text-xs transition-colors hover:bg-muted/60 active:bg-muted/80 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
              >
                {/* Top: Category Name + Realization & Remaining + Chevron */}
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-semibold text-foreground text-xs sm:text-sm">
                        {item.category_id === null
                          ? "Total Pengeluaran"
                          : item.category_name}
                      </span>
                      {item.category_id === null && (
                        <span className="shrink-0 rounded border border-border bg-background px-1.5 py-0.2 font-mono text-[9px] text-muted-foreground">
                          Semua Belanja
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2 text-right">
                    <div className="flex flex-col items-end">
                      <div className="font-mono text-xs sm:text-sm tabular-nums tracking-tight">
                        <span className="font-semibold text-foreground">
                          {formatRupiah(item.spent)}
                        </span>
                        <span className="text-muted-foreground">
                          {" "}
                          / {formatRupiah(item.amount_limit)}
                        </span>
                      </div>
                      <div
                        className={`font-mono text-[11px] tabular-nums inline-flex items-center gap-0.5 ${
                          isOver
                            ? "font-semibold text-rose-500"
                            : "font-medium text-emerald-500"
                        }`}
                      >
                        {isOver ? (
                          <>
                            <TrendingDown
                              className="h-3 w-3 shrink-0"
                              aria-hidden="true"
                            />
                            <span>- {formatRupiah(Math.abs(item.remaining))}</span>
                          </>
                        ) : (
                          <>
                            <TrendingUp
                              className="h-3 w-3 shrink-0"
                              aria-hidden="true"
                            />
                            <span>Sisa: {formatRupiah(item.remaining)}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
                  </div>
                </div>

                {/* Bottom: Progress Bar */}
                <div className="w-full">
                  <BudgetProgressBar
                    pct={item.pct}
                    status={item.status}
                    alertThresholdPct={item.alert_threshold_pct}
                  />
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* 4. Edit / Create Budget Drawer */}
      <BudgetDialog
        isOpen={isBudgetDrawerOpen}
        onClose={() => setActiveDrawerId(null)}
        categories={categories}
        existingBudgets={budgets}
        initialCategoryId={initialCategoryId}
        onSave={(input) => upsertBudgetMutation.mutateAsync(input)}
        onInitiateDelete={(b) => setBudgetPendingDelete(b)}
        isSaving={upsertBudgetMutation.isPending}
      />

      {/* 5. Dedicated Delete Budget Confirmation Drawer */}
      <Drawer
        open={budgetPendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setBudgetPendingDelete(null);
        }}
      >
        <DrawerContent
          aria-describedby="delete-budget-confirm-desc"
          className="p-0 sm:mx-auto sm:max-w-md sm:rounded-t-2xl"
        >
          <div className="flex flex-col items-center px-4 pt-5 pb-2 text-center">
            <DeleteTransactionIllustration className="h-24 w-24 my-1" />

            <DrawerHeader className="p-0 mt-2 space-y-1 border-0">
              <DrawerTitle className="text-center text-base font-bold text-foreground sm:text-lg">
                Hapus Anggaran Ini?
              </DrawerTitle>
              <DrawerDescription
                id="delete-budget-confirm-desc"
                className="text-center text-xs text-muted-foreground max-w-xs mx-auto"
              >
                Batas belanja untuk kategori ini akan dihapus dari buku. Transaksi
                pengeluaran Anda tidak akan terhapus.
              </DrawerDescription>
            </DrawerHeader>

            {/* Budget Preview Box */}
            {budgetPendingDelete && (
              <div className="w-full mt-3 rounded-lg border border-border bg-muted/40 p-3 text-left text-xs space-y-1.5">
                <div className="flex items-center justify-between font-semibold">
                  <span className="truncate text-foreground text-sm">
                    {budgetPendingDelete.category_name}
                  </span>
                  <span className="font-mono text-xs text-foreground">
                    Batas: {formatRupiah(budgetPendingDelete.amount_limit)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground pt-1 border-t border-border/50">
                  <span>Realisasi Saat Ini:</span>
                  <span className="font-mono font-bold text-foreground">
                    {formatRupiah(budgetPendingDelete.spent)} ({budgetPendingDelete.pct}%)
                  </span>
                </div>
              </div>
            )}
          </div>

          <DrawerFooter className="border-t border-border px-4 py-3 bg-card/60 backdrop-blur-xs flex flex-row items-center gap-2">
            <button
              type="button"
              onClick={() => setBudgetPendingDelete(null)}
              className="nav-touch-item flex-1 h-9 rounded-lg border border-border bg-background px-4 font-mono text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground active:scale-98 transition-all focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
            >
              Batal
            </button>
            <button
              type="button"
              disabled={deleteBudgetMutation.isPending}
              onClick={() => void handleConfirmDeleteBudget()}
              className="nav-touch-item flex-1 h-9 inline-flex items-center justify-center gap-1.5 rounded-lg bg-rose-600 px-4 text-xs font-semibold text-white shadow-xs hover:bg-rose-700 active:scale-98 transition-all focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-rose-600 disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" />
              <span>
                {deleteBudgetMutation.isPending
                  ? "Menghapus..."
                  : "Hapus Anggaran"}
              </span>
            </button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </div>
  );
};
