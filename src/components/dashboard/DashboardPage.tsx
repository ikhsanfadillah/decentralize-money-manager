import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useBookFinance } from "../../hooks/useBookFinance";
import { useUiStore } from "../../stores/ui-store";
import {
  currentYearMonth,
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
    <div className="space-y-6">
      {/* Top 4 KPI Tabular Strip */}
      <div className="tabular-grid-container grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
        <div className="tabular-grid-cell p-4">
          <p className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
            Total Saldo Akun
          </p>
          <p
            data-testid="dashboard-total-balance"
            className="mt-1.5 truncate font-mono text-xl font-semibold tabular-nums tracking-tight text-foreground"
          >
            {formatRupiah(totalBalance)}
          </p>
          <p className="mt-1 font-mono text-[11px] text-muted-foreground">
            {balances.length} akun kanonik aktif
          </p>
        </div>

        <div className="tabular-grid-cell p-4">
          <p className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
            Pemasukan ({formatMonthLabel(currentMonth)})
          </p>
          <p className="mt-1.5 truncate font-mono text-xl font-semibold tabular-nums tracking-tight text-emerald-500">
            + {formatRupiah(currentMonthSummary.income)}
          </p>
          <p className="mt-1 font-mono text-[11px] text-muted-foreground">
            Periode berjalan ({currentMonth})
          </p>
        </div>

        <div className="tabular-grid-cell p-4">
          <p className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
            Pengeluaran ({formatMonthLabel(currentMonth)})
          </p>
          <p className="mt-1.5 truncate font-mono text-xl font-semibold tabular-nums tracking-tight text-rose-500">
            - {formatRupiah(currentMonthSummary.expense)}
          </p>
          <p className="mt-1 font-mono text-[11px] text-muted-foreground">
            Periode berjalan ({currentMonth})
          </p>
        </div>

        <div className="tabular-grid-cell p-4">
          <p className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
            Arus Kas Bersih ({currentMonth})
          </p>
          <p
            className={`mt-1.5 truncate font-mono text-xl font-semibold tabular-nums tracking-tight ${
              currentMonthSummary.net >= 0
                ? "text-emerald-500"
                : "text-rose-500"
            }`}
          >
            {currentMonthSummary.net >= 0
              ? `+ ${formatRupiah(currentMonthSummary.net)}`
              : `- ${formatRupiah(Math.abs(currentMonthSummary.net))}`}
          </p>
          <p className="mt-1 font-mono text-[11px] text-muted-foreground">
            Selisih pemasukan & pengeluaran
          </p>
        </div>
      </div>

      {/* Middle Row: Account Balances & Top 3 Budgets This Month */}
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
        {/* Account Balances Allocation (7 cols) */}
        <div className="tabular-grid-container flex flex-col lg:col-span-7">
          <div className="tabular-grid-cell flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                Posisi Saldo per Akun
              </h2>
              <p className="text-xs text-muted-foreground">
                Dihitung melalui resolusi rekursif 16-level (`account_roots`)
              </p>
            </div>
            <Link
              to="/books/$bookId/accounts"
              params={{ bookId }}
              className="self-start rounded border whitespace-nowrap border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground shadow-none hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary sm:self-auto"
            >
              Kelola Akun →
            </Link>
          </div>

          {balances.length === 0 ? (
            <div className="tabular-grid-cell p-6 text-center">
              <p className="text-xs text-muted-foreground">
                Belum ada akun keuangan. Tambahkan akun di menu Akun.
              </p>
            </div>
          ) : (
            balances.map((acc) => (
              <div
                key={acc.account_id}
                className="tabular-grid-cell flex items-center justify-between gap-3 px-4 py-3 text-xs"
              >
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                    <span className="truncate font-semibold text-foreground">
                      {acc.name}
                    </span>
                    <span className="shrink-0 rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                      {acc.account_type}
                    </span>
                    {acc.merged_member_ids.length > 1 && (
                      <span className="shrink-0 rounded border border-primary/40 px-1.5 py-0.5 font-mono text-[10px] text-primary">
                        GABUNGAN {acc.merged_member_ids.length} AKUN
                      </span>
                    )}
                  </div>
                  <p className="truncate font-mono text-[11px] tabular-nums tracking-tight text-muted-foreground">
                    Saldo awal: {formatRupiah(acc.initial_balance)}
                  </p>
                </div>

                <span className="shrink-0 font-mono text-sm font-semibold tabular-nums tracking-tight text-foreground">
                  {formatRupiah(acc.current_balance)}
                </span>
              </div>
            ))
          )}
        </div>

        {/* Budget Bulan Ini Card - Top 3 Highest pct (Section 8.2) (5 cols) */}
        <div
          data-testid="dashboard-budget-card"
          className="tabular-grid-container flex flex-col lg:col-span-5"
        >
          <div className="tabular-grid-cell flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                Budget Bulan Ini ({currentMonth})
              </h2>
              <p className="text-xs text-muted-foreground">
                3 anggaran dengan persentase pemakaian tertinggi
              </p>
            </div>
            <Link
              to="/books/$bookId/budgets"
              params={{ bookId }}
              className="self-start rounded border whitespace-nowrap border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground shadow-none hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary sm:self-auto"
            >
              Semua Anggaran →
            </Link>
          </div>

          {top3Budgets.length === 0 ? (
            <div className="tabular-grid-cell flex flex-col items-center justify-center p-6 text-center">
              <p className="text-xs font-medium text-foreground">
                Belum ada anggaran bulanan yang ditetapkan
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Tetapkan batas pengeluaran bulanan untuk memantau realisasi.
              </p>
              <Link
                to="/books/$bookId/budgets"
                params={{ bookId }}
                className="mt-3 rounded whitespace-nowrap border border-border bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-none hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
              >
                Atur Anggaran Sekarang
              </Link>
            </div>
          ) : (
            top3Budgets.map((b) => (
              <div
                key={b.id}
                className="tabular-grid-cell space-y-2 px-4 py-3 text-xs"
              >
                <div className="flex flex-wrap items-center justify-between gap-1.5">
                  <span className="min-w-0 truncate font-semibold text-foreground">
                    {b.category_id === null
                      ? "Total Pengeluaran"
                      : b.category_name}
                  </span>
                  <span className="shrink-0 font-mono text-xs tabular-nums tracking-tight text-foreground">
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
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
        {/* 6-Month Cash Flow Summary (6 cols) */}
        <div className="tabular-grid-container flex flex-col lg:col-span-6">
          <div className="tabular-grid-cell flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                Ringkasan Arus Kas Bulanan
              </h2>
              <p className="text-xs text-muted-foreground">
                Rekapitulasi pemasukan & pengeluaran 6 bulan terakhir
              </p>
            </div>
            <Link
              to="/books/$bookId/reports"
              params={{ bookId }}
              className="self-start rounded border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground shadow-none hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary sm:self-auto"
            >
              Laporan Analitik →
            </Link>
          </div>

          {/* Mobile Card-Based List (< sm): Eliminates horizontal squeezing and text collisions */}
          <div className="divide-y divide-border sm:hidden">
            {cashFlowSummary.length === 0 ? (
              <div className="tabular-grid-cell p-6 text-center text-xs text-muted-foreground">
                Belum ada histori transaksi bulanan.
              </div>
            ) : (
              cashFlowSummary.map((row) => (
                <div
                  key={row.month}
                  className="tabular-grid-cell space-y-2 p-3.5 font-mono text-xs"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-bold tracking-tight text-foreground">
                      {row.month}
                    </span>
                    <div className="text-right">
                      <span className="block font-sans text-[10px] uppercase tracking-wider text-muted-foreground">
                        Selisih Bersih
                      </span>
                      <span
                        className={`text-xs font-semibold tabular-nums ${
                          row.net >= 0 ? "text-emerald-500" : "text-rose-500"
                        }`}
                      >
                        {row.net >= 0
                          ? `+ ${formatRupiah(row.net)}`
                          : `- ${formatRupiah(Math.abs(row.net))}`}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 border-t border-border/50 pt-2 tabular-nums">
                    <div>
                      <span className="block font-sans text-[10px] uppercase tracking-wider text-muted-foreground">
                        Pemasukan
                      </span>
                      <span className="font-medium text-emerald-500">
                        + {formatRupiah(row.income)}
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="block font-sans text-[10px] uppercase tracking-wider text-muted-foreground">
                        Pengeluaran
                      </span>
                      <span className="font-medium text-rose-500">
                        - {formatRupiah(row.expense)}
                      </span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Desktop/Tablet Tabular View (sm+): Horizontal Scroll Guard with min-width */}
          <div className="hidden sm:block overflow-x-auto">
            <div className="min-w-[480px]">
              <div className="tabular-grid-cell grid grid-cols-4 px-4 py-2 font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground border-b border-border">
                <div>Bulan</div>
                <div className="text-right">Pemasukan</div>
                <div className="text-right">Pengeluaran</div>
                <div className="text-right">Selisih Bersih</div>
              </div>

              {cashFlowSummary.length === 0 ? (
                <div className="tabular-grid-cell p-6 text-center text-xs text-muted-foreground">
                  Belum ada histori transaksi bulanan.
                </div>
              ) : (
                cashFlowSummary.map((row) => (
                  <div
                    key={row.month}
                    className="tabular-grid-cell grid grid-cols-4 items-center px-4 py-2.5 font-mono text-xs tabular-nums tracking-tight border-b border-border last:border-b-0"
                  >
                    <div className="font-semibold text-foreground">{row.month}</div>
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
        <div className="tabular-grid-container flex flex-col lg:col-span-6">
          <div className="tabular-grid-cell flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                Transaksi Terbaru
              </h2>
              <p className="text-xs text-muted-foreground">
                6 transaksi terakhir di buku ini
              </p>
            </div>
            <div className="flex items-center gap-2 self-start sm:self-auto">
              <button
                type="button"
                onClick={() => setNewTransactionModalOpen(true)}
                className="rounded border border-border bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground shadow-none hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
              >
                + Catat
              </button>
              <Link
                to="/books/$bookId/transactions"
                params={{ bookId }}
                className="rounded border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground shadow-none hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
              >
                Semua →
              </Link>
            </div>
          </div>

          {recentTransactions.length === 0 ? (
            <div className="tabular-grid-cell p-6 text-center text-xs text-muted-foreground">
              Belum ada transaksi tercatat.
            </div>
          ) : (
            recentTransactions.map((tx) => (
              <div
                key={tx.id}
                className="tabular-grid-cell flex items-center justify-between gap-3 px-4 py-2.5 text-xs"
              >
                <div className="min-w-0 flex-1 space-y-0.5">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium text-foreground">
                      {tx.tx_type === "TRANSFER"
                        ? `${tx.account_name} → ${tx.to_account_name ?? "-"}`
                        : tx.category_name ?? "Tanpa Kategori"}
                    </span>
                    {tx.link_id && (
                      <span className="shrink-0 rounded border border-primary/40 px-1 py-0.2 font-mono text-[10px] text-primary">
                        ANTAR-BUKU
                      </span>
                    )}
                  </div>
                  <p className="truncate font-mono text-[11px] text-muted-foreground">
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

