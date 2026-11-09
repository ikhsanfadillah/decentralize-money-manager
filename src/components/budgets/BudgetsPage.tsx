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
    <div className="w-full space-y-5">
      {/* 1. Page Header & Month Capsule Selector */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-1">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-foreground sm:text-2xl">
            Anggaran Bulanan
          </h1>
          <p className="text-xs text-muted-foreground">
            Kelola batas pengeluaran kategori dan target total bulanan
          </p>
        </div>

        <div className="flex items-center gap-2 w-full">
          <div className="flex flex-1 items-center gap-1 justify-between rounded-full border border-border bg-card px-1.5 py-1 backdrop-blur-sm">
            <button
              type="button"
              aria-label="Bulan Sebelumnya"
              onClick={() => setSelectedMonth((m) => shiftYearMonth(m, -1))}
              className="nav-touch-item inline-flex h-7 w-7 items-center justify-center rounded-full text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <div className="flex items-center gap-1.5 px-2">
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
              className="nav-touch-item inline-flex h-7 w-7 items-center justify-center rounded-full text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>

          <button
            type="button"
            onClick={() => setActiveDrawerId("budget:new")}
            title="Atur Anggaran Baru"
            aria-label="Atur Anggaran Baru"
            className="nav-touch-item inline-flex h-9 items-center gap-1.5 rounded-full bg-cta-surface px-2.5 text-xs font-bold text-cta-foreground hover:opacity-90 active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Tambah Target</span>
          </button>
        </div>
      </div>

      {/* 2. Budget Glass Cards List */}
      {budgets.length === 0 ? (
        <div className="glass-card flex flex-col items-center justify-center p-8 text-center">
          <EmptyStateIllustration variant="active-budget-period" />
          <p className="mt-2 text-sm font-semibold text-foreground">
            Belum ada anggaran aktif untuk periode ini
          </p>
          <p className="mt-1 max-w-sm text-xs text-muted-foreground">
            Tambahkan batas pengeluaran per kategori atau total pengeluaran
            bulanan untuk mulai memantau progres.
          </p>
          <button
            type="button"
            onClick={() => setActiveDrawerId("budget:new")}
            className="mt-4 nav-touch-item inline-flex items-center gap-1.5 rounded-full bg-cta-surface px-4 py-2 text-xs font-bold text-cta-foreground hover:opacity-90"
          >
            <Plus className="h-4 w-4" />
            Atur Anggaran Sekarang
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {budgets.map((item, idx) => {
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
                style={{ animationDelay: `${idx * 30}ms` }}
                className="glass-card group nav-touch-item animate-card-up flex cursor-pointer flex-col justify-between gap-3.5 p-4 sm:p-5 transition-colors hover:bg-white/[0.13] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                {/* Top: Category Name + Realization & Remaining + Chevron */}
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-bold text-foreground sm:text-base">
                        {item.category_id === null
                          ? "Total Pengeluaran"
                          : item.category_name}
                      </span>
                      {item.category_id === null && (
                        <span className="shrink-0 rounded-full border border-border bg-muted px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                          Semua Belanja
                        </span>
                      )}
                    </div>
                    <p className="font-mono text-xs tabular-nums text-muted-foreground">
                      <span className="font-semibold text-foreground">
                        {formatRupiah(item.spent)}
                      </span>{" "}
                      / {formatRupiah(item.amount_limit)}
                    </p>
                  </div>

                  <div className="flex shrink-0 items-center gap-2 text-right">
                    <div
                      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 font-mono text-[11px] font-semibold tabular-nums ${
                        isOver
                          ? "border-rose-500/30 bg-rose-500/10 text-rose-500 dark:text-rose-400"
                          : "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                      }`}
                    >
                      {isOver ? (
                        <>
                          <TrendingDown
                            className="h-3 w-3 shrink-0"
                            aria-hidden="true"
                          />
                          <span>−{formatRupiah(Math.abs(item.remaining))}</span>
                        </>
                      ) : (
                        <>
                          <TrendingUp
                            className="h-3 w-3 shrink-0"
                            aria-hidden="true"
                          />
                          <span>Sisa {formatRupiah(item.remaining)}</span>
                        </>
                      )}
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
                  </div>
                </div>

                {/* Bottom: Segmented 24-Bar Progress Meter */}
                <div className="w-full">
                  <BudgetProgressBar
                    pct={item.pct}
                    status={item.status}
                    alertThresholdPct={item.alert_threshold_pct}
                    variant="segmented"
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 3. Edit / Create Budget Drawer */}
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

      {/* 4. Dedicated Delete Budget Confirmation Drawer */}
      <Drawer
        open={budgetPendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setBudgetPendingDelete(null);
        }}
      >
        <DrawerContent
          aria-describedby="delete-budget-confirm-desc"
          className="p-0 sm:mx-auto sm:max-w-md sm:rounded-t-3xl"
        >
          <div className="flex flex-col items-center px-5 pt-5 pb-3 text-center">
            <DeleteTransactionIllustration className="my-1 h-24 w-24" />

            <DrawerHeader className="mt-2 space-y-1 border-0 p-0">
              <DrawerTitle className="text-center text-base font-bold text-foreground sm:text-lg">
                Hapus Anggaran Ini?
              </DrawerTitle>
              <DrawerDescription
                id="delete-budget-confirm-desc"
                className="mx-auto max-w-xs text-center text-xs text-muted-foreground"
              >
                Batas belanja untuk kategori ini akan dihapus dari buku.
                Transaksi pengeluaran Anda tidak akan terhapus.
              </DrawerDescription>
            </DrawerHeader>

            {budgetPendingDelete && (
              <div className="mt-3 w-full space-y-1.5 rounded-2xl border border-border bg-muted p-3.5 text-left text-xs">
                <div className="flex items-center justify-between font-semibold">
                  <span className="truncate text-sm text-foreground">
                    {budgetPendingDelete.category_name}
                  </span>
                  <span className="font-mono text-xs text-foreground">
                    Batas: {formatRupiah(budgetPendingDelete.amount_limit)}
                  </span>
                </div>
                <div className="flex items-center justify-between border-t border-border pt-1.5 text-xs text-muted-foreground">
                  <span>Realisasi Saat Ini:</span>
                  <span className="font-mono font-bold text-foreground">
                    {formatRupiah(budgetPendingDelete.spent)} (
                    {budgetPendingDelete.pct}%)
                  </span>
                </div>
              </div>
            )}
          </div>

          <DrawerFooter className="flex flex-row items-center gap-2 border-t border-border px-5 py-3.5">
            <button
              type="button"
              onClick={() => setBudgetPendingDelete(null)}
              className="nav-touch-item h-10 flex-1 rounded-full border border-border bg-muted px-4 text-xs font-semibold text-foreground transition-all hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
            >
              Batal
            </button>
            <button
              type="button"
              disabled={deleteBudgetMutation.isPending}
              onClick={() => void handleConfirmDeleteBudget()}
              className="nav-touch-item inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-full bg-rose-600 px-4 text-xs font-semibold text-white transition-all hover:bg-rose-700 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-rose-600 disabled:opacity-50"
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
