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
  formatAccountTypeLabel,
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
    <div className="w-full space-y-4 sm:space-y-6">
      {/* Top Toolbar: Month Selector & Compact CSV Export */}
      <div className="tabular-grid-container grid grid-cols-1">
        <div className="tabular-grid-cell flex items-center justify-between gap-3 px-3.5 py-2.5 sm:px-4 sm:py-3">
          <div className="flex items-center gap-1.5 sm:gap-2">
            <button
              type="button"
              aria-label="Bulan Laporan Sebelumnya"
              onClick={() =>
                handleMonthChange(shiftYearMonth(selectedMonth, -1))
              }
              className="nav-touch-item inline-flex h-8 w-8 items-center justify-center rounded border border-border bg-background font-mono text-xs text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
            >
              ←
            </button>
            <span
              data-testid="report-selected-month"
              className="min-w-[116px] text-center text-xs font-semibold tracking-tight text-foreground sm:min-w-[136px] sm:text-sm"
            >
              {formatMonthLabel(selectedMonth)}
            </span>
            <button
              type="button"
              aria-label="Bulan Laporan Berikutnya"
              onClick={() =>
                handleMonthChange(shiftYearMonth(selectedMonth, 1))
              }
              className="nav-touch-item inline-flex h-8 w-8 items-center justify-center rounded border border-border bg-background font-mono text-xs text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
            >
              →
            </button>
          </div>

          <button
            type="button"
            onClick={handleExportCsv}
            className="nav-touch-item inline-flex h-8 shrink-0 items-center justify-center rounded border border-primary bg-primary px-3 text-xs font-semibold text-primary-foreground hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
          >
            Ekspor CSV
          </button>
        </div>
      </div>

      {/* 6-Card Executive KPI Strip (2x3 on Mobile, 3x2 on Desktop) */}
      <div className="tabular-grid-container grid grid-cols-2 border-t border-border lg:grid-cols-3">
        {/* 1. Operational Income */}
        <div className="tabular-grid-cell flex flex-col justify-between gap-1.5 p-3.5 sm:p-4">
          <div className="flex items-center justify-between gap-1.5">
            <span className="truncate text-xs font-medium text-muted-foreground">
              Pemasukan
            </span>
            {incomeMoMPct !== null && (
              <span
                className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] font-medium leading-none ${
                  incomeMoMPct >= 0
                    ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-500"
                    : "border-rose-500/30 bg-rose-500/5 text-rose-500"
                }`}
              >
                {incomeMoMPct >= 0 ? `+${incomeMoMPct}%` : `${incomeMoMPct}%`}
              </span>
            )}
          </div>
          <p
            data-testid="report-operational-income"
            className="truncate font-mono text-base font-semibold tabular-nums tracking-tight text-emerald-500 sm:text-lg"
          >
            + {formatRupiah(report.operational_income)}
          </p>
          <p className="truncate text-[11px] leading-normal text-muted-foreground">
            Bulan lalu:{" "}
            <span className="font-mono tabular-nums">
              {formatRupiah(report.prev_operational_income)}
            </span>
          </p>
        </div>

        {/* 2. Operational Expense */}
        <div className="tabular-grid-cell flex flex-col justify-between gap-1.5 p-3.5 sm:p-4">
          <div className="flex items-center justify-between gap-1.5">
            <span className="truncate text-xs font-medium text-muted-foreground">
              Pengeluaran
            </span>
            {expenseMoMPct !== null && (
              <span
                className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] font-medium leading-none ${
                  expenseMoMPct <= 0
                    ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-500"
                    : "border-rose-500/30 bg-rose-500/5 text-rose-500"
                }`}
              >
                {expenseMoMPct >= 0
                  ? `+${expenseMoMPct}%`
                  : `${expenseMoMPct}%`}
              </span>
            )}
          </div>
          <p
            data-testid="report-operational-expense"
            className="truncate font-mono text-base font-semibold tabular-nums tracking-tight text-rose-500 sm:text-lg"
          >
            - {formatRupiah(report.operational_expense)}
          </p>
          <p className="truncate text-[11px] leading-normal text-muted-foreground">
            Bulan lalu:{" "}
            <span className="font-mono tabular-nums">
              {formatRupiah(report.prev_operational_expense)}
            </span>
          </p>
        </div>

        {/* 3. Savings Rate & Operational Net */}
        <div className="tabular-grid-cell flex flex-col justify-between gap-1.5 p-3.5 sm:p-4">
          <div className="flex items-center justify-between gap-1.5">
            <span className="truncate text-xs font-medium text-muted-foreground">
              Surplus Bersih
            </span>
            <span
              data-testid="report-savings-rate-badge"
              className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] font-medium leading-none ${
                report.savings_rate_bps >= 2000
                  ? "border-primary/30 bg-primary/5 text-primary"
                  : report.savings_rate_bps >= 0
                    ? "border-amber-500/30 bg-amber-500/5 text-amber-500"
                    : "border-rose-500/30 bg-rose-500/5 text-rose-500"
              }`}
            >
              Tabungan {savingsRatePct}%
            </span>
          </div>
          <p
            className={`truncate font-mono text-base font-semibold tabular-nums tracking-tight sm:text-lg ${
              report.operational_net >= 0 ? "text-emerald-500" : "text-rose-500"
            }`}
          >
            {report.operational_net >= 0
              ? `+ ${formatRupiah(report.operational_net)}`
              : `- ${formatRupiah(Math.abs(report.operational_net))}`}
          </p>
          <p className="truncate text-[11px] leading-normal text-muted-foreground">
            Rasio simpan dari pemasukan
          </p>
        </div>

        {/* 4. Daily Burn Rate & End-of-Month Projection */}
        <div className="tabular-grid-cell flex flex-col justify-between gap-1.5 p-3.5 sm:p-4">
          <div className="flex items-center justify-between gap-1.5">
            <span className="truncate text-xs font-medium text-muted-foreground">
              Rata-rata Harian
            </span>
            <span
              className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium leading-none ${
                isProjectedOverBudget
                  ? "border-rose-500/30 bg-rose-500/5 text-rose-500"
                  : "border-primary/30 bg-primary/5 text-primary"
              }`}
            >
              {isProjectedOverBudget ? "Melebihi Anggaran" : "Aman"}
            </span>
          </div>
          <p className="truncate font-mono text-base font-semibold tabular-nums tracking-tight text-foreground sm:text-lg">
            {formatRupiah(report.daily_burn_rate)}{" "}
            <span className="font-sans text-xs font-normal text-muted-foreground">
              /hari
            </span>
          </p>
          <p className="truncate text-[11px] leading-normal text-muted-foreground">
            Estimasi {report.days_in_month} hr:{" "}
            <span className="font-mono tabular-nums">
              {formatRupiah(report.projected_month_expense)}
            </span>
          </p>
        </div>

        {/* 5. No-Spend Days & Activity */}
        <div className="tabular-grid-cell flex flex-col justify-between gap-1.5 p-3.5 sm:p-4">
          <div className="flex items-center justify-between gap-1.5">
            <span className="truncate text-xs font-medium text-muted-foreground">
              Hari Tanpa Belanja
            </span>
          </div>
          <p className="truncate font-mono text-base font-semibold tabular-nums tracking-tight text-foreground sm:text-lg">
            {report.no_spend_days} Hari{" "}
            <span className="font-sans text-xs font-normal text-muted-foreground">
              / {report.elapsed_days} hr
            </span>
          </p>
          <p className="truncate text-[11px] leading-normal text-muted-foreground">
            Total {report.tx_count} transaksi bulan ini
          </p>
        </div>

        {/* 6. Cross-Book Capital & Prive Flow */}
        <div className="tabular-grid-cell flex flex-col justify-between gap-1.5 p-3.5 sm:p-4">
          <div className="flex items-center justify-between gap-1.5">
            <span className="truncate text-xs font-medium text-muted-foreground">
              Modal & Prive
            </span>
            <span className="shrink-0 rounded border border-border px-1.5 py-0.5 text-[10px] font-medium leading-none text-muted-foreground">
              Non-Konsumsi
            </span>
          </div>
          <div className="space-y-0.5 font-mono text-xs tabular-nums tracking-tight">
            <div className="flex items-center justify-between gap-2">
              <span className="font-sans text-[11px] text-muted-foreground">
                Masuk
              </span>
              <span className="font-semibold text-emerald-500">
                +{formatRupiah(report.capital_injection)}
              </span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="font-sans text-[11px] text-muted-foreground">
                Keluar
              </span>
              <span className="font-semibold text-amber-500">
                −{formatRupiah(report.capital_withdrawal)}
              </span>
            </div>
          </div>
          <p className="truncate text-[11px] leading-normal text-muted-foreground">
            Mutasi ekuitas antar-buku
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
      <div
        id="drilldown-transactions-section"
        className="tabular-grid-container grid grid-cols-1 border-t border-border"
      >
        <div className="tabular-grid-cell flex flex-wrap items-center justify-between gap-2 px-4 py-3">
          <div className="space-y-0.5">
            <h2 className="text-xs font-semibold text-foreground sm:text-sm">
              {hasDrilldownFilter
                ? "Hasil Filter Interaktif Grafik (Drill-Down Transaksi)"
                : "Pengeluaran Terbesar"}
            </h2>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {hasDrilldownFilter
                ? `Filter aktif: ${selectedDate ? `Tanggal ${selectedDate}` : "Semua Tanggal"} · ${selectedCategoryId ? "Kategori terpilih" : "Semua Kategori"}`
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
              className="nav-touch-item rounded border border-primary/50 bg-background px-2.5 py-1 text-xs font-medium text-primary hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
            >
              Reset Filter ×
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
              className="tabular-grid-cell flex items-center justify-between gap-3 px-4 py-3 text-xs"
            >
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-semibold text-foreground">
                    {tx.tx_type === "TRANSFER"
                      ? `${tx.account_name} → ${tx.to_account_name ?? "-"}`
                      : (tx.category_name ?? "Tanpa Kategori")}
                  </span>
                  <span className="shrink-0 rounded border border-border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {tx.account_name}
                  </span>
                </div>
                <p className="truncate text-[11px] leading-normal text-muted-foreground">
                  {tx.tx_date}
                  {tx.note ? ` · ${tx.note}` : ""}
                </p>
              </div>
              <span className="shrink-0 font-mono text-xs font-semibold tabular-nums tracking-tight text-rose-500 sm:text-sm">
                {formatSignedRupiah(tx.amount, tx.tx_type)}
              </span>
            </div>
          ))
        )}
      </div>

      {/* Bottom Grid: Account Reconciliation & P2P Device Contribution */}
      <div className="grid grid-cols-1 border-t border-border lg:grid-cols-12 lg:gap-px lg:bg-border">
        {/* Account Reconciliation Statement (8 cols) */}
        <div
          data-testid="account-reconciliation-table"
          className="tabular-grid-container flex flex-col lg:col-span-8"
        >
          <div className="tabular-grid-cell space-y-0.5 px-4 py-3">
            <h2 className="text-xs font-semibold text-foreground sm:text-sm">
              Mutasi Saldo Rekening
            </h2>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Posisi saldo awal, arus masuk & keluar, hingga saldo akhir bulan
            </p>
          </div>

          <div className="tabular-grid-cell hidden grid-cols-12 items-center bg-muted/40 px-4 py-2 text-[11px] font-medium text-muted-foreground md:grid">
            <div className="col-span-3">Nama Rekening</div>
            <div className="col-span-2 text-right">Saldo Awal</div>
            <div className="col-span-2 text-right">Total Masuk</div>
            <div className="col-span-2 text-right">Total Keluar</div>
            <div className="col-span-3 text-right">Saldo Akhir</div>
          </div>

          {report.account_reconciliation.length === 0 ? (
            <div className="tabular-grid-cell p-6 text-center text-xs text-muted-foreground">
              Belum ada akun terdaftar.
            </div>
          ) : (
            report.account_reconciliation.map((acc) => (
              <div
                key={acc.account_id}
                className="tabular-grid-cell grid grid-cols-1 items-center gap-1.5 px-4 py-3 text-xs md:grid-cols-12 md:gap-2"
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

                <div className="flex items-center justify-between font-mono text-xs tabular-nums tracking-tight text-emerald-500 md:col-span-2 md:block md:text-right">
                  <span className="font-sans text-[11px] text-muted-foreground md:hidden">
                    Total Masuk
                  </span>
                  <span>+{formatRupiah(acc.month_inflow)}</span>
                </div>

                <div className="flex items-center justify-between font-mono text-xs tabular-nums tracking-tight text-rose-500 md:col-span-2 md:block md:text-right">
                  <span className="font-sans text-[11px] text-muted-foreground md:hidden">
                    Total Keluar
                  </span>
                  <span>−{formatRupiah(acc.month_outflow)}</span>
                </div>

                <div className="flex items-center justify-between border-t border-border/60 pt-1.5 font-mono text-xs font-semibold tabular-nums tracking-tight text-foreground md:col-span-3 md:block md:border-t-0 md:pt-0 md:text-right">
                  <span className="font-sans text-[11px] font-medium text-foreground md:hidden">
                    Saldo Akhir
                  </span>
                  <span>{formatRupiah(acc.closing_balance)}</span>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Multi-Device P2P Audit Breakdown (4 cols) */}
        <div className="tabular-grid-container flex flex-col border-t border-border lg:col-span-4 lg:border-t-0">
          <div className="tabular-grid-cell space-y-0.5 px-4 py-3">
            <h2 className="text-xs font-semibold text-foreground sm:text-sm">
              Kontribusi Perangkat
            </h2>
            <p className="text-xs leading-relaxed text-muted-foreground">
              Ringkasan pencatatan dari perangkat yang terhubung
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
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-semibold text-foreground">
                    Perangkat {dev.device_id}
                  </span>
                  <span className="shrink-0 font-mono text-[11px] font-medium text-primary">
                    {dev.tx_count} transaksi ({(dev.share_bps / 100).toFixed(0)}%)
                  </span>
                </div>
                <div className="flex items-center justify-between font-mono text-xs tabular-nums tracking-tight">
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
