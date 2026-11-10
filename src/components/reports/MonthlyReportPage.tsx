import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { motion, useReducedMotion } from "motion/react";
import {
  bookQueryKeys,
  useBookFinance,
  useBookSyncEvents,
} from "../../hooks/useBookFinance";
import { useSmoothReady } from "../../hooks/useSmoothReady";
import { tauriApi } from "../../lib/tauri-api";
import {
  currentYearMonth,
  formatAccountTypeLabel,
  formatMonthLabel,
  formatPercent,
  formatRupiah,
  formatSignedRupiah,
  shiftYearMonth,
} from "../../lib/utils";
import { formatDateReadable, formatDateShort } from "../../lib/date";
import { Calendar, ChevronLeft, ChevronRight, Download, TrendingDown, TrendingUp } from "lucide-react";
import { pushToast } from "../../lib/toast";
import { AiReportInsightCard } from "../ai/AiReportInsightCard";
import { InteractiveCashFlowChart } from "./InteractiveCashFlowChart";
import { InteractiveCategoryChart } from "./InteractiveCategoryChart";

export interface MonthlyReportPageProps {
  bookId: string;
}

export const MonthlyReportPage: React.FC<MonthlyReportPageProps> = ({
  bookId,
}) => {
  const [selectedMonth, setSelectedMonth] = React.useState<string>(() =>
    currentYearMonth()
  );
  const [selectedDate, setSelectedDate] = React.useState<string | null>(null);
  const [selectedCategoryId, setSelectedCategoryId] = React.useState<
    string | null
  >(null);

  useBookSyncEvents(bookId);

  const {
    monthlyReportQuery,
    budgetProgressQuery,
    categoriesQuery,
    upsertBudgetMutation,
  } = useBookFinance({
    bookId,
    budgetMonth: selectedMonth,
  });

  const booksQuery = useQuery({
    queryKey: bookQueryKeys.allBooks,
    queryFn: () => tauriApi.listBooks(),
  });
  const currentBook = booksQuery.data?.find((b) => b.id === bookId);
  const isBusinessBook = currentBook?.kind === "BUSINESS";

  // Reset interactive chart filters when switching month
  const handleMonthChange = (nextMonth: string) => {
    setSelectedMonth(nextMonth);
    setSelectedDate(null);
    setSelectedCategoryId(null);
  };

  const hasDrilldownFilter =
    selectedDate !== null || selectedCategoryId !== null;

  const drilldownTxQuery = useQuery({
    queryKey: bookQueryKeys.transactions(bookId, {
      start_date: selectedDate ?? `${selectedMonth}-01`,
      end_date: selectedDate ?? `${selectedMonth}-31`,
      category_id:
        selectedCategoryId === "__UNCATEGORIZED__"
          ? null
          : selectedCategoryId,
      sort_by: "amount",
      sort_dir: "desc",
      limit: 15,
      offset: 0,
    }),
    queryFn: () =>
      tauriApi.listTransactions(bookId, {
        start_date: selectedDate ?? `${selectedMonth}-01`,
        end_date: selectedDate ?? `${selectedMonth}-31`,
        category_id:
          selectedCategoryId === "__UNCATEGORIZED__"
            ? null
            : selectedCategoryId,
        sort_by: "amount",
        sort_dir: "desc",
        limit: 15,
        offset: 0,
      }),
    enabled: Boolean(bookId) && hasDrilldownFilter,
  });

  const shouldReduceMotion = useReducedMotion();
  const report = monthlyReportQuery.data;
  const { isReady, showSkeleton, didWaitForData } = useSmoothReady(
    monthlyReportQuery.isLoading || !report
  );

  const handleExportCsv = () => {
    if (!report) return;

    const lines: string[] = [
      `# LAPORAN KEUANGAN BULANAN (${report.month})`,
      "Bagian,Metrik,Nilai (Rp / Satuan)",
      `Ringkasan,Pemasukan Operasional,${report.operational_income}`,
      `Ringkasan,Pengeluaran Operasional,${report.operational_expense}`,
      `Ringkasan,Arus Kas Bersih Operasional,${report.operational_net}`,
      `Ringkasan,Rasio Tabungan (%),${(report.savings_rate_bps / 100).toFixed(2)}%`,
      `Ringkasan,Rata-rata Pengeluaran Harian,${report.daily_burn_rate}`,
      `Ringkasan,Proyeksi Pengeluaran Akhir Bulan,${report.projected_month_expense}`,
      `Ringkasan,Suntikan Modal Antar-Buku,${report.capital_injection}`,
      `Ringkasan,Prive / Penarikan Antar-Buku,${report.capital_withdrawal}`,
      "",
      "# REKONSILIASI SALDO AKUN",
      "Nama Akun,Jenis,Saldo Awal Bulan,Total Masuk,Total Keluar,Perubahan Bersih,Saldo Akhir Bulan,Jumlah Transaksi",
      ...report.account_reconciliation.map(
        (a) =>
          `"${a.account_name.replace(/"/g, '""')}",${a.account_type},${a.opening_balance},${a.month_inflow},${a.month_outflow},${a.net_change},${a.closing_balance},${a.tx_count}`
      ),
      "",
      "# RINCIAN KATEGORI & PERBANDINGAN BULAN LALU",
      `Kategori,Jenis,Nominal ${report.month},Nominal ${report.prev_month},Selisih Nominal,Porsi (%)`,
      ...report.category_breakdown.map(
        (c) =>
          `"${c.category_name.replace(/"/g, '""')}",${c.kind},${c.current_amount},${c.prev_amount},${c.delta_amount},${(c.share_bps / 100).toFixed(2)}%`
      ),
    ];

    const csvContent = lines.join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `laporan-keuangan-${report.month}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    pushToast(`Laporan CSV ${report.month} berhasil diunduh`, {
      variant: "success",
    });
  };

  if (!isReady) {
    if (!showSkeleton) {
      return <div className="w-full min-h-[50vh]" aria-busy="true" />;
    }
    return (
      <div className="animate-page-in glass-card p-8 text-center font-mono text-xs text-muted-foreground">
        Menyusun laporan analitik bulanan ({selectedMonth})...
      </div>
    );
  }

  if (monthlyReportQuery.isLoading || !report) {
    return (
      <div className="glass-card p-8 text-center font-mono text-xs text-muted-foreground">
        Menyusun laporan analitik bulanan ({selectedMonth})...
      </div>
    );
  }

  const incomeMoMPct =
    report.prev_operational_income > 0
      ? Math.round(
        ((report.operational_income - report.prev_operational_income) * 100) /
        report.prev_operational_income
      )
      : null;

  const expenseMoMPct =
    report.prev_operational_expense > 0
      ? Math.round(
        ((report.operational_expense - report.prev_operational_expense) *
          100) /
        report.prev_operational_expense
      )
      : null;

  const isProjectedOverBudget =
    report.total_budget_limit !== null &&
    report.projected_month_expense > report.total_budget_limit;

  const displayedTransactions = hasDrilldownFilter
    ? (drilldownTxQuery.data?.items ?? [])
    : report.top_expenses;

  return (
    <motion.div
      initial={
        didWaitForData
          ? { opacity: 0, y: shouldReduceMotion ? 0 : 4 }
          : false
      }
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: shouldReduceMotion ? 0.08 : 0.22,
        ease: [0.22, 1, 0.36, 1],
      }}
      className="w-full space-y-4 sm:space-y-5"
    >
      {/* Top Toolbar: Capsule Month Selector & Compact CSV Export */}
      <div className="flex flex-wrap items-center justify-between gap-3 ">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-foreground sm:text-2xl">
            Laporan Bulanan
          </h1>
          <p className="text-xs text-muted-foreground">
            Ringkasan dan analisis keuangan bulanan
          </p>
        </div>
        <div className="flex flex-1 items-center justify-between gap-1.5 rounded-full border border-border bg-card p-1">
          <button
            type="button"
            aria-label="Bulan Laporan Sebelumnya"
            onClick={() =>
              handleMonthChange(shiftYearMonth(selectedMonth, -1))
            }
            className="nav-touch-item inline-flex h-8 w-8 items-center justify-center rounded-full font-mono text-xs text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
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
            aria-label="Bulan Laporan Berikutnya"
            onClick={() =>
              handleMonthChange(shiftYearMonth(selectedMonth, 1))
            }
            className="nav-touch-item inline-flex h-8 w-8 items-center justify-center rounded-full font-mono text-xs text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>

        <button
          type="button"
          onClick={handleExportCsv}
          className="nav-touch-item inline-flex h-9 items-center gap-1.5 rounded-full bg-cta-surface px-2.5 text-xs font-bold text-cta-foreground hover:opacity-90 active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          <span className="hidden md:inline-block">Ekspor CSV</span>
        </button>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-3">
        {/* 1. Operational Income */}
        <div className="glass-card flex flex-col justify-between gap-2 p-4">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <TrendingUp className="h-3.5 w-3.5 text-emerald-400 shrink-0" aria-hidden="true" />
            <span>Pemasukan</span>
          </div>
          <div className="flex flex-wrap items-baseline gap-2">
            <p
              data-testid="report-operational-income"
              className="font-mono text-base font-bold tabular-nums tracking-tight text-emerald-500 dark:text-emerald-400 sm:text-lg"
            >
              {report.operational_income > 0
                ? `+${formatRupiah(report.operational_income)}`
                : "Rp 0"}
            </p>
            {incomeMoMPct !== null && (
              <span
                className={`inline-flex items-center gap-0.5 shrink-0 rounded-full border px-2 py-0.5 font-mono text-[10px] font-medium leading-none ${incomeMoMPct >= 0
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500 dark:text-emerald-400"
                  : "border-rose-500/30 bg-rose-500/10 text-rose-500 dark:text-rose-400"
                  }`}
              >
                {incomeMoMPct >= 0 ? "▲" : "▼"}
                {formatPercent(Math.abs(incomeMoMPct), 0)}
              </span>
            )}
          </div>
          <p className="truncate text-[11px] leading-normal text-muted-foreground">
            Bulan lalu:{" "}
            <span className="font-mono tabular-nums">
              {report.prev_operational_income > 0
                ? formatRupiah(report.prev_operational_income)
                : "—"}
            </span>
          </p>
        </div>

        {/* 2. Operational Expense */}
        <div className="glass-card flex flex-col justify-between gap-2 p-4">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <TrendingDown className="h-3.5 w-3.5 text-rose-400 shrink-0" aria-hidden="true" />
            <span>Pengeluaran</span>
          </div>
          <div className="flex flex-wrap items-baseline gap-2">
            <p
              data-testid="report-operational-expense"
              className="font-mono text-base font-bold tabular-nums tracking-tight text-rose-500 dark:text-rose-400 sm:text-lg"
            >
              {report.operational_expense > 0
                ? `−${formatRupiah(report.operational_expense)}`
                : "Rp 0"}
            </p>
            {expenseMoMPct !== null && (
              <span
                className={`inline-flex items-center gap-0.5 shrink-0 rounded-full border px-2 py-0.5 font-mono text-[10px] font-medium leading-none ${expenseMoMPct <= 0
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500 dark:text-emerald-400"
                  : "border-rose-500/30 bg-rose-500/10 text-rose-500 dark:text-rose-400"
                  }`}
              >
                {expenseMoMPct >= 0 ? "▲" : "▼"}
                {formatPercent(Math.abs(expenseMoMPct), 0)}
              </span>
            )}
          </div>
          <p className="truncate text-[11px] leading-normal text-muted-foreground">
            Bulan lalu:{" "}
            <span className="font-mono tabular-nums">
              {report.prev_operational_expense > 0
                ? formatRupiah(report.prev_operational_expense)
                : "—"}
            </span>
          </p>
        </div>

        {/* 3. Savings Rate & Operational Net */}
        <div className="glass-card flex flex-col justify-between gap-2 p-4">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            {report.operational_net >= 0 ? (
              <TrendingUp className="h-3.5 w-3.5 text-emerald-400 shrink-0" aria-hidden="true" />
            ) : (
              <TrendingDown className="h-3.5 w-3.5 text-rose-400 shrink-0" aria-hidden="true" />
            )}
            <span>Surplus Bersih</span>
          </div>
          <div className="flex flex-wrap items-baseline gap-2">
            <p
              className={`font-mono text-base font-bold tabular-nums tracking-tight sm:text-lg ${report.operational_net >= 0
                ? "text-emerald-500 dark:text-emerald-400"
                : "text-rose-500 dark:text-rose-400"
                }`}
            >
              {report.operational_net > 0
                ? `+${formatRupiah(report.operational_net)}`
                : report.operational_net < 0
                  ? `−${formatRupiah(Math.abs(report.operational_net))}`
                  : "Rp 0"}
            </p>
            <span
              data-testid="report-savings-rate-badge"
              className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[10px] font-medium leading-none ${report.savings_rate_bps >= 2000
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500 dark:text-emerald-400"
                : report.savings_rate_bps >= 0
                  ? "border-amber-500/30 bg-amber-500/10 text-amber-500 dark:text-amber-400"
                  : "border-rose-500/30 bg-rose-500/10 text-rose-500 dark:text-rose-400"
                }`}
            >
              Tabungan {formatPercent(report.savings_rate_bps / 100, 1)}
            </span>
          </div>
          <p className="truncate text-[11px] leading-normal text-muted-foreground">
            Rasio simpan dari pemasukan
          </p>
        </div>

        {/* 4. Daily Burn Rate & End-of-Month Projection */}
        <div className="glass-card flex flex-col justify-between gap-2 p-4">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <span>Rata-rata Harian</span>
          </div>
          <div className="flex flex-wrap items-baseline gap-2">
            <p className="font-mono text-base font-bold tabular-nums tracking-tight text-foreground sm:text-lg">
              {formatRupiah(report.daily_burn_rate)}{" "}
              <span className="font-sans text-xs font-normal text-muted-foreground">
                /hari
              </span>
            </p>
            <span
              className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold leading-none ${isProjectedOverBudget
                ? "border-rose-500/30 bg-rose-500/10 text-rose-500 dark:text-rose-400"
                : "border-emerald-500/30 bg-emerald-500/10 text-emerald-500 dark:text-emerald-400"
                }`}
            >
              {isProjectedOverBudget ? "Melebihi Anggaran" : "Aman"}
            </span>
          </div>
          <p className="truncate text-[11px] leading-normal text-muted-foreground">
            Estimasi {report.days_in_month} hari:{" "}
            <span className="font-mono tabular-nums">
              {formatRupiah(report.projected_month_expense)}
            </span>
          </p>
        </div>

        {/* 5. No-Spend Days & Activity */}
        <div className="glass-card flex flex-col justify-between gap-2 p-4">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <span>Hari Tanpa Belanja</span>
          </div>
          <div className="flex flex-wrap items-baseline gap-2">
            <p className="font-mono text-base font-bold tabular-nums tracking-tight text-foreground sm:text-lg">
              {report.no_spend_days} Hari{" "}
              <span className="font-sans text-xs font-normal text-muted-foreground">
                / {report.elapsed_days} hari
              </span>
            </p>
          </div>
          <p className="truncate text-[11px] leading-normal text-muted-foreground">
            Total {report.tx_count} transaksi bulan ini
          </p>
        </div>

        {/* 6. Cross-Book Capital / Transfer Antar-Buku */}
        {(isBusinessBook ||
          report.capital_injection > 0 ||
          report.capital_withdrawal > 0) && (
            <div className="glass-card flex flex-col justify-between gap-2 p-4">
              <div className="flex items-center justify-between gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">
                  {isBusinessBook ? "Modal & Prive" : "Transfer Antar-Buku"}
                </span>
                <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-[10px] font-medium leading-none text-muted-foreground">
                  {isBusinessBook ? "Ekuitas Usaha" : "Antar-Buku"}
                </span>
              </div>
              <div className="space-y-0.5 font-mono text-xs tabular-nums tracking-tight">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-sans text-[11px] text-muted-foreground">
                    Masuk
                  </span>
                  <span className="font-semibold text-emerald-500 dark:text-emerald-400">
                    {report.capital_injection > 0
                      ? `+${formatRupiah(report.capital_injection)}`
                      : "Rp 0"}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="font-sans text-[11px] text-muted-foreground">
                    Keluar
                  </span>
                  <span className="font-semibold text-amber-500 dark:text-amber-400">
                    {report.capital_withdrawal > 0
                      ? `−${formatRupiah(report.capital_withdrawal)}`
                      : "Rp 0"}
                  </span>
                </div>
              </div>
              <p className="truncate text-[11px] leading-normal text-muted-foreground">
                {isBusinessBook
                  ? "Mutasi modal & penarikan dana"
                  : "Perpindahan dana antar-buku"}
              </p>
            </div>
          )}
      </div>

      {/* AI Financial Advisor & Budget Insight Card */}
      <AiReportInsightCard
        bookId={bookId}
        month={selectedMonth}
        report={report}
        budgets={budgetProgressQuery.data ?? []}
        categories={categoriesQuery.data ?? []}
        isBusinessBook={isBusinessBook}
        onApplyBudget={(input) => upsertBudgetMutation.mutateAsync(input)}
      />

      {/* Interactive Chart 1: Daily Cash Flow & Cumulative Burn Rate */}
      <InteractiveCashFlowChart
        dailySeries={report.daily_series}
        daysInMonth={report.days_in_month}
        elapsedDays={report.elapsed_days}
        totalBudgetLimit={report.total_budget_limit}
        selectedDate={selectedDate}
        onSelectDate={setSelectedDate}
      />

      {/* Interactive Chart 2: Category Donut, Pareto 80/20 & MoM Diverging Bar */}
      <InteractiveCategoryChart
        items={report.category_breakdown}
        month={report.month}
        prevMonth={report.prev_month}
        selectedCategoryId={selectedCategoryId}
        onSelectCategoryId={setSelectedCategoryId}
      />

      {/* Drill-Down Transactions / Top 5 Largest Expenses */}
      <div
        id="drilldown-transactions-section"
        className="glass-card overflow-hidden"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 px-4 py-3.5 sm:px-5">
          <div className="space-y-0.5">
            <h2 className="text-xs font-bold text-foreground sm:text-sm">
              {hasDrilldownFilter
                ? "Hasil Filter Interaktif Grafik (Drill-Down Transaksi)"
                : "Pengeluaran Terbesar"}
            </h2>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {hasDrilldownFilter
                ? `Filter aktif: ${selectedDate ? `Tanggal ${formatDateShort(selectedDate)}` : "Semua Tanggal"} · ${selectedCategoryId ? "Kategori terpilih" : "Semua Kategori"}`
                : `5 transaksi pengeluaran tertinggi pada ${formatMonthLabel(report.month)}`}
            </p>
          </div>

          {hasDrilldownFilter && (
            <button
              type="button"
              onClick={() => {
                setSelectedDate(null);
                setSelectedCategoryId(null);
              }}
              className="nav-touch-item rounded-full border border-primary/50 bg-primary/15 px-3 py-1 text-xs font-semibold text-primary hover:bg-primary/25 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
            >
              Reset Filter ×
            </button>
          )}
        </div>

        <div className="divide-y divide-border/70">
          {displayedTransactions.length === 0 ? (
            <div className="p-6 text-center text-xs text-muted-foreground">
              Tidak ada transaksi pada kriteria ini.
            </div>
          ) : (
            displayedTransactions.map((tx) => (
              <div
                key={tx.id}
                className="flex items-center justify-between gap-3 px-4 py-3 text-xs sm:px-5"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    {tx.tx_type === "EXPENSE" ? (
                      <TrendingDown className="h-3.5 w-3.5 shrink-0 text-rose-400" aria-hidden="true" />
                    ) : tx.tx_type === "INCOME" ? (
                      <TrendingUp className="h-3.5 w-3.5 shrink-0 text-emerald-400" aria-hidden="true" />
                    ) : null}
                    <span className="truncate font-semibold text-foreground">
                      {tx.tx_type === "TRANSFER"
                        ? `${tx.account_name} → ${tx.to_account_name ?? "-"}`
                        : (tx.category_name ?? "Tanpa Kategori")}
                    </span>
                    <span className="shrink-0 rounded-full border border-border bg-black/[0.03] dark:bg-white/[0.06] px-2 py-0.5 text-[10px] text-muted-foreground">
                      {tx.account_name}
                    </span>
                  </div>
                  <p className="truncate text-[11px] leading-normal text-muted-foreground">
                    <span title={tx.tx_date}>{formatDateReadable(tx.tx_date)}</span>
                    {tx.note ? ` · ${tx.note}` : ""}
                  </p>
                </div>
                <span
                  className={`shrink-0 font-mono text-xs font-bold tabular-nums tracking-tight sm:text-sm ${tx.tx_type === "INCOME"
                    ? "text-emerald-500 dark:text-emerald-400"
                    : "text-rose-500 dark:text-rose-400"
                    }`}
                >
                  {formatSignedRupiah(tx.amount, tx.tx_type)}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Bottom Grid: Account Reconciliation & P2P Device Contribution */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* Account Reconciliation Statement (8 cols) */}
        <div
          data-testid="account-reconciliation-table"
          className="glass-card flex flex-col overflow-hidden lg:col-span-8"
        >
          <div className="space-y-0.5 border-b border-border/70 px-4 py-3.5 sm:px-5">
            <h2 className="text-xs font-bold text-foreground sm:text-sm">
              Mutasi Saldo Rekening
            </h2>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Posisi saldo awal, arus masuk &amp; keluar, hingga saldo akhir bulan
            </p>
          </div>

          <div className="hidden grid-cols-12 items-center border-b border-border/70 bg-black/[0.02] dark:bg-white/[0.04] px-4 py-2 text-[11px] font-medium text-muted-foreground md:grid sm:px-5">
            <div className="col-span-3">Nama Rekening</div>
            <div className="col-span-2 text-right">Saldo Awal</div>
            <div className="flex items-center justify-end gap-1 col-span-2 text-right">
              <TrendingUp className="h-3 w-3 text-emerald-400" aria-hidden="true" />
              <span>Total Masuk</span>
            </div>
            <div className="flex items-center justify-end gap-1 col-span-2 text-right">
              <TrendingDown className="h-3 w-3 text-rose-400" aria-hidden="true" />
              <span>Total Keluar</span>
            </div>
            <div className="col-span-3 text-right">Saldo Akhir</div>
          </div>

          <div className="divide-y divide-border/70">
            {report.account_reconciliation.length === 0 ? (
              <div className="p-6 text-center text-xs text-muted-foreground">
                Belum ada akun terdaftar.
              </div>
            ) : (
              report.account_reconciliation.map((acc) => (
                <div
                  key={acc.account_id}
                  className="grid grid-cols-1 items-center gap-1.5 px-4 py-3 text-xs md:grid-cols-12 md:gap-2 sm:px-5"
                >
                  <div className="flex items-center justify-between md:col-span-3 md:block">
                    <p className="font-semibold text-foreground">
                      {acc.account_name}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {formatAccountTypeLabel(acc.account_type)} · {acc.tx_count} transaksi
                    </p>
                  </div>

                  <div className="flex items-center justify-between font-mono text-xs tabular-nums tracking-tight text-muted-foreground md:col-span-2 md:block md:text-right">
                    <span className="font-sans text-[11px] text-muted-foreground md:hidden">
                      Saldo Awal
                    </span>
                    <span>{formatRupiah(acc.opening_balance)}</span>
                  </div>

                  <div className="flex items-center justify-between font-mono text-xs tabular-nums tracking-tight text-emerald-500 dark:text-emerald-400 md:col-span-2 md:block md:text-right">
                    <span className="font-sans text-[11px] text-muted-foreground md:hidden">
                      Total Masuk
                    </span>
                    <span className="inline-flex items-center gap-0.5">
                      <TrendingUp className="h-3 w-3 shrink-0" aria-hidden="true" />
                      <span>{formatRupiah(acc.month_inflow)}</span>
                    </span>
                  </div>

                  <div className="flex items-center justify-between font-mono text-xs tabular-nums tracking-tight text-rose-500 dark:text-rose-400 md:col-span-2 md:block md:text-right">
                    <span className="font-sans text-[11px] text-muted-foreground md:hidden">
                      Total Keluar
                    </span>
                    <span className="inline-flex items-center gap-0.5">
                      <TrendingDown className="h-3 w-3 shrink-0" aria-hidden="true" />
                      <span>{formatRupiah(acc.month_outflow)}</span>
                    </span>
                  </div>

                  <div className="flex items-center justify-between border-t border-border/60 pt-1.5 font-mono text-xs font-bold tabular-nums tracking-tight text-foreground md:col-span-3 md:block md:border-t-0 md:pt-0 md:text-right">
                    <span className="font-sans text-[11px] font-medium text-foreground md:hidden">
                      Saldo Akhir
                    </span>
                    <span>{formatRupiah(acc.closing_balance)}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Multi-Device P2P Audit Breakdown (4 cols) */}
        <div className="glass-card flex flex-col overflow-hidden lg:col-span-4">
          <div className="space-y-0.5 border-b border-border/70 px-4 py-3.5 sm:px-5">
            <h2 className="text-xs font-bold text-foreground sm:text-sm">
              Kontribusi Perangkat
            </h2>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Ringkasan pencatatan dari perangkat yang terhubung
            </p>
          </div>

          <div className="divide-y divide-border/70">
            {report.device_contributions.length === 0 ? (
              <div className="p-6 text-center text-xs text-muted-foreground">
                Belum ada aktivitas perangkat pada periode ini.
              </div>
            ) : (
              report.device_contributions.map((dev) => (
                <div
                  key={dev.device_id}
                  className="space-y-1.5 px-4 py-3 text-xs sm:px-5"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className="truncate font-semibold text-foreground">
                        {dev.device_name || `Perangkat ${dev.device_id}`}
                      </span>
                      <span className="rounded-full border border-border bg-black/[0.03] dark:bg-white/[0.06] px-2 py-0.5 font-mono text-[9px] text-muted-foreground shrink-0">
                        ID: {dev.device_id.slice(0, 8)}
                      </span>
                    </div>
                    <span className="shrink-0 font-mono text-[11px] font-semibold text-primary">
                      {dev.tx_count} transaksi ({formatPercent(dev.share_bps / 100, 0)})
                    </span>
                  </div>
                  <div className="flex items-center justify-between font-mono text-xs tabular-nums tracking-tight">
                    <span className="inline-flex items-center gap-0.5 text-emerald-500 dark:text-emerald-400">
                      <TrendingUp className="h-3 w-3 shrink-0" aria-hidden="true" />
                      <span>{formatRupiah(dev.total_income)}</span>
                    </span>
                    <span className="inline-flex items-center gap-0.5 text-rose-500 dark:text-rose-400">
                      <TrendingDown className="h-3 w-3 shrink-0" aria-hidden="true" />
                      <span>{formatRupiah(dev.total_expense)}</span>
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
};
