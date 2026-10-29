import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useBookFinance } from "../../hooks/useBookFinance";
import { useUiStore } from "../../stores/ui-store";
import {
  currentYearMonth,
  formatAccountTypeLabel,
  formatMonthLabel,
  formatRupiah,
  formatSignedRupiah,
} from "../../lib/utils";
import { BudgetProgressBar } from "../budgets/BudgetProgressBar";

export interface DashboardPageProps {
  bookId: string;
}

export const DashboardPage: React.FC<DashboardPageProps> = ({ bookId }) => {
  const currentMonth = React.useMemo(() => currentYearMonth(), []);
  const setNewTransactionModalOpen = useUiStore(
    (s) => s.setNewTransactionModalOpen
  );

  const {
    balancesQuery,
    summaryQuery,
    budgetProgressQuery,
    transactionsQuery,
  } = useBookFinance({
    bookId,
    budgetMonth: currentMonth,
    transactionFilter: {
      limit: 6,
      offset: 0,
      sort_by: "tx_date",
      sort_dir: "desc",
    },
  });

  const balances = balancesQuery.data ?? [];
  const cashFlowSummary = summaryQuery.data ?? [];
  const allBudgets = budgetProgressQuery.data ?? [];
  const recentTransactions = transactionsQuery.data?.items ?? [];

  const totalBalance = React.useMemo(
    () => balances.reduce((acc, item) => acc + item.current_balance, 0),
    [balances]
  );

  const currentMonthSummary = React.useMemo(() => {
    const found = cashFlowSummary.find((item) => item.month === currentMonth);
    return (
      found ?? {
        month: currentMonth,
        income: 0,
        expense: 0,
        net: 0,
      }
    );
  }, [cashFlowSummary, currentMonth]);

  // Section 8.2: Top 3 budgets with the highest `pct`
  const top3Budgets = React.useMemo(() => {
    return [...allBudgets].sort((a, b) => b.pct - a.pct).slice(0, 3);
  }, [allBudgets]);

  return (
    <div className="w-full space-y-4 sm:space-y-6">
      {/* Top 4 KPI Tabular Strip (2x2 Grid on Mobile, 4 Cols on Desktop) */}
      <div className="tabular-grid-container grid grid-cols-2 lg:grid-cols-4">
        <div className="tabular-grid-cell px-3 py-2.5">
          <p className="truncate text-[11px] font-medium text-muted-foreground">
            Total Uang Saat Ini
          </p>
          <p
            data-testid="dashboard-total-balance"
            className="mt-0.5 truncate font-mono text-sm font-semibold tabular-nums tracking-tight text-foreground sm:text-base"
          >
            {formatRupiah(totalBalance)}
          </p>
          <p className="truncate text-[10px] text-muted-foreground">
            Dari {balances.length} rekening & dompet
          </p>
        </div>

        <div className="tabular-grid-cell px-3 py-2.5">
          <p className="truncate text-[11px] font-medium text-muted-foreground">
            Pemasukan Bulan Ini
          </p>
          <p className="mt-0.5 truncate font-mono text-sm font-semibold tabular-nums tracking-tight text-emerald-500 sm:text-base">
            + {formatRupiah(currentMonthSummary.income)}
          </p>
          <p className="truncate text-[10px] text-muted-foreground">
            {formatMonthLabel(currentMonth)}
          </p>
        </div>

        <div className="tabular-grid-cell px-3 py-2.5">
          <p className="truncate text-[11px] font-medium text-muted-foreground">
            Pengeluaran Bulan Ini
          </p>
          <p className="mt-0.5 truncate font-mono text-sm font-semibold tabular-nums tracking-tight text-rose-500 sm:text-base">
            - {formatRupiah(currentMonthSummary.expense)}
          </p>
          <p className="truncate text-[10px] text-muted-foreground">
            {formatMonthLabel(currentMonth)}
          </p>
        </div>

        <div className="tabular-grid-cell px-3 py-2.5">
          <p className="truncate text-[11px] font-medium text-muted-foreground">
            Selisih Bulan Ini
          </p>
          <p
            className={`mt-0.5 truncate font-mono text-sm font-semibold tabular-nums tracking-tight sm:text-base ${
              currentMonthSummary.net >= 0
                ? "text-emerald-500"
                : "text-rose-500"
            }`}
          >
            {currentMonthSummary.net >= 0
              ? `+ ${formatRupiah(currentMonthSummary.net)}`
              : `- ${formatRupiah(Math.abs(currentMonthSummary.net))}`}
          </p>
          <p className="truncate text-[10px] text-muted-foreground">
            {currentMonthSummary.net >= 0 ? "Surplus tabungan" : "Pengeluaran lebih besar"}
          </p>
        </div>
      </div>

      {/* Middle Row: Account Balances & Top 3 Budgets This Month */}
      <div className="grid grid-cols-1 border-t border-border lg:grid-cols-12 lg:gap-px lg:bg-border">
        {/* Account Balances Allocation (7 cols) */}
        <div
          style={{ animationDelay: "45ms" }}
          className="tabular-grid-container flex flex-col lg:col-span-7"
        >
          <div className="tabular-grid-cell flex items-center justify-between gap-2 px-3 py-2">
            <div className="min-w-0">
              <h2 className="truncate text-xs font-semibold text-foreground sm:text-sm">
                Saldo Rekening & Dompet
              </h2>
              <p className="truncate text-[11px] text-muted-foreground">
                Rincian uang Anda di bank, tunai, dan e-wallet
              </p>
            </div>
            <Link
              to="/books/$bookId/accounts"
              params={{ bookId }}
              className="nav-touch-item shrink-0 rounded border border-border bg-background px-2 py-1 text-[11px] font-medium text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
            >
              Atur Rekening →
            </Link>
          </div>

          {balances.length === 0 ? (
            <div className="tabular-grid-cell p-4 text-center">
              <p className="text-xs text-muted-foreground">
                Belum ada rekening atau dompet. Tambahkan di menu Pengaturan → Rekening.
              </p>
            </div>
          ) : (
            balances.map((acc) => (
              <div
                key={acc.account_id}
                className="tabular-grid-cell flex items-center justify-between gap-2 px-3 py-2.5 text-xs"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate font-semibold text-foreground">
                      {acc.name}
                    </span>
                    <span className="shrink-0 rounded border border-border bg-background px-1.5 py-0.2 text-[10px] text-muted-foreground">
                      {formatAccountTypeLabel(acc.account_type)}
                    </span>
                  </div>
                </div>

                <span className="shrink-0 font-mono text-xs font-semibold tabular-nums tracking-tight text-foreground sm:text-sm">
                  {formatRupiah(acc.current_balance)}
                </span>
              </div>
            ))
          )}
        </div>

        {/* Budget Bulan Ini Card - Top 3 Highest pct (Section 8.2) (5 cols) */}
        <div
          data-testid="dashboard-budget-card"
          style={{ animationDelay: "90ms" }}
          className="tabular-grid-container flex flex-col lg:col-span-5"
        >
          <div className="tabular-grid-cell flex items-center justify-between gap-2 px-3 py-2">
            <div className="min-w-0">
              <h2 className="truncate text-xs font-semibold text-foreground sm:text-sm">
                Pantauan Anggaran ({formatMonthLabel(currentMonth)})
              </h2>
              <p className="truncate text-[11px] text-muted-foreground">
                Pos anggaran yang paling banyak terpakai bulan ini
              </p>
            </div>
            <Link
              to="/books/$bookId/budgets"
              params={{ bookId }}
              className="nav-touch-item shrink-0 rounded border border-border bg-background px-2 py-1 text-[11px] font-medium text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
            >
              Lihat Semua →
            </Link>
          </div>

          {top3Budgets.length === 0 ? (
            <div className="tabular-grid-cell flex flex-col items-center justify-center p-4 text-center">
              <p className="text-xs font-medium text-foreground">
                Belum ada anggaran bulanan yang ditetapkan
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Tetapkan batas pengeluaran bulanan untuk memantau realisasi.
              </p>
              <Link
                to="/books/$bookId/budgets"
                params={{ bookId }}
                className="nav-touch-item mt-2 rounded border border-border bg-primary px-2.5 py-1 text-[11px] font-semibold text-primary-foreground hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
              >
                Atur Anggaran Sekarang
              </Link>
            </div>
          ) : (
            top3Budgets.map((b) => (
              <div
                key={b.id}
                className="tabular-grid-cell space-y-1.5 px-3 py-2 text-xs"
              >
                <div className="flex flex-wrap items-center justify-between gap-1">
                  <span className="min-w-0 truncate font-semibold text-foreground">
                    {b.category_id === null
                      ? "Total Pengeluaran"
                      : b.category_name}
                  </span>
                  <span className="shrink-0 font-mono text-[11px] tabular-nums tracking-tight text-foreground">
                    {formatRupiah(b.spent)}{" "}
                    <span className="text-muted-foreground">
                      / {formatRupiah(b.amount_limit)}
                    </span>
                  </span>
                </div>
                <BudgetProgressBar
                  pct={b.pct}
                  status={b.status}
                  alertThresholdPct={b.alert_threshold_pct}
                />
              </div>
            ))
          )}
        </div>
      </div>

      {/* Bottom Row: 6-Month Cash Flow Summary & Recent Transactions */}
      <div className="grid grid-cols-1 border-t border-border lg:grid-cols-12 lg:gap-px lg:bg-border">
        {/* 6-Month Cash Flow Summary (6 cols) */}
        <div
          style={{ animationDelay: "135ms" }}
          className="tabular-grid-container flex flex-col lg:col-span-6"
        >
          <div className="tabular-grid-cell flex items-center justify-between gap-2 px-3 py-2">
            <div className="min-w-0">
              <h2 className="truncate text-xs font-semibold text-foreground sm:text-sm">
                Riwayat Bulanan
              </h2>
              <p className="truncate text-[11px] text-muted-foreground">
                Ringkasan uang masuk & keluar 6 bulan terakhir
              </p>
            </div>
            <Link
              to="/books/$bookId/reports"
              params={{ bookId }}
              className="nav-touch-item shrink-0 rounded border border-border bg-background px-2 py-1 text-[11px] font-medium text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
            >
              Lihat Laporan →
            </Link>
          </div>

          {/* Mobile Compact List (< sm): Zero Double Border */}
          <div className="grid grid-cols-1 gap-px bg-border sm:hidden">
            {cashFlowSummary.length === 0 ? (
              <div className="tabular-grid-cell p-4 text-center text-xs text-muted-foreground">
                Belum ada riwayat transaksi bulanan.
              </div>
            ) : (
              cashFlowSummary.map((row) => (
                <div
                  key={row.month}
                  className="tabular-grid-cell space-y-1 px-3 py-2 text-xs"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-foreground">
                      {formatMonthLabel(row.month)}
                    </span>
                    <span
                      className={`font-mono text-xs font-semibold tabular-nums ${
                        row.net >= 0 ? "text-emerald-500" : "text-rose-500"
                      }`}
                    >
                      {row.net >= 0
                        ? `+ ${formatRupiah(row.net)}`
                        : `- ${formatRupiah(Math.abs(row.net))}`}
                    </span>
                  </div>

                  <div className="flex items-center justify-between font-mono text-[11px] tabular-nums">
                    <span className="text-emerald-500">
                      Masuk: + {formatRupiah(row.income)}
                    </span>
                    <span className="text-rose-500">
                      Keluar: - {formatRupiah(row.expense)}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Desktop/Tablet Tabular View (sm+): Zero Double Border */}
          <div className="hidden overflow-x-auto sm:block">
            <div className="grid min-w-[440px] grid-cols-1 gap-px bg-border">
              <div className="tabular-grid-cell grid grid-cols-4 px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                <div>Bulan</div>
                <div className="text-right">Pemasukan</div>
                <div className="text-right">Pengeluaran</div>
                <div className="text-right">Sisa / Selisih</div>
              </div>

              {cashFlowSummary.length === 0 ? (
                <div className="tabular-grid-cell p-4 text-center text-xs text-muted-foreground">
                  Belum ada riwayat transaksi bulanan.
                </div>
              ) : (
                cashFlowSummary.map((row) => (
                  <div
                    key={row.month}
                    className="tabular-grid-cell grid grid-cols-4 items-center px-3 py-2 font-mono text-xs tabular-nums tracking-tight"
                  >
                    <div className="font-sans font-semibold text-foreground">
                      {formatMonthLabel(row.month)}
                    </div>
                    <div className="text-right text-emerald-500">
                      + {formatRupiah(row.income)}
                    </div>
                    <div className="text-right text-rose-500">
                      - {formatRupiah(row.expense)}
                    </div>
                    <div
                      className={`text-right font-semibold ${
                        row.net >= 0 ? "text-emerald-500" : "text-rose-500"
                      }`}
                    >
                      {row.net >= 0
                        ? `+ ${formatRupiah(row.net)}`
                        : `- ${formatRupiah(Math.abs(row.net))}`}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Recent Transactions (6 cols) */}
        <div
          style={{ animationDelay: "180ms" }}
          className="tabular-grid-container mt-4 md:mt-6 border-t! border-border! flex flex-col lg:col-span-6"
        >
          <div className="tabular-grid-cell flex items-center justify-between gap-2 px-3 py-2">
            <div className="min-w-0">
              <h2 className="truncate text-xs font-semibold text-foreground sm:text-sm">
                Catatan Transaksi Terbaru
              </h2>
              <p className="truncate text-[11px] text-muted-foreground">
                6 aktivitas terakhir di buku ini
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1.5">
              <button
                type="button"
                onClick={() => setNewTransactionModalOpen(true)}
                className="nav-touch-item rounded border border-border bg-primary px-2 py-1 text-[11px] font-semibold text-primary-foreground hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
              >
                + Catat
              </button>
              <Link
                to="/books/$bookId/transactions"
                params={{ bookId }}
                className="nav-touch-item rounded border border-border bg-background px-2 py-1 text-[11px] font-medium text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
              >
                Semua →
              </Link>
            </div>
          </div>

          {recentTransactions.length === 0 ? (
            <div className="tabular-grid-cell p-4 text-center text-xs text-muted-foreground">
              Belum ada transaksi tercatat.
            </div>
          ) : (
            recentTransactions.map((tx) => (
              <div
                key={tx.id}
                className="tabular-grid-cell flex items-center justify-between gap-2 px-3 py-2 text-xs"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate font-medium text-foreground">
                      {tx.tx_type === "TRANSFER"
                        ? `${tx.account_name} → ${tx.to_account_name ?? "-"}`
                        : tx.category_name ?? "Tanpa Kategori"}
                    </span>
                    {tx.link_id && (
                      <span className="shrink-0 rounded border border-primary/40 px-1 py-0.2 text-[9px] font-medium text-primary">
                        Pindah Buku
                      </span>
                    )}
                  </div>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {tx.tx_date} · {tx.account_name}
                    {tx.note ? ` · ${tx.note}` : ""}
                  </p>
                </div>

                <span
                  className={`shrink-0 font-mono text-xs font-semibold tabular-nums tracking-tight ${
                    tx.tx_type === "INCOME"
                      ? "text-emerald-500"
                      : tx.tx_type === "EXPENSE"
                        ? "text-rose-500"
                        : "text-sky-500"
                  }`}
                >
                  {formatSignedRupiah(tx.amount, tx.tx_type)}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

