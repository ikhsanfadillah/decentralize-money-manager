import * as React from "react";
import { Link } from "@tanstack/react-router";
import { motion, useReducedMotion } from "motion/react";
import {
  AlertTriangle,
  ChevronRight,
  Eye,
  EyeOff,
  Info,
  MinusCircle,
  PlusCircle,
  Target,
  TrendingDown,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { useBookFinance } from "../../hooks/useBookFinance";
import { useSmoothReady } from "../../hooks/useSmoothReady";
import {
  currentYearMonth,
  formatAccountTypeLabel,
  formatCompactRupiah,
  formatMonthLabel,
  formatPercent,
  formatRupiah,
  formatSignedRupiah,
} from "../../lib/utils";
import { formatDateReadable } from "../../lib/date";
import { useUiStore } from "../../stores/ui-store";
import { BudgetProgressBar } from "../budgets/BudgetProgressBar";
import { EmptyStateIllustration } from "../ui/EmptyStateIllustration";

export interface DashboardPageProps {
  bookId: string;
}

export const DashboardPage: React.FC<DashboardPageProps> = ({ bookId }) => {
  const currentMonth = React.useMemo(() => currentYearMonth(), []);

  const isBalanceHidden = useUiStore((s) => s.isBalanceHidden);
  const toggleBalanceHidden = useUiStore((s) => s.toggleBalanceHidden);

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

  const shouldReduceMotion = useReducedMotion();
  const isInitialLoading =
    balancesQuery.isPending ||
    summaryQuery.isPending ||
    budgetProgressQuery.isPending ||
    transactionsQuery.isPending;
  const { isReady, showSkeleton, didWaitForData } =
    useSmoothReady(isInitialLoading);

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

  // Top 3 budgets sorted by highest percentage usage
  const top3Budgets = React.useMemo(() => {
    return [...allBudgets].sort((a, b) => b.pct - a.pct).slice(0, 3);
  }, [allBudgets]);

  // Hero Segmented Meter prioritizes "Total Pengeluaran" (category_id === null), falling back to highest pct
  const heroBudget = React.useMemo(() => {
    const totalBudget = allBudgets.find((b) => b.category_id === null);
    return totalBudget ?? top3Budgets[0] ?? null;
  }, [allBudgets, top3Budgets]);

  const overBudgetCount = React.useMemo(
    () => allBudgets.filter((b) => b.status === "OVER").length,
    [allBudgets]
  );
  const warningBudgetCount = React.useMemo(
    () => allBudgets.filter((b) => b.status === "WARNING").length,
    [allBudgets]
  );

  const netRatioPct = React.useMemo(() => {
    if (currentMonthSummary.income <= 0) return null;
    return (currentMonthSummary.net / currentMonthSummary.income) * 100;
  }, [currentMonthSummary.income, currentMonthSummary.net]);

  const maskMoney = (formatted: string) =>
    isBalanceHidden ? "Rp ••••••••" : formatted;

  const insightCardMeta = React.useMemo(() => {
    if (overBudgetCount > 0 || warningBudgetCount > 0) {
      return {
        isAlert: true,
        title:
          overBudgetCount > 0
            ? "Ada anggaran yang melewati batas"
            : "Anggaran mendekati batas bulanan",
        body:
          overBudgetCount > 0
            ? `${overBudgetCount} pos anggaran sudah melampaui target bulan ini. Tinjau kembali pengeluaranmu agar arus kas tetap nyaman.`
            : `${warningBudgetCount} pos anggaran sudah melewati ambang peringatan. Kamu masih punya ruang untuk mengatur sisa belanja bulan ini.`,
      };
    }
    if (currentMonthSummary.net < 0) {
      return {
        isAlert: false,
        title: "Pengeluaran lebih besar dari pemasukan",
        body: "Saldo bersih bulan ini sedang minus. Kondisi ini wajar saat ada belanja besar di awal bulan—pantau pos terbesar di menu Laporan.",
      };
    }
    if (transactionsQuery.isSuccess && recentTransactions.length === 0) {
      return {
        isAlert: false,
        title: "Yuk, catat transaksi pertamamu",
        body: "Tekan tombol + di bawah untuk mencatat pemasukan atau pengeluaran hari ini agar kondisi keuangan bulan ini langsung terpantau.",
      };
    }
    if (budgetProgressQuery.isSuccess && allBudgets.length === 0) {
      return {
        isAlert: false,
        title: "Atur batas belanja biar lebih tenang",
        body: "Pasang target pengeluaran di menu Anggaran supaya kamu mendapat pengingat otomatis sebelum belanja bulanan melewati batas.",
      };
    }
    if (currentMonthSummary.net > 0) {
      return {
        isAlert: false,
        title: "Keuangan bulan ini dalam kondisi sehat",
        body: "Pemasukanmu masih lebih besar dari pengeluaran. Cek rincian kategori di menu Laporan untuk melihat pos mana yang paling hemat.",
      };
    }
    return {
      isAlert: false,
      title: "Catatanmu hanya tersimpan di perangkat ini",
      body: "Data keuanganmu tidak dikirim atau disimpan di server luar. Jika ingin mencatat bersama dari HP atau laptop lain, cukup sambungkan langsung lewat menu Sinkronisasi.",
    };
  }, [
    overBudgetCount,
    warningBudgetCount,
    currentMonthSummary.net,
    transactionsQuery.isSuccess,
    recentTransactions.length,
    budgetProgressQuery.isSuccess,
    allBudgets.length,
  ]);

  if (!isReady) {
    if (!showSkeleton) {
      return <div className="w-full min-h-[50vh]" aria-busy="true" />;
    }
    return (
      <div
        className="animate-page-in w-full space-y-5"
        aria-label="Memuat ringkasan buku"
        aria-busy="true"
      >
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12 lg:items-start">
          <div className="space-y-5 lg:col-span-7">
            <div className="space-y-3 px-1 pt-1 animate-pulse">
              <div className="h-4 w-36 rounded-full bg-muted" />
              <div className="h-10 w-56 rounded-full bg-muted" />
              <div className="h-4 w-44 rounded-full bg-muted/70" />
            </div>
            <div className="glass-card h-44 animate-pulse p-5" />
            <div className="contrast-card h-24 animate-pulse p-5" />
          </div>
          <div className="space-y-5 lg:col-span-5">
            <div className="glass-card h-56 animate-pulse p-5" />
            <div className="glass-card h-64 animate-pulse p-5" />
          </div>
        </div>
      </div>
    );
  }

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
      className="w-full space-y-5"
    >
      {/* Responsive Bento Glass Grid: Mobile Single Column, Desktop 12-Col Bento */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12 lg:items-start">
        {/* LEFT COLUMN (Hero Focus, Segmented Budget Target, Insight Card) */}
        <div className="space-y-5 lg:col-span-7">
          {/* 2. Hero Wealth / Net Balance Section */}
          <section className="px-1 pt-1">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-muted-foreground sm:text-sm">
                  Total saldo saat ini
                </span>
                <button
                  type="button"
                  data-testid="dashboard-privacy-toggle"
                  onClick={toggleBalanceHidden}
                  aria-label={
                    isBalanceHidden ? "Tampilkan saldo" : "Sembunyikan saldo"
                  }
                  title={
                    isBalanceHidden ? "Tampilkan nominal" : "Sembunyikan nominal"
                  }
                  className="nav-touch-item inline-flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
                >
                  {isBalanceHidden ? (
                    <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
                  ) : (
                    <Eye className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                </button>
              </div>

              <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-[11px] font-medium text-foreground backdrop-blur-sm">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                <span>{formatMonthLabel(currentMonth)}</span>
              </span>
            </div>

            <div className="mt-2">
              <p
                data-testid="dashboard-total-balance"
                className="truncate text-[36px] font-extrabold leading-none tracking-tight text-foreground tabular-nums sm:text-[44px]"
              >
                {maskMoney(formatRupiah(totalBalance))}
              </p>
            </div>

            <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs font-semibold tabular-nums sm:text-sm">
              {currentMonthSummary.net >= 0 ? (
                <PlusCircle
                  className="h-4 w-4 shrink-0 text-emerald-500 dark:text-emerald-400"
                  aria-hidden="true"
                />
              ) : (
                <MinusCircle
                  className="h-4 w-4 shrink-0 text-rose-500 dark:text-rose-400"
                  aria-hidden="true"
                />
              )}
              <span
                className={
                  currentMonthSummary.net >= 0
                    ? "text-emerald-600 dark:text-emerald-300"
                    : "text-foreground"
                }
              >
                {isBalanceHidden
                  ? "•••••• bulan ini"
                  : `${formatSignedRupiah(
                      currentMonthSummary.net,
                      currentMonthSummary.net >= 0 ? "INCOME" : "EXPENSE"
                    )}${
                      netRatioPct !== null
                        ? ` (${formatPercent(Math.abs(netRatioPct), 1)})`
                        : ""
                    }`}
              </span>
              <span className="font-normal text-muted-foreground">
                · arus kas bulan ini
              </span>
            </div>
          </section>

          {/* 3. Segmented Target Progress (24 Vertical Bars) */}
          <section className="space-y-2.5 px-1 pt-1">
            {heroBudget ? (
              <>
                <div className="flex items-baseline justify-between gap-3">
                  <Link
                    to="/books/$bookId/budgets"
                    params={{ bookId }}
                    className="truncate text-xs font-semibold text-foreground hover:underline sm:text-sm"
                  >
                    {heroBudget.category_id === null
                      ? "Target Pengeluaran"
                      : `Target ${heroBudget.category_name}`}{" "}
                    <span className="font-normal text-muted-foreground">
                      · {formatMonthLabel(currentMonth)}
                    </span>
                  </Link>
                  <span className="shrink-0 text-lg font-extrabold tracking-tight text-foreground tabular-nums sm:text-xl">
                    {heroBudget.pct}%
                  </span>
                </div>

                <BudgetProgressBar
                  pct={heroBudget.pct}
                  status={heroBudget.status}
                  alertThresholdPct={heroBudget.alert_threshold_pct}
                  variant="segmented"
                  tone="hero"
                  showStatusLabel={false}
                />

                <div className="flex items-center justify-between gap-2 text-[11px] font-medium text-muted-foreground tabular-nums sm:text-xs">
                  <span>
                    {maskMoney(formatRupiah(heroBudget.spent))} terpakai
                  </span>
                  <span>
                    {heroBudget.remaining >= 0
                      ? `${maskMoney(formatRupiah(heroBudget.remaining))} tersisa`
                      : `Lebih ${maskMoney(
                          formatRupiah(Math.abs(heroBudget.remaining))
                        )}`}
                  </span>
                </div>
              </>
            ) : (
              <div className="glass-card flex items-center justify-between gap-3 p-4">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted text-primary">
                    <Target className="h-5 w-5" aria-hidden="true" />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold text-foreground sm:text-sm">
                      Belum ada target anggaran bulan ini
                    </p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      Atur batas pengeluaran untuk pantau progres harianmu.
                    </p>
                  </div>
                </div>
                <Link
                  to="/books/$bookId/budgets"
                  params={{ bookId }}
                  className="nav-touch-item shrink-0 rounded-full bg-cta-surface px-3.5 py-1.5 text-xs font-semibold text-cta-foreground hover:opacity-90"
                >
                  Atur →
                </Link>
              </div>
            )}
          </section>

          {/* 4. Glass Summary Card — Rekening & Dompet (Hero Card Pattern) */}
          <section className="glass-card p-4 sm:p-5">
            <Link
              to="/books/$bookId/accounts"
              params={{ bookId }}
              className="group flex items-center justify-between gap-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <div className="flex min-w-0 items-center gap-3.5">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-cta-surface text-cta-foreground">
                  <Wallet className="h-5 w-5" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <h2 className="truncate text-sm font-bold text-foreground sm:text-base">
                    Rekening & Dompet
                  </h2>
                  <p className="truncate text-xs text-muted-foreground">
                    {balances.length} akun · {recentTransactions.length} aktivitas
                    terbaru
                  </p>
                </div>
              </div>
              <ChevronRight
                className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground"
                aria-hidden="true"
              />
            </Link>

            <div className="my-4 h-px w-full bg-border" />

            {/* 2-Column Monthly Flow Summary */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs font-medium text-muted-foreground">
                  Pemasukan
                </p>
                <p
                  title={formatRupiah(currentMonthSummary.income)}
                  className="mt-1 truncate text-lg font-bold tracking-tight text-foreground tabular-nums sm:text-xl"
                >
                  {maskMoney(formatCompactRupiah(currentMonthSummary.income))}
                </p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground">
                  Pengeluaran
                </p>
                <p
                  title={formatRupiah(currentMonthSummary.expense)}
                  className="mt-1 truncate text-lg font-bold tracking-tight text-foreground tabular-nums sm:text-xl"
                >
                  {currentMonthSummary.expense > 0 && !isBalanceHidden
                    ? `−${formatCompactRupiah(currentMonthSummary.expense)}`
                    : maskMoney(formatCompactRupiah(currentMonthSummary.expense))}
                </p>
              </div>
            </div>

            {balances.length > 0 && (
              <div className="mt-4 space-y-2 border-t border-border pt-3.5">
                {balances.slice(0, 4).map((acc) => (
                  <div
                    key={acc.account_id}
                    className="flex items-center justify-between gap-2 text-xs"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-medium text-foreground">
                        {acc.name}
                      </span>
                      <span className="shrink-0 rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                        {formatAccountTypeLabel(acc.account_type)}
                      </span>
                    </div>
                    <span className="shrink-0 font-mono font-semibold tabular-nums text-foreground">
                      {maskMoney(formatRupiah(acc.current_balance))}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* 5. Dark Contrast Educational / Contextual Insight Card */}
          <section className="contrast-card flex items-start gap-3.5 p-4 sm:p-5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-zinc-950">
              {insightCardMeta.isAlert ? (
                <AlertTriangle className="h-5 w-5" aria-hidden="true" />
              ) : (
                <Info className="h-5 w-5" aria-hidden="true" />
              )}
            </div>
            <div className="min-w-0 space-y-1">
              <h3 className="text-sm font-bold text-white">
                {insightCardMeta.title}
              </h3>
              <p className="text-xs leading-relaxed text-white/75">
                {insightCardMeta.body}
              </p>
            </div>
          </section>
        </div>

        {/* RIGHT COLUMN (Top 3 Budgets & Recent Transactions) */}
        <div className="space-y-5 lg:col-span-5">
          {/* Pantauan Anggaran (Top 3) */}
          <section
            data-testid="dashboard-budget-card"
            className="glass-card p-4 sm:p-5"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <h2 className="truncate text-sm font-bold text-foreground">
                  Pantauan Anggaran
                </h2>
                <p className="truncate text-[11px] text-muted-foreground">
                  Pos dengan pemakaian tertinggi · {formatMonthLabel(currentMonth)}
                </p>
              </div>
              <Link
                to="/books/$bookId/budgets"
                params={{ bookId }}
                className="nav-touch-item shrink-0 rounded-full border border-border bg-muted px-3 py-1 text-[11px] font-semibold text-foreground hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
              >
                Semua →
              </Link>
            </div>

            {top3Budgets.length === 0 ? (
              <div className="mt-4 flex flex-col items-center justify-center rounded-2xl border border-border/60 bg-muted/40 p-5 text-center">
                <EmptyStateIllustration variant="monthly-budget" />
                <p className="text-xs font-semibold text-foreground">
                  Belum ada anggaran bulanan
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Tetapkan batas pengeluaran bulanan untuk memantau realisasi.
                </p>
                <Link
                  to="/books/$bookId/budgets"
                  params={{ bookId }}
                  className="nav-touch-item mt-3 rounded-full bg-cta-surface px-4 py-1.5 text-xs font-semibold text-cta-foreground hover:opacity-90"
                >
                  Atur Anggaran
                </Link>
              </div>
            ) : (
              <div className="mt-4 space-y-4">
                {top3Budgets.map((b) => (
                  <div
                    key={b.id}
                    className="space-y-2 border-t border-border/70 pt-3.5 first:border-t-0 first:pt-0"
                  >
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="min-w-0 truncate font-semibold text-foreground">
                        {b.category_id === null
                          ? "Total Pengeluaran"
                          : b.category_name}
                      </span>
                      <span className="shrink-0 font-mono text-[11px] tabular-nums text-foreground">
                        {maskMoney(formatRupiah(b.spent))}{" "}
                        <span className="text-muted-foreground">
                          / {maskMoney(formatRupiah(b.amount_limit))}
                        </span>
                      </span>
                    </div>
                    <BudgetProgressBar
                      pct={b.pct}
                      status={b.status}
                      alertThresholdPct={b.alert_threshold_pct}
                      variant="segmented"
                    />
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Catatan Transaksi Terbaru */}
          <section className="glass-card p-4 sm:p-5">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <h2 className="truncate text-sm font-bold text-foreground">
                  Transaksi Terbaru
                </h2>
                <p className="truncate text-[11px] text-muted-foreground">
                  6 aktivitas terakhir di buku ini
                </p>
              </div>
              <Link
                to="/books/$bookId/transactions"
                params={{ bookId }}
                className="nav-touch-item shrink-0 rounded-full border border-border bg-muted px-3 py-1 text-[11px] font-semibold text-foreground hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
              >
                Semua →
              </Link>
            </div>

            {recentTransactions.length === 0 ? (
              <div className="mt-4 flex flex-col items-center justify-center rounded-2xl border border-border/60 bg-muted/40 p-5 text-center text-xs text-muted-foreground">
                <EmptyStateIllustration variant="recent-transactions" />
                <span>Belum ada transaksi tercatat.</span>
              </div>
            ) : (
              <div className="mt-3 divide-y divide-border/70">
                {recentTransactions.map((tx) => (
                  <div
                    key={tx.id}
                    className="flex items-center justify-between gap-2.5 py-2.5 text-xs first:pt-1 last:pb-0"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        {tx.tx_type === "EXPENSE" ? (
                          <TrendingDown
                            className="h-3.5 w-3.5 shrink-0 text-rose-500 dark:text-rose-400"
                            aria-hidden="true"
                          />
                        ) : tx.tx_type === "INCOME" ? (
                          <TrendingUp
                            className="h-3.5 w-3.5 shrink-0 text-emerald-500 dark:text-emerald-400"
                            aria-hidden="true"
                          />
                        ) : null}
                        <span className="truncate font-semibold text-foreground">
                          {tx.tx_type === "TRANSFER"
                            ? `${tx.account_name} → ${tx.to_account_name ?? "-"}`
                            : tx.category_name ?? "Tanpa Kategori"}
                        </span>
                        {tx.link_id && (
                          <span className="shrink-0 rounded-full border border-primary/40 px-1.5 py-0.2 text-[9px] font-semibold text-primary">
                            Pindah Buku
                          </span>
                        )}
                      </div>
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                        <span title={tx.tx_date}>
                          {formatDateReadable(tx.tx_date)}
                        </span>{" "}
                        · {tx.account_name}
                        {tx.note ? ` · ${tx.note}` : ""}
                      </p>
                    </div>

                    <span
                      className={`shrink-0 font-mono text-xs font-semibold tabular-nums tracking-tight ${
                        tx.tx_type === "INCOME"
                          ? "text-emerald-600 dark:text-emerald-400"
                          : tx.tx_type === "EXPENSE"
                            ? "text-rose-600 dark:text-rose-400"
                            : "text-sky-600 dark:text-sky-400"
                      }`}
                    >
                      {isBalanceHidden
                        ? "Rp •••••"
                        : formatSignedRupiah(tx.amount, tx.tx_type)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </motion.div>
  );
};
