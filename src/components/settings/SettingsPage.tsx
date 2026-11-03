import * as React from "react";
import { Link } from "@tanstack/react-router";
import {
  ChevronRight,
  PieChart,
  RefreshCw,
  ShieldCheck,
  Tags,
  Wallet,
} from "lucide-react";
import { useBookFinance } from "../../hooks/useBookFinance";
import { currentYearMonth, formatRupiah } from "../../lib/utils";

export interface SettingsPageProps {
  bookId: string;
}

export const SettingsPage: React.FC<SettingsPageProps> = ({ bookId }) => {
  const currentMonth = React.useMemo(() => currentYearMonth(), []);
  const {
    accountsQuery,
    balancesQuery,
    categoriesQuery,
    budgetProgressQuery,
  } = useBookFinance({ bookId, budgetMonth: currentMonth });

  const activeAccounts = (accountsQuery.data ?? []).filter(
    (a) => !a.merged_into_id
  );
  const totalBalance = (balancesQuery.data ?? []).reduce(
    (acc, b) => acc + b.current_balance,
    0
  );
  const categories = categoriesQuery.data ?? [];
  const budgets = budgetProgressQuery.data ?? [];

  return (
    <div className="page-transition-wrapper animate-page-in w-full">
      {/* Settings Hub Header */}
      <div className="tabular-grid-container grid grid-cols-1">
        <div className="tabular-grid-cell px-3 py-2.5">
          <h1 className="text-xs font-semibold tracking-tight text-foreground sm:text-sm">
            Pusat Pengaturan & Konfigurasi Buku
          </h1>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Kelola akun keuangan, kategori transaksi, anggaran bulanan, serta
            sinkronisasi P2P dan cadangan terenkripsi.
          </p>
        </div>
      </div>

      {/* 5 Compact CTA Navigation Cards */}
      <div className="tabular-grid-container grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
        {/* 1. CTA to Accounts */}
        <Link
          to="/books/$bookId/accounts"
          params={{ bookId }}
          style={{ animationDelay: "0ms" }}
          className="tabular-grid-cell animate-card-up nav-touch-item group flex items-center justify-between gap-3 px-3 py-3 text-left transition-colors hover:bg-muted/30 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
        >
          <div className="flex min-w-0 flex-1 items-start gap-2.5">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded border border-border bg-background text-primary">
              <Wallet className="h-4 w-4" strokeWidth={2.2} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs font-semibold text-foreground sm:text-sm">
                  Manajemen Akun Keuangan
                </span>
                <span className="rounded border border-primary/40 bg-primary/10 px-1.5 py-0.2 font-mono text-[10px] font-semibold text-primary">
                  {activeAccounts.length} Akun
                </span>
              </div>
              <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                Rekening bank, kas tunai, e-wallet & penggabungan manual
              </p>
              <p className="mt-1 font-mono text-[11px] font-medium tabular-nums tracking-tight text-foreground">
                Total Saldo: {formatRupiah(totalBalance)}
              </p>
            </div>
          </div>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
        </Link>

        {/* 2. CTA to Categories */}
        <Link
          to="/books/$bookId/categories"
          params={{ bookId }}
          style={{ animationDelay: "40ms" }}
          className="tabular-grid-cell animate-card-up nav-touch-item group flex items-center justify-between gap-3 px-3 py-3 text-left transition-colors hover:bg-muted/30 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
        >
          <div className="flex min-w-0 flex-1 items-start gap-2.5">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded border border-border bg-background text-primary">
              <Tags className="h-4 w-4" strokeWidth={2.2} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs font-semibold text-foreground sm:text-sm">
                  Kategori Transaksi
                </span>
                <span className="rounded border border-border bg-background px-1.5 py-0.2 font-mono text-[10px] font-semibold text-foreground">
                  {categories.length} Kategori
                </span>
              </div>
              <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                Kelola pos pemasukan & pengeluaran Anda
              </p>
              <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                Pengeluaran:{" "}
                {categories.filter((c) => c.kind === "EXPENSE").length} ·
                Pemasukan:{" "}
                {categories.filter((c) => c.kind === "INCOME").length}
              </p>
            </div>
          </div>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
        </Link>

        {/* 3. CTA to Budgets */}
        <Link
          to="/books/$bookId/budgets"
          params={{ bookId }}
          style={{ animationDelay: "80ms" }}
          className="tabular-grid-cell animate-card-up nav-touch-item group flex items-center justify-between gap-3 px-3 py-3 text-left transition-colors hover:bg-muted/30 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
        >
          <div className="flex min-w-0 flex-1 items-start gap-2.5">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded border border-border bg-background text-primary">
              <PieChart className="h-4 w-4" strokeWidth={2.2} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs font-semibold text-foreground sm:text-sm">
                  Anggaran Bulanan
                </span>
                <span className="rounded border border-border bg-background px-1.5 py-0.2 font-mono text-[10px] font-semibold text-foreground">
                  {budgets.length} Target ({currentMonth})
                </span>
              </div>
              <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                Atur batas belanja per kategori agar keuangan terkontrol
              </p>
              <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                {budgets.filter((b) => b.status === "OVER").length > 0
                  ? `${budgets.filter((b) => b.status === "OVER").length} anggaran melebihi batas`
                  : "Seluruh anggaran terkendali"}
              </p>
            </div>
          </div>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
        </Link>

        {/* 4. CTA to P2P Sync */}
        <Link
          to="/books/$bookId/sync"
          params={{ bookId }}
          data-testid="settings-cta-sync"
          style={{ animationDelay: "120ms" }}
          className="tabular-grid-cell animate-card-up nav-touch-item group flex items-center justify-between gap-3 px-3 py-3 text-left transition-colors hover:bg-muted/30 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
        >
          <div className="flex min-w-0 flex-1 items-start gap-2.5">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded border border-border bg-background text-primary">
              <RefreshCw className="h-4 w-4" strokeWidth={2.2} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs font-semibold text-foreground sm:text-sm">
                  Sinkronisasi Antar-Perangkat
                </span>
              </div>
              <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                Hubungkan HP atau laptop lain secara privat & aman
              </p>
              <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                Stream persisten P2P end-to-end
              </p>
            </div>
          </div>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
        </Link>

        {/* 5. CTA to Encrypted Backup */}
        <Link
          to="/books/$bookId/backup"
          params={{ bookId }}
          data-testid="settings-cta-backup"
          style={{ animationDelay: "160ms" }}
          className="tabular-grid-cell animate-card-up nav-touch-item group flex items-center justify-between gap-3 px-3 py-3 text-left transition-colors hover:bg-muted/30 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary sm:col-span-2 lg:col-span-1"
        >
          <div className="flex min-w-0 flex-1 items-start gap-2.5">
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded border border-border bg-background text-primary">
              <ShieldCheck className="h-4 w-4" strokeWidth={2.2} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs font-semibold text-foreground sm:text-sm">
                  Cadangan Buku Terenkripsi
                </span>
              </div>
              <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                Simpan salinan cadangan aman ke dalam file terenkripsi
              </p>
              <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                Dilindungi kata sandi pribadi Anda
              </p>
            </div>
          </div>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
        </Link>
      </div>
    </div>
  );
};
