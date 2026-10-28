import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  bookQueryKeys,
  useBookFinance,
  useBookSyncEvents,
} from "../../hooks/useBookFinance";
import { tauriApi } from "../../lib/tauri-api";
import {
  currentYearMonth,
  formatMonthLabel,
  formatRupiah,
  formatSignedRupiah,
  shiftYearMonth,
} from "../../lib/utils";
import { pushToast } from "../../lib/toast";
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

  const { monthlyReportQuery } = useBookFinance({
    bookId,
    budgetMonth: selectedMonth,
  });

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
      sort_dir: "asc",
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
        sort_dir: "asc",
        limit: 15,
        offset: 0,
      }),
    enabled: Boolean(bookId) && hasDrilldownFilter,
  });

  const report = monthlyReportQuery.data;

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

  if (monthlyReportQuery.isLoading || !report) {
    return (
      <div className="tabular-grid-container grid grid-cols-1">
        <div className="tabular-grid-cell p-8 text-center font-mono text-xs text-muted-foreground">
          Menyusun laporan analitik bulanan ({selectedMonth})...
        </div>
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

  const savingsRatePct = (report.savings_rate_bps / 100).toFixed(1);
  const isProjectedOverBudget =
    report.total_budget_limit !== null &&
    report.projected_month_expense > report.total_budget_limit;

  const displayedTransactions = hasDrilldownFilter
    ? (drilldownTxQuery.data?.items ?? [])
    : report.top_expenses;

  return (
    <div className="space-y-6">
      {/* Top Header, Month Selector & CSV Export */}
      <div className="tabular-grid-container grid grid-cols-1 md:grid-cols-12">
        <div className="tabular-grid-cell flex flex-col justify-center p-4 md:col-span-7">
          <h1 className="text-base font-semibold tracking-tight text-foreground">
            Laporan Analitik & Rekonsiliasi Bulanan
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Memisahkan arus kas operasional vs mutasi modal antar-buku, lengkap
            dengan kurva laju pengeluaran dan rekonsiliasi saldo akhir akun.
          </p>
        </div>

        <div className="tabular-grid-cell flex flex-col gap-2.5 p-4 sm:flex-row sm:items-center sm:justify-between md:col-span-5">
          <div className="flex w-full items-center justify-between gap-1 sm:w-auto sm:justify-start">
            <button
              type="button"
              aria-label="Bulan Laporan Sebelumnya"
              onClick={() =>
                handleMonthChange(shiftYearMonth(selectedMonth, -1))
              }
              className="inline-flex h-8 items-center justify-center rounded border border-border bg-background px-3 font-mono text-xs text-foreground shadow-none hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
            >
              ←
            </button>
            <span
              data-testid="report-selected-month"
              className="min-w-[130px] flex-1 text-center font-mono text-xs font-semibold text-foreground sm:flex-initial"
            >
              {formatMonthLabel(selectedMonth)}
            </span>
            <button
              type="button"
              aria-label="Bulan Laporan Berikutnya"
              onClick={() =>
                handleMonthChange(shiftYearMonth(selectedMonth, 1))
              }
              className="inline-flex h-8 items-center justify-center rounded border border-border bg-background px-3 font-mono text-xs text-foreground shadow-none hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
            >
              →
            </button>
          </div>

          <button
            type="button"
            onClick={handleExportCsv}
            className="inline-flex h-8 w-full items-center justify-center rounded-md border border-border bg-primary px-3 text-xs font-semibold text-primary-foreground shadow-none hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary sm:w-auto"
          >
            Ekspor CSV ({selectedMonth})
          </button>
        </div>
      </div>

      {/* 6-Card Executive KPI Strip */}
      <div className="tabular-grid-container grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {/* 1. Operational Income */}
        <div className="tabular-grid-cell p-4">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
              Pemasukan Operasional
            </span>
            {incomeMoMPct !== null && (
              <span
                className={`rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold ${
                  incomeMoMPct >= 0
                    ? "border-emerald-500/40 text-emerald-500"
                    : "border-rose-500/40 text-rose-500"
                }`}
              >
                {incomeMoMPct >= 0 ? `+${incomeMoMPct}%` : `${incomeMoMPct}%`}{" "}
                vs {report.prev_month}
              </span>
            )}
          </div>
          <p
            data-testid="report-operational-income"
            className="mt-1.5 font-mono text-lg font-semibold tabular-nums tracking-tight text-emerald-500"
          >
            + {formatRupiah(report.operational_income)}
          </p>
          <p className="mt-1 font-mono text-[11px] tabular-nums tracking-tight text-muted-foreground">
            Bulan lalu ({report.prev_month}):{" "}
            {formatRupiah(report.prev_operational_income)}
          </p>
        </div>

        {/* 2. Operational Expense */}
        <div className="tabular-grid-cell p-4">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
              Pengeluaran Konsumsi/Operasional
            </span>
            {expenseMoMPct !== null && (
              <span
                className={`rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold ${
                  expenseMoMPct <= 0
                    ? "border-emerald-500/40 text-emerald-500"
                    : "border-rose-500/40 text-rose-500"
                }`}
              >
                {expenseMoMPct >= 0
                  ? `+${expenseMoMPct}%`
                  : `${expenseMoMPct}%`}{" "}
                vs {report.prev_month}
              </span>
            )}
          </div>
          <p
            data-testid="report-operational-expense"
            className="mt-1.5 font-mono text-lg font-semibold tabular-nums tracking-tight text-rose-500"
          >
            - {formatRupiah(report.operational_expense)}
          </p>
          <p className="mt-1 font-mono text-[11px] tabular-nums tracking-tight text-muted-foreground">
            Bulan lalu ({report.prev_month}):{" "}
            {formatRupiah(report.prev_operational_expense)}
          </p>
        </div>

        {/* 3. Savings Rate & Operational Net */}
        <div className="tabular-grid-cell p-4">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
              Surplus Bersih & Savings Rate
            </span>
            <span
              data-testid="report-savings-rate-badge"
              className={`rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold ${
                report.savings_rate_bps >= 2000
                  ? "border-primary/40 text-primary"
                  : report.savings_rate_bps >= 0
                    ? "border-amber-500/40 text-amber-500"
                    : "border-rose-500/40 text-rose-500"
              }`}
            >
              SAVINGS RATE: {savingsRatePct}%
            </span>
          </div>
          <p
            className={`mt-1.5 font-mono text-lg font-semibold tabular-nums tracking-tight ${
              report.operational_net >= 0 ? "text-emerald-500" : "text-rose-500"
            }`}
          >
            {report.operational_net >= 0
              ? `+ ${formatRupiah(report.operational_net)}`
              : `- ${formatRupiah(Math.abs(report.operational_net))}`}
          </p>
          <p className="mt-1 font-mono text-[11px] text-muted-foreground">
            Selisih pemasukan & pengeluaran non-modal
          </p>
        </div>

        {/* 4. Daily Burn Rate & End-of-Month Projection */}
        <div className="tabular-grid-cell p-4">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
              Daily Burn Rate & Proyeksi
            </span>
            <span
              className={`rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold ${
                isProjectedOverBudget
                  ? "border-rose-500/40 text-rose-500"
                  : "border-primary/40 text-primary"
              }`}
            >
              {isProjectedOverBudget
                ? "PROYEKSI MELEBIHI ANGGARAN"
                : "LAJU TERKENDALI"}
            </span>
          </div>
          <p className="mt-1.5 font-mono text-lg font-semibold tabular-nums tracking-tight text-foreground">
            {formatRupiah(report.daily_burn_rate)}{" "}
            <span className="text-xs font-normal text-muted-foreground">
              / hari
            </span>
          </p>
          <p className="mt-1 font-mono text-[11px] tabular-nums tracking-tight text-muted-foreground">
            Proyeksi {report.days_in_month} hari:{" "}
            {formatRupiah(report.projected_month_expense)}
          </p>
        </div>

        {/* 5. No-Spend Days & Activity */}
        <div className="tabular-grid-cell p-4">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
              Hari Tanpa Pengeluaran
            </span>
            <span className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-foreground">
              {report.tx_count} Total Transaksi
            </span>
          </div>
          <p className="mt-1.5 font-mono text-lg font-semibold tabular-nums tracking-tight text-foreground">
            {report.no_spend_days} Hari{" "}
            <span className="text-xs font-normal text-muted-foreground">
              dari {report.elapsed_days} hari berjalan
            </span>
          </p>
          <p className="mt-1 font-mono text-[11px] text-muted-foreground">
            Disiplin hari bebas belanja konsumsi
          </p>
        </div>

        {/* 6. Cross-Book Capital & Prive Flow */}
        <div className="tabular-grid-cell p-4">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
              Arus Modal & Prive Antar-Buku
            </span>
            <span className="rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
              DIKECUALIKAN DARI KONSUMSI
            </span>
          </div>
          <div className="mt-1.5 flex items-baseline justify-between font-mono text-xs tabular-nums tracking-tight">
            <span className="text-emerald-500">
              Modal Masuk: +{formatRupiah(report.capital_injection)}
            </span>
            <span className="text-amber-500">
              Prive Keluar: −{formatRupiah(report.capital_withdrawal)}
            </span>
          </div>
          <p className="mt-1.5 font-mono text-[11px] text-muted-foreground">
            Mutasi ekuitas via `transfer_between_books`
          </p>
        </div>
      </div>

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
      <div className="tabular-grid-container grid grid-cols-1">
        <div className="tabular-grid-cell flex flex-wrap items-center justify-between gap-2 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-foreground">
              {hasDrilldownFilter
                ? "Hasil Filter Interaktif Grafik (Drill-Down Transaksi)"
                : `5 Pengeluaran Terbesar (${report.month})`}
            </h2>
            <p className="text-xs text-muted-foreground">
              {hasDrilldownFilter
                ? `Menampilkan transaksi untuk filter aktif: ${selectedDate ? `Tanggal ${selectedDate}` : "Semua Tanggal"} · ${selectedCategoryId ? `Kategori ID ${selectedCategoryId.slice(0, 8)}` : "Semua Kategori"}`
                : "Daftar transaksi pengeluaran dengan nominal terbesar pada bulan ini"}
            </p>
          </div>

          {hasDrilldownFilter && (
            <button
              type="button"
              onClick={() => {
                setSelectedDate(null);
                setSelectedCategoryId(null);
              }}
              className="rounded border border-primary/50 bg-background px-2.5 py-1 font-mono text-xs font-semibold text-primary shadow-none hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
            >
              Reset Semua Filter Grafik ×
            </button>
          )}
        </div>

        {displayedTransactions.length === 0 ? (
          <div className="tabular-grid-cell p-6 text-center text-xs text-muted-foreground">
            Tidak ada transaksi pada kriteria ini.
          </div>
        ) : (
          displayedTransactions.map((tx) => (
            <div
              key={tx.id}
              className="tabular-grid-cell flex items-center justify-between px-4 py-2.5 text-xs"
            >
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-foreground">
                    {tx.tx_type === "TRANSFER"
                      ? `${tx.account_name} → ${tx.to_account_name ?? "-"}`
                      : (tx.category_name ?? "Tanpa Kategori")}
                  </span>
                  <span className="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                    {tx.account_name}
                  </span>
                </div>
                <p className="font-mono text-[11px] text-muted-foreground">
                  {tx.tx_date} · Perangkat: {tx.created_by_device}
                  {tx.note ? ` · ${tx.note}` : ""}
                </p>
              </div>
              <span className="font-mono text-xs font-semibold tabular-nums tracking-tight text-rose-500">
                {formatSignedRupiah(tx.amount, tx.tx_type)}
              </span>
            </div>
          ))
        )}
      </div>

      {/* Bottom Grid: Account Reconciliation & P2P Device Contribution */}
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
        {/* Account Reconciliation Statement (8 cols) */}
        <div
          data-testid="account-reconciliation-table"
          className="tabular-grid-container flex flex-col lg:col-span-8"
        >
          <div className="tabular-grid-cell px-4 py-3">
            <h2 className="text-sm font-semibold text-foreground">
              Rekonsiliasi & Mutasi Saldo per Akun ({report.month})
            </h2>
            <p className="text-xs text-muted-foreground">
              Posisi Saldo Awal Bulan (&lt; {report.month}-01), Mutasi Masuk &
              Keluar (termasuk transfer), hingga Saldo Akhir Bulan.
            </p>
          </div>

          <div className="tabular-grid-cell hidden grid-cols-12 items-center bg-muted/40 px-4 py-2 font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground md:grid">
            <div className="col-span-3">Akun Kanonik</div>
            <div className="col-span-2 text-right">Saldo Awal</div>
            <div className="col-span-2 text-right">Total Masuk</div>
            <div className="col-span-2 text-right">Total Keluar</div>
            <div className="col-span-3 text-right">Saldo Akhir Bulan</div>
          </div>

          {report.account_reconciliation.length === 0 ? (
            <div className="tabular-grid-cell p-6 text-center text-xs text-muted-foreground">
              Belum ada akun terdaftar.
            </div>
          ) : (
            report.account_reconciliation.map((acc) => (
              <div
                key={acc.account_id}
                className="tabular-grid-cell grid grid-cols-1 items-center gap-2 px-4 py-3 text-xs md:grid-cols-12"
              >
                <div className="md:col-span-3">
                  <p className="font-semibold text-foreground">
                    {acc.account_name}
                  </p>
                  <p className="font-mono text-[10px] text-muted-foreground">
                    {acc.account_type} · {acc.tx_count} mutasi
                  </p>
                </div>

                <div className="font-mono tabular-nums tracking-tight text-muted-foreground md:col-span-2 md:text-right">
                  <span className="mr-1.5 font-sans text-[10px] uppercase text-muted-foreground md:hidden">
                    Saldo Awal:
                  </span>
                  {formatRupiah(acc.opening_balance)}
                </div>

                <div className="font-mono tabular-nums tracking-tight text-emerald-500 md:col-span-2 md:text-right">
                  <span className="mr-1.5 font-sans text-[10px] uppercase text-muted-foreground md:hidden">
                    Masuk:
                  </span>
                  +{formatRupiah(acc.month_inflow)}
                </div>

                <div className="font-mono tabular-nums tracking-tight text-rose-500 md:col-span-2 md:text-right">
                  <span className="mr-1.5 font-sans text-[10px] uppercase text-muted-foreground md:hidden">
                    Keluar:
                  </span>
                  −{formatRupiah(acc.month_outflow)}
                </div>

                <div className="font-mono font-semibold tabular-nums tracking-tight text-foreground md:col-span-3 md:text-right">
                  <span className="mr-1.5 font-sans text-[10px] uppercase text-muted-foreground md:hidden">
                    Saldo Akhir:
                  </span>
                  {formatRupiah(acc.closing_balance)}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Multi-Device P2P Audit Breakdown (4 cols) */}
        <div className="tabular-grid-container flex flex-col lg:col-span-4">
          <div className="tabular-grid-cell px-4 py-3">
            <h2 className="text-sm font-semibold text-foreground">
              Audit Kontribusi Perangkat P2P
            </h2>
            <p className="text-xs text-muted-foreground">
              Aktivitas pencatatan berdasarkan `created_by_device` pada bulan{" "}
              {report.month}
            </p>
          </div>

          {report.device_contributions.length === 0 ? (
            <div className="tabular-grid-cell p-6 text-center text-xs text-muted-foreground">
              Belum ada aktivitas perangkat pada periode ini.
            </div>
          ) : (
            report.device_contributions.map((dev) => (
              <div
                key={dev.device_id}
                className="tabular-grid-cell space-y-1.5 px-4 py-3 text-xs"
              >
                <div className="flex items-center justify-between font-mono">
                  <span className="font-semibold text-foreground">
                    Perangkat: {dev.device_id}
                  </span>
                  <span className="text-primary">
                    {dev.tx_count} tx ({(dev.share_bps / 100).toFixed(0)}%)
                  </span>
                </div>
                <div className="flex items-center justify-between font-mono text-[11px] tabular-nums tracking-tight">
                  <span className="text-emerald-500">
                    +{formatRupiah(dev.total_income)}
                  </span>
                  <span className="text-rose-500">
                    −{formatRupiah(dev.total_expense)}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
