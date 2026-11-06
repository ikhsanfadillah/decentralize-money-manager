import * as React from "react";
import { Link } from "@tanstack/react-router";
import {
  ChevronRight,
  Laptop,
  Pencil,
  PieChart,
  RefreshCw,
  ShieldCheck,
  Tags,
  Wallet,
  X,
} from "lucide-react";
import { useBookFinance } from "../../hooks/useBookFinance";
import { currentYearMonth, formatRupiah } from "../../lib/utils";
import { pushToast } from "../../lib/toast";

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
    deviceIdentityQuery,
    setDeviceNameMutation,
  } = useBookFinance({ bookId, budgetMonth: currentMonth });

  const [isEditModalOpen, setIsEditModalOpen] = React.useState(false);
  const [deviceNameInput, setDeviceNameInput] = React.useState("");

  const activeAccounts = (accountsQuery.data ?? []).filter(
    (a) => !a.merged_into_id
  );
  const totalBalance = (balancesQuery.data ?? []).reduce(
    (acc, b) => acc + b.current_balance,
    0
  );
  const categories = categoriesQuery.data ?? [];
  const budgets = budgetProgressQuery.data ?? [];
  const overBudgetCount = budgets.filter((b) => b.status === "OVER").length;

  const handleOpenEditModal = () => {
    setDeviceNameInput(deviceIdentityQuery.data?.device_name ?? "");
    setIsEditModalOpen(true);
  };

  const handleSaveDeviceName = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = deviceNameInput.trim();
    if (!trimmed) {
      pushToast("Nama perangkat tidak boleh kosong", { variant: "error" });
      return;
    }
    try {
      await setDeviceNameMutation.mutateAsync(trimmed);
      pushToast("Nama perangkat berhasil diperbarui", { variant: "success" });
      setIsEditModalOpen(false);
    } catch (err: unknown) {
      pushToast(
        err instanceof Error ? err.message : "Gagal menyimpan nama perangkat",
        { variant: "error" }
      );
    }
  };

  return (
    <div className="w-full">
      {/* Header Pengaturan */}
      <div className="tabular-grid-container grid grid-cols-1">
        <div className="tabular-grid-cell px-3 py-2.5">
          <h1 className="text-xs font-semibold tracking-tight text-foreground sm:text-sm">
            Pengaturan
          </h1>
        </div>
      </div>

      {/* Identitas Perangkat */}
      <div className="tabular-grid-container grid grid-cols-1">
        <div className="tabular-grid-cell flex items-center justify-between gap-3 px-3 py-2.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-border bg-background text-primary">
              <Laptop className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <span
                  data-testid="local-device-name"
                  className="truncate text-xs font-semibold text-foreground sm:text-sm"
                >
                  {deviceIdentityQuery.data?.device_name || "Memuat..."}
                </span>
                <span className="shrink-0 rounded bg-emerald-500/10 px-1.5 py-0.2 text-[9px] font-semibold text-emerald-600 dark:text-emerald-400">
                  Perangkat Ini
                </span>
              </div>
              <p className="font-mono text-[10px] text-muted-foreground">
                ID: {deviceIdentityQuery.data?.device_id || "..."}
              </p>
            </div>
          </div>
          <button
            type="button"
            data-testid="btn-edit-device-name"
            onClick={handleOpenEditModal}
            className="nav-touch-item inline-flex shrink-0 items-center gap-1.5 rounded border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
          >
            <Pencil className="h-3 w-3 text-muted-foreground" />
            <span>Ubah</span>
          </button>
        </div>
      </div>

      {/* Modal Edit Device Name */}
      {isEditModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-device-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs animate-fade-in"
        >
          <div className="w-full max-w-sm rounded-lg border border-border bg-card p-4 shadow-xl">
            <div className="flex items-center justify-between pb-2 border-b border-border">
              <h3
                id="edit-device-modal-title"
                className="text-xs font-semibold text-foreground sm:text-sm flex items-center gap-1.5"
              >
                <Laptop className="h-4 w-4 text-primary" />
                <span>Ubah Nama Perangkat Ini</span>
              </h3>
              <button
                type="button"
                onClick={() => setIsEditModalOpen(false)}
                className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveDeviceName} className="mt-3 space-y-3">
              <div>
                <label
                  htmlFor="input-device-name"
                  className="block text-[11px] font-medium text-muted-foreground mb-1"
                >
                  Nama Label Perangkat
                </label>
                <input
                  id="input-device-name"
                  type="text"
                  value={deviceNameInput}
                  onChange={(e) => setDeviceNameInput(e.target.value)}
                  placeholder="Contoh: Laptop Kerja, HP Budi"
                  maxLength={64}
                  autoFocus
                  className="w-full rounded border border-border bg-background px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/60 focus:border-primary focus:outline-hidden"
                />
                <p className="mt-1 text-[10px] text-muted-foreground">
                  ID teknis ({deviceIdentityQuery.data?.device_id}) tetap unik dan tidak berubah.
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-border">
                <button
                  type="button"
                  onClick={() => setIsEditModalOpen(false)}
                  className="rounded border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={setDeviceNameMutation.isPending}
                  className="rounded bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
                >
                  {setDeviceNameMutation.isPending ? "Menyimpan..." : "Simpan"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Navigasi Pengaturan */}
      <div className="tabular-grid-container grid grid-cols-1">
        {/* 1. Accounts */}
        <Link
          to="/books/$bookId/accounts"
          params={{ bookId }}
          className="tabular-grid-cell nav-touch-item group flex items-center justify-between gap-3 px-3 py-3 text-left transition-colors hover:bg-muted/30 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
        >
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-border bg-background text-primary">
              <Wallet className="h-4 w-4" strokeWidth={2.2} />
            </div>
            <span className="truncate text-xs font-semibold text-foreground sm:text-sm">
              Accounts
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="font-mono text-xs font-medium tabular-nums text-foreground">
              {formatRupiah(totalBalance)}
            </span>
            <span className="rounded border border-primary/40 bg-primary/10 px-1.5 py-0.2 font-mono text-[10px] font-semibold text-primary">
              {activeAccounts.length} Akun
            </span>
            <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
          </div>
        </Link>

        {/* 2. Categories */}
        <Link
          to="/books/$bookId/categories"
          params={{ bookId }}
          className="tabular-grid-cell nav-touch-item group flex items-center justify-between gap-3 px-3 py-3 text-left transition-colors hover:bg-muted/30 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
        >
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-border bg-background text-primary">
              <Tags className="h-4 w-4" strokeWidth={2.2} />
            </div>
            <span className="truncate text-xs font-semibold text-foreground sm:text-sm">
              Categories
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="rounded border border-border bg-background px-1.5 py-0.2 font-mono text-[10px] font-semibold text-foreground">
              {categories.length} Kategori
            </span>
            <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
          </div>
        </Link>

        {/* 3. Budgets */}
        <Link
          to="/books/$bookId/budgets"
          params={{ bookId }}
          className="tabular-grid-cell nav-touch-item group flex items-center justify-between gap-3 px-3 py-3 text-left transition-colors hover:bg-muted/30 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
        >
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-border bg-background text-primary">
              <PieChart className="h-4 w-4" strokeWidth={2.2} />
            </div>
            <span className="truncate text-xs font-semibold text-foreground sm:text-sm">
              Budgets
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {overBudgetCount > 0 ? (
              <span className="rounded bg-rose-500/10 px-1.5 py-0.2 font-mono text-[10px] font-semibold text-rose-600 dark:text-rose-400">
                {overBudgetCount} Over
              </span>
            ) : (
              <span className="rounded border border-border bg-background px-1.5 py-0.2 font-mono text-[10px] font-semibold text-foreground">
                {budgets.length} Target
              </span>
            )}
            <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
          </div>
        </Link>

        {/* 4. Syncronization */}
        <Link
          to="/books/$bookId/sync"
          params={{ bookId }}
          data-testid="settings-cta-sync"
          className="tabular-grid-cell nav-touch-item group flex items-center justify-between gap-3 px-3 py-3 text-left transition-colors hover:bg-muted/30 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
        >
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-border bg-background text-primary">
              <RefreshCw className="h-4 w-4" strokeWidth={2.2} />
            </div>
            <span className="truncate text-xs font-semibold text-foreground sm:text-sm">
              Syncronization
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="rounded border border-border bg-background px-1.5 py-0.2 font-mono text-[10px] text-muted-foreground">
              P2P
            </span>
            <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
          </div>
        </Link>

        {/* 5. Cadangan Data Terenkripsi */}
        <Link
          to="/books/$bookId/backup"
          params={{ bookId }}
          data-testid="settings-cta-backup"
          className="tabular-grid-cell nav-touch-item group flex items-center justify-between gap-3 px-3 py-3 text-left transition-colors hover:bg-muted/30 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
        >
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded border border-border bg-background text-primary">
              <ShieldCheck className="h-4 w-4" strokeWidth={2.2} />
            </div>
            <span className="truncate text-xs font-semibold text-foreground sm:text-sm">
              Backup
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
          </div>
        </Link>
      </div>
    </div>
  );
};
