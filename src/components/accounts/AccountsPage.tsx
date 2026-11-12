import { Link, useNavigate } from "@tanstack/react-router";
import {
  AlertTriangle,
  ArrowUpRight,
  Banknote,
  Building2,
  ChevronRight,
  FileText,
  GitMerge, Plus,
  Smartphone,
  Trash2,
  TrendingDown,
  TrendingUp,
  X
} from "lucide-react";
import * as React from "react";
import { motion, useReducedMotion } from "motion/react";
import { useBookFinance } from "../../hooks/useBookFinance";
import { useSmoothReady } from "../../hooks/useSmoothReady";
import type { AccountType, AccountView } from "../../lib/tauri-api";
import { pushToast } from "../../lib/toast";
import { formatAccountTypeLabel, formatRupiah } from "../../lib/utils";
import { useUiStore } from "../../stores/ui-store";
import { DeleteTransactionIllustration } from "../transactions/TransactionTable";
import {
  ButtonSlideToConfirm,
  type SlideConfirmResult,
} from "../ui/ButtonSlideToConfirm";
import { CurrencyInput } from "../ui/currency-input";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "../ui/drawer";
import { Input } from "../ui/input";

export interface AccountsPageProps {
  bookId: string;
}

// Enterprise visual icon and label helper
const getAccountVisual = (type: AccountType) => {
  switch (type) {
    case "BANK":
      return {
        icon: Building2,
        label: "Bank",
      };
    case "EWALLET":
      return {
        icon: Smartphone,
        label: "E-Wallet",
      };
    case "CASH":
    default:
      return {
        icon: Banknote,
        label: "Tunai",
      };
  }
};

export const AccountsPage: React.FC<AccountsPageProps> = ({ bookId }) => {
  const navigate = useNavigate();
  const setActiveFilterDraft = useUiStore((s) => s.setActiveFilterDraft);

  const {
    accountsQuery,
    balancesQuery,
    upsertAccountMutation,
    deleteAccountMutation,
    mergeAccountsMutation,
  } = useBookFinance({ bookId });

  const [isAccountDrawerOpen, setIsAccountDrawerOpen] = React.useState(false);
  const [editingAccount, setEditingAccount] =
    React.useState<AccountView | null>(null);
  const [accountPendingDelete, setAccountPendingDelete] =
    React.useState<AccountView | null>(null);

  const [name, setName] = React.useState("");
  const [accountType, setAccountType] = React.useState<AccountType>("BANK");
  const [initialBalance, setInitialBalance] = React.useState<number>(0);

  const [mergeSourceId, setMergeSourceId] = React.useState<string>("");
  const [mergeTargetId, setMergeTargetId] = React.useState<string>("");
  const [isMergeModalOpen, setIsMergeModalOpen] = React.useState(false);

  const shouldReduceMotion = useReducedMotion();
  const { isReady, showSkeleton, didWaitForData } = useSmoothReady(
    accountsQuery.isPending || balancesQuery.isPending
  );

  const accounts = accountsQuery.data ?? [];
  const balances = balancesQuery.data ?? [];

  const activeRootAccounts = React.useMemo(
    () => accounts.filter((a) => !a.merged_into_id),
    [accounts]
  );

  const mergedAccounts = React.useMemo(
    () => accounts.filter((a) => Boolean(a.merged_into_id)),
    [accounts]
  );

  const balanceMap = React.useMemo(() => {
    const map = new Map<string, number>();
    for (const b of balances) {
      map.set(b.account_id, b.current_balance);
    }
    return map;
  }, [balances]);

  // Total balance computation across all active accounts
  const totalBalance = React.useMemo(() => {
    return activeRootAccounts.reduce((sum, acc) => {
      return sum + (balanceMap.get(acc.id) ?? acc.initial_balance);
    }, 0);
  }, [activeRootAccounts, balanceMap]);

  const editingAccountBalance = editingAccount
    ? (balanceMap.get(editingAccount.id) ?? editingAccount.initial_balance)
    : 0;

  const handleViewLedger = (acc: AccountView) => {
    setActiveFilterDraft((prev) => ({
      ...prev,
      account_id: acc.id,
      offset: 0,
    }));
    void navigate({
      to: "/books/$bookId/transactions",
      params: { bookId },
    });
  };

  const handleStartEdit = (acc: AccountView) => {
    setEditingAccount(acc);
    setName(acc.name);
    setAccountType(acc.account_type);
    setInitialBalance(acc.initial_balance);
    setIsAccountDrawerOpen(true);
  };

  const handleResetForm = () => {
    setEditingAccount(null);
    setName("");
    setAccountType("BANK");
    setInitialBalance(0);
  };

  const handleOpenCreateAccount = () => {
    handleResetForm();
    setIsAccountDrawerOpen(true);
  };

  const handleCloseAccountDrawer = () => {
    setIsAccountDrawerOpen(false);
    handleResetForm();
  };

  const handleSaveAccountDirect = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      pushToast("Nama akun tidak boleh kosong", { variant: "warning" });
      return;
    }

    try {
      await upsertAccountMutation.mutateAsync({
        id: editingAccount?.id ?? null,
        name: trimmed,
        account_type: accountType,
        initial_balance: initialBalance,
      });
      pushToast(
        editingAccount
          ? `Akun "${trimmed}" berhasil diperbarui`
          : `Akun "${trimmed}" berhasil ditambahkan`,
        { variant: "success" }
      );
      handleCloseAccountDrawer();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Gagal menyimpan akun";
      pushToast("Gagal menyimpan akun", { description: msg, variant: "error" });
    }
  };

  const handleConfirmDeleteAccount = async () => {
    if (!accountPendingDelete) return;

    try {
      await deleteAccountMutation.mutateAsync(accountPendingDelete.id);
      pushToast(`Akun "${accountPendingDelete.name}" berhasil dihapus`, {
        variant: "info",
      });
      setAccountPendingDelete(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Gagal menghapus akun";
      pushToast("Gagal menghapus akun", { description: msg, variant: "error" });
    }
  };

  const handleOpenMergeModal = () => {
    if (activeRootAccounts.length < 2) {
      pushToast("Minimal diperlukan 2 akun aktif untuk melakukan penggabungan", {
        variant: "warning",
      });
      return;
    }
    setMergeSourceId(activeRootAccounts[0]?.id ?? "");
    setMergeTargetId(activeRootAccounts[1]?.id ?? "");
    setIsMergeModalOpen(true);
  };

  const handleSlideConfirmMerge = async (): Promise<SlideConfirmResult> => {
    if (!mergeSourceId || !mergeTargetId) {
      pushToast("Pilih akun sumber dan akun tujuan", { variant: "warning" });
      return { ok: false, message: "Pilih akun sumber dan tujuan" };
    }
    if (mergeSourceId === mergeTargetId) {
      pushToast("Akun sumber dan akun tujuan tidak boleh sama", {
        variant: "error",
      });
      return { ok: false, message: "Akun sumber dan tujuan tidak boleh sama" };
    }

    try {
      await mergeAccountsMutation.mutateAsync({
        sourceId: mergeSourceId,
        targetId: mergeTargetId,
      });
      pushToast("Akun berhasil digabungkan", {
        variant: "success",
      });
      return { ok: true };
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Gagal menggabungkan akun";
      pushToast("Gagal menggabungkan akun", {
        description: msg,
        variant: "error",
      });
      return { ok: false, message: "Gagal Menggabungkan Akun" };
    }
  };

  if (!isReady) {
    if (!showSkeleton) {
      return <div className="w-full min-h-[45vh]" aria-busy="true" />;
    }
    return (
      <div
        className="animate-page-in w-full space-y-4"
        aria-label="Memuat rekening"
        aria-busy="true"
      >
        <div className="glass-card h-20 animate-pulse p-5" />
        <div className="glass-card h-48 animate-pulse p-5" />
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
      className="w-full space-y-4"
    >
      {/* 1. Glass Header & Total Balance Summary */}
      <div className="glass-card flex flex-wrap items-center justify-between gap-3 p-4 sm:p-5">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            to="/books/$bookId/settings"
            params={{ bookId }}
            aria-label="Kembali ke Pengaturan"
            className="nav-touch-item inline-flex h-8 shrink-0 items-center rounded-full border border-border bg-black/[0.04] dark:bg-white/[0.06] px-3 font-mono text-[11px] font-semibold text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
          >
            ← Pengaturan
          </Link>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-bold tracking-tight text-foreground sm:text-base">
              Rekening &amp; Dompet
            </h1>
            <p className="text-[11px] text-muted-foreground">
              {activeRootAccounts.length} akun aktif tercatat
            </p>
          </div>
        </div>

        <div className="text-right">
          <p className="text-[11px] text-muted-foreground">Total Saldo Akun</p>
          <p className="font-mono text-lg font-extrabold tabular-nums tracking-tight text-foreground sm:text-xl">
            {formatRupiah(totalBalance)}
          </p>
        </div>
      </div>

      {/* 2. Quick Actions Capsule Bar */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleOpenCreateAccount}
          className="nav-touch-item inline-flex flex-1 sm:flex-initial justify-center items-center gap-1.5 rounded-full bg-cta-surface px-4 py-2 text-xs font-semibold text-cta-foreground hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
        >
          <Plus className="h-3.5 w-3.5" />
          <span>Tambah Akun</span>
        </button>
        {activeRootAccounts.length >= 2 && (
          <button
            type="button"
            onClick={handleOpenMergeModal}
            className="nav-touch-item inline-flex items-center gap-1.5 rounded-full border border-border bg-card backdrop-blur-sm px-4 py-2 text-xs font-semibold text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
          >
            <GitMerge className="h-3.5 w-3.5 text-primary" />
            <span>Gabung Akun</span>
          </button>
        )}
      </div>

      {/* 3. Glass Card Account List */}
      <div className="glass-card overflow-hidden">
        {/* Desktop Table Header */}
        <div className="hidden grid-cols-12 items-center border-b border-border/70 bg-black/[0.02] dark:bg-white/[0.04] px-4 py-2 font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground md:grid">
          <div className="col-span-8">Nama Akun</div>
          <div className="col-span-4 text-right">Saldo</div>
        </div>

        <div className="divide-y divide-border/70">
          {activeRootAccounts.length === 0 ? (
            <div className="p-8 text-center text-xs text-muted-foreground">
              <p>Belum ada akun aktif di buku ini.</p>
              <button
                type="button"
                onClick={handleOpenCreateAccount}
                className="mt-3 nav-touch-item inline-flex items-center gap-1.5 rounded-full bg-cta-surface px-4 py-2 text-xs font-semibold text-cta-foreground hover:opacity-90"
              >
                <Plus className="h-3.5 w-3.5" />
                Tambah Akun Baru
              </button>
            </div>
          ) : (
            activeRootAccounts.map((acc) => {
              const currentBal =
                balanceMap.get(acc.id) ?? acc.initial_balance;
              const visual = getAccountVisual(acc.account_type);
              const IconComp = visual.icon;

              return (
                <div
                  key={acc.id}
                  data-testid={`account-row-${acc.id}`}
                  role="button"
                  tabIndex={0}
                  title={`Lihat mutasi transaksi ${acc.name}`}
                  aria-label={`Buka buku besar mutasi ${acc.name}`}
                  onClick={() => handleStartEdit(acc)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleStartEdit(acc);
                    }
                  }}
                  className="group nav-touch-item flex cursor-pointer items-center justify-between px-4 py-3.5 text-sm transition-colors hover:bg-white/[0.05] active:bg-white/[0.08] focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
                >
                  {/* Left: Rounded Icon Container + Name + Type Badge */}
                  <div className="flex min-w-0 flex-1 items-center gap-3 pr-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-black/[0.04] text-foreground dark:bg-white/[0.1] dark:text-foreground">
                      <IconComp className="h-4.5 w-4.5" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-semibold text-foreground text-xs sm:text-sm">
                          {acc.name}
                        </span>
                        <span className="shrink-0 rounded-full border border-border bg-black/[0.03] dark:bg-white/[0.06] px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                          {visual.label}
                        </span>
                      </div>
                      {acc.initial_balance !== 0 && (
                        <div className="mt-0.5 font-mono text-[10px] text-muted-foreground tabular-nums">
                          Saldo awal: {formatRupiah(acc.initial_balance)}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Right: Balance + Chevron */}
                  <div className="flex shrink-0 items-center gap-2">
                    <div className="text-right">
                      <div className="flex items-center justify-end gap-1 font-mono text-xs sm:text-sm font-bold tabular-nums tracking-tight text-foreground">
                        {currentBal > acc.initial_balance && (
                          <span title="Saldo bertambah dari saldo awal" className="inline-flex">
                            <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
                          </span>
                        )}
                        {currentBal < acc.initial_balance && (
                          <span title="Saldo berkurang dari saldo awal" className="inline-flex">
                            <TrendingDown className="h-3.5 w-3.5 text-rose-400" />
                          </span>
                        )}
                        <span className={currentBal < 0 ? "text-rose-500 dark:text-rose-400" : ""}>
                          {formatRupiah(currentBal)}
                        </span>
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* 4. Merged Accounts History Section (CRDT Contrast Note) */}
      {mergedAccounts.length > 0 && (
        <div className="contrast-card overflow-hidden">
          <div className="border-b border-white/10 px-4 py-2.5">
            <h2 className="font-mono text-[10px] font-semibold uppercase tracking-wider text-white/70">
              Rekening yang Digabungkan via CRDT ({mergedAccounts.length})
            </h2>
          </div>
          <div className="divide-y divide-white/10">
            {mergedAccounts.map((m) => (
              <div
                key={m.id}
                className="flex items-center justify-between px-4 py-2.5 text-xs"
              >
                <div className="min-w-0 flex items-center gap-2">
                  <span className="truncate font-medium text-white/70 line-through">
                    {m.name}
                  </span>
                  <span className="shrink-0 rounded-full bg-amber-500/20 px-2 py-0.5 font-mono text-[10px] font-semibold text-amber-300">
                    Tergabung
                  </span>
                </div>
                <span className="shrink-0 font-mono text-[10px] tabular-nums tracking-tight text-white/65">
                  Saldo awal: {formatRupiah(m.initial_balance)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 5. Detail & Form Drawer */}
      <Drawer
        open={isAccountDrawerOpen}
        onOpenChange={(open) => {
          if (!open) {
            handleCloseAccountDrawer();
          }
        }}
        shouldScaleBackground={false}
      >
        <DrawerContent className="p-0 data-[vaul-drawer-direction=bottom]:max-h-[90dvh] data-[vaul-drawer-direction=bottom]:w-full data-[vaul-drawer-direction=bottom]:sm:mx-auto sm:max-w-lg">
          <form onSubmit={handleSaveAccountDirect} className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {/* Header */}
            <div className="shrink-0 border-b border-border/70 py-3.5">
              <div className="flex items-center justify-between px-5">
                <div>
                  <DrawerTitle className="text-sm font-bold text-foreground">
                    {editingAccount
                      ? "Detail & Ubah Akun"
                      : "Tambah Akun Keuangan"}
                  </DrawerTitle>
                  <DrawerDescription className="text-xs text-muted-foreground">
                    {editingAccount
                      ? "Kelola informasi rekening atau kantong kas Anda"
                      : "Tentukan nama, jenis kantong, dan saldo awal Anda"}
                  </DrawerDescription>
                </div>
                <button
                  type="button"
                  onClick={handleCloseAccountDrawer}
                  aria-label="Tutup"
                  className="nav-touch-item inline-flex h-8 w-8 items-center justify-center rounded-full border border-border bg-black/[0.04] dark:bg-white/[0.06] hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              {editingAccount && (
                <div className="mt-3 px-5">
                  <button
                    type="button"
                    onClick={() => {
                      const target = editingAccount;
                      handleCloseAccountDrawer();
                      handleViewLedger(target);
                    }}
                    className="nav-touch-item flex w-full items-center justify-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 py-2 text-xs font-semibold text-primary hover:bg-primary/15 transition-colors"
                  >
                    <FileText className="h-3.5 w-3.5" />
                    <span>Lihat Mutasi Transaksi</span>
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>

            {/* Body */}
            <div className="flex-auto min-h-0 space-y-4 overflow-y-auto overscroll-contain px-5 py-4">
              {/* Financial & Ledger Summary for Existing Account */}
              {editingAccount && (
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between rounded-2xl border border-border/70 bg-black/[0.03] dark:bg-white/[0.04] px-3.5 py-2.5 text-xs">
                    <span className="text-muted-foreground font-medium">Saldo Saat Ini:</span>
                    <span
                      className={`font-mono text-sm font-bold tabular-nums ${
                        editingAccountBalance < 0
                          ? "text-rose-500 dark:text-rose-400"
                          : "text-foreground"
                      }`}
                    >
                      {formatRupiah(editingAccountBalance)}
                    </span>
                  </div>

                  {editingAccountBalance < 0 && (
                    <div className="flex items-start gap-2 rounded-2xl border border-rose-500/30 bg-rose-500/10 p-3 text-[11px] text-rose-700 dark:text-rose-300">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-400" />
                      <div className="space-y-0.5">
                        <p className="font-semibold">Catatan Akuntansi: Saldo Negatif</p>
                        <p className="leading-tight opacity-90">
                          Total pengeluaran melebihi saldo awal & pemasukan. Telusuri mutasi transaksi atau perbarui saldo awal di bawah.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Account Name */}
              <div className="space-y-1.5">
                <label
                  htmlFor="account-name-input"
                  className="text-xs font-medium text-foreground"
                >
                  Nama Akun / Rekening
                </label>
                <Input
                  id="account-name-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Contoh: BCA Utama, Kas Dompet, GoPay..."
                  autoFocus
                />
              </div>

              {/* Account Type: Segmented Buttons */}
              <div className="space-y-1.5">
                <span className="text-xs font-medium text-foreground">
                  Jenis Akun
                </span>
                <div className="grid grid-cols-3 gap-2">
                  {(
                    [
                      { type: "CASH", label: "Kas Tunai", icon: Banknote },
                      { type: "BANK", label: "Bank", icon: Building2 },
                      { type: "EWALLET", label: "E-Wallet", icon: Smartphone },
                    ] as const
                  ).map((item) => {
                    const isSelected = accountType === item.type;
                    const ItemIcon = item.icon;
                    return (
                      <button
                        key={item.type}
                        type="button"
                        onClick={() => setAccountType(item.type)}
                        className={`nav-touch-item flex items-center justify-center gap-1.5 rounded-xl border py-2 px-2.5 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary ${
                          isSelected
                            ? "border-primary bg-primary/15 font-semibold text-primary"
                            : "border-border bg-black/[0.03] dark:bg-white/[0.05] text-muted-foreground hover:bg-muted hover:text-foreground"
                        }`}
                      >
                        <ItemIcon className="h-3.5 w-3.5" />
                        <span>{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Initial Balance */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label
                    htmlFor="account-initial-balance"
                    className="text-xs font-medium text-foreground"
                  >
                    Saldo Awal (Rp)
                  </label>
                  <span className="text-[10px] text-muted-foreground">
                    Saldo saat akun ini pertama dicatat
                  </span>
                </div>
                <CurrencyInput
                  id="account-initial-balance"
                  value={initialBalance}
                  onValueChange={(val) => setInitialBalance(val ?? 0)}
                />
              </div>

              {/* Destructive Action Trigger: Buka Confirm Drawer */}
              {editingAccount && (
                <div className="pt-2 border-t border-border/60">
                  <button
                    type="button"
                    onClick={() => {
                      const target = editingAccount;
                      handleCloseAccountDrawer();
                      setAccountPendingDelete(target);
                    }}
                    className="nav-touch-item flex w-full items-center justify-center gap-1.5 rounded-full border border-rose-500/25 bg-rose-500/10 py-2.5 text-xs font-medium text-rose-600 hover:bg-rose-500/15 active:scale-[0.99] dark:text-rose-400 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>Hapus Akun Ini</span>
                  </button>
                </div>
              )}
            </div>

            {/* Direct Save Action Buttons */}
            <div className="mt-auto flex shrink-0 items-center justify-end gap-2 border-t border-border/70 px-5 py-3">
              <button
                type="submit"
                disabled={upsertAccountMutation.isPending}
                className="nav-touch-item flex-1 rounded-full bg-cta-surface px-5 py-3 text-xs font-semibold text-cta-foreground hover:opacity-90 active:scale-[0.98] disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
              >
                {upsertAccountMutation.isPending
                  ? "Menyimpan..."
                  : editingAccount
                    ? "Simpan Perubahan"
                    : "Simpan Akun"}
              </button>
            </div>
          </form>
        </DrawerContent>
      </Drawer>

      {/* 6. Dedicated Delete Account Confirmation Drawer */}
      <Drawer
        open={accountPendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setAccountPendingDelete(null);
        }}
      >
        <DrawerContent
          aria-describedby="delete-account-confirm-desc"
          className="p-0 data-[vaul-drawer-direction=bottom]:sm:mx-auto sm:max-w-md"
        >
          <div className="flex flex-auto min-h-0 flex-col overflow-y-auto overscroll-contain px-5 pt-5 pb-3 text-center">
            <div className="my-auto flex w-full flex-col items-center">
              {/* Vector Illustration */}
              <DeleteTransactionIllustration className="h-24 w-24 my-1" />

              <DrawerHeader className="p-0 mt-2 space-y-1 border-0">
                <DrawerTitle className="text-center text-base font-bold text-foreground sm:text-lg">
                  Hapus Akun Ini?
                </DrawerTitle>
                <DrawerDescription
                  id="delete-account-confirm-desc"
                  className="text-center text-xs text-muted-foreground max-w-xs mx-auto"
                >
                  Akun ini beserta seluruh catatan saldo akan dihapus dari buku.
                  Tindakan ini tidak dapat dibatalkan.
                </DrawerDescription>
              </DrawerHeader>

              {/* Account Preview Box */}
              {accountPendingDelete && (
                <div className="w-full mt-3 rounded-2xl border border-border bg-black/[0.04] dark:bg-white/[0.05] p-3.5 text-left text-xs space-y-1.5">
                  <div className="flex items-center justify-between font-semibold">
                    <span className="truncate text-foreground text-sm">
                      {accountPendingDelete.name}
                    </span>
                    <span className="rounded-full border border-border bg-black/[0.04] dark:bg-white/[0.06] px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                      {formatAccountTypeLabel(accountPendingDelete.account_type)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground pt-1.5 border-t border-border/50">
                    <span>Saldo Terakhir:</span>
                    <span className="font-mono font-bold text-foreground">
                      {formatRupiah(
                        balanceMap.get(accountPendingDelete.id) ??
                          accountPendingDelete.initial_balance
                      )}
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>

          <DrawerFooter className="border-t border-border/70 px-5 py-3 flex flex-row items-center gap-2">
            <button
              type="button"
              onClick={() => setAccountPendingDelete(null)}
              className="nav-touch-item flex-1 h-10 rounded-full border border-border bg-black/[0.04] dark:bg-white/[0.06] px-4 font-mono text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground active:scale-98 transition-all focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
            >
              Batal
            </button>
            <button
              type="button"
              disabled={deleteAccountMutation.isPending}
              onClick={() => void handleConfirmDeleteAccount()}
              className="nav-touch-item flex-1 h-10 inline-flex items-center justify-center gap-1.5 rounded-full bg-rose-600 px-4 text-xs font-semibold text-white hover:bg-rose-700 active:scale-98 transition-all focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-rose-600 disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" />
              <span>
                {deleteAccountMutation.isPending ? "Menghapus..." : "Hapus Akun"}
              </span>
            </button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      {/* 7. Modal Gabungkan Akun */}
      <Drawer
        open={isMergeModalOpen}
        onOpenChange={setIsMergeModalOpen}
        shouldScaleBackground={false}
      >
        <DrawerContent className="p-0 data-[vaul-drawer-direction=bottom]:max-h-[90dvh] data-[vaul-drawer-direction=bottom]:w-full data-[vaul-drawer-direction=bottom]:sm:mx-auto sm:max-w-lg">
          <form
            onSubmit={(e) => e.preventDefault()}
            className="flex min-h-0 flex-1 flex-col overflow-hidden"
          >
            {/* Header */}
            <div className="flex shrink-0 items-center justify-between border-b border-border/70 px-5 py-3.5">
              <div>
                <DrawerTitle className="text-sm font-bold text-foreground">
                  Gabungkan Dua Akun
                </DrawerTitle>
                <DrawerDescription className="text-xs text-muted-foreground">
                  Pindahkan seluruh riwayat transaksi dari akun sumber ke akun tujuan
                </DrawerDescription>
              </div>
              <button
                type="button"
                onClick={() => setIsMergeModalOpen(false)}
                aria-label="Tutup"
                className="nav-touch-item inline-flex h-8 w-8 items-center justify-center rounded-full border border-border bg-black/[0.04] dark:bg-white/[0.06] hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-auto min-h-0 space-y-4 overflow-y-auto overscroll-contain px-5 py-4">
              <div className="space-y-1.5">
                <label
                  htmlFor="merge-source-account"
                  className="text-xs font-medium text-foreground"
                >
                  Akun Sumber (Akan Ditutup & Dinonaktifkan)
                </label>
                <select
                  id="merge-source-account"
                  value={mergeSourceId}
                  onChange={(e) => setMergeSourceId(e.target.value)}
                  className="flex h-10 w-full rounded-xl border border-border bg-black/[0.03] dark:bg-white/[0.06] px-3.5 text-xs text-foreground focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
                >
                  {activeRootAccounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.name} ({formatAccountTypeLabel(acc.account_type)})
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="merge-target-account"
                  className="text-xs font-medium text-foreground"
                >
                  Akun Tujuan (Rekening Utama yang Menerima Saldo)
                </label>
                <select
                  id="merge-target-account"
                  value={mergeTargetId}
                  onChange={(e) => setMergeTargetId(e.target.value)}
                  className="flex h-10 w-full rounded-xl border border-border bg-black/[0.03] dark:bg-white/[0.06] px-3.5 text-xs text-foreground focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
                >
                  {activeRootAccounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.name} ({formatAccountTypeLabel(acc.account_type)})
                    </option>
                  ))}
                </select>
              </div>

              <div className="contrast-card p-3.5 text-xs text-amber-300">
                <p className="font-semibold">Tindakan Permanen &amp; CRDT</p>
                <p className="mt-1 text-[11px] leading-relaxed text-white/75">
                  Tindakan ini tidak dapat dibatalkan. Seluruh riwayat transaksi dari akun sumber akan digabungkan secara permanen ke akun tujuan dan otomatis diselaraskan antar perangkat.
                </p>
              </div>
            </div>

            {/* Slider Konfirmasi untuk Safety */}
            <div className="mt-auto shrink-0 border-t border-border/70 p-3.5 sm:px-5">
              <ButtonSlideToConfirm
                key={isMergeModalOpen ? "merge-open" : "merge-closed"}
                disabled={mergeAccountsMutation.isPending}
                label="Geser untuk Gabungkan Akun"
                readyLabel="Lepas untuk Memproses"
                loadingLabel="Menggabungkan..."
                successLabel="Akun Berhasil Digabungkan!"
                onConfirm={handleSlideConfirmMerge}
                onSuccessComplete={() => setIsMergeModalOpen(false)}
              />
            </div>
          </form>
        </DrawerContent>
      </Drawer>
    </motion.div>
  );
};
