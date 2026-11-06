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
import { useBookFinance } from "../../hooks/useBookFinance";
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

  return (
    <div className="w-full">
      {/* 1. Enterprise Header & Actions (Hairline Tabular Grid) */}
      <div className="tabular-grid-container grid grid-cols-1 md:grid-cols-12">
        <div className="tabular-grid-cell flex flex-col justify-center px-3 py-2.5 md:col-span-7">
          <div className="flex items-center gap-2">
            <Link
              to="/books/$bookId/settings"
              params={{ bookId }}
              className="nav-touch-item inline-flex h-6 shrink-0 items-center rounded border border-border bg-background px-2 font-mono text-[10px] font-semibold text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
            >
              ←
            </Link>
            <div className="flex items-center justify-between flex-1">

              <h1 className="text-xs font-semibold tracking-tight text-foreground sm:text-sm">
                Rekening & Dompet
              </h1>
              <div>

                <span className="font-mono text-sm sm:text-base font-bold tabular-nums tracking-tight text-foreground">
                  {formatRupiah(totalBalance)}
                </span>
              </div>
            </div>
          </div>
        </div>

      </div>

      <div className="tabular-grid-container grid grid-cols-1">
        <div className="tabular-grid-cell flex items-center justify-end gap-1.5 px-3 py-2 md:col-span-5">
          <button
            type="button"
            onClick={handleOpenCreateAccount}
            className="nav-touch-item flex flex-1 justify-center items-center gap-1 rounded border border-border bg-primary px-2.5 py-2 text-xs font-semibold text-primary-foreground hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Tambah Akun</span>
          </button>
          {activeRootAccounts.length >= 2 && (
            <button
              type="button"
              onClick={handleOpenMergeModal}
              className="nav-touch-item inline-flex items-center gap-1 rounded border border-border bg-background px-2.5 py-2 text-xs font-semibold text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
            >
              <GitMerge className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          )}
        </div>
      </div>

      {/* 3. Tabular Grid Account Rows */}
      <div className="tabular-grid-container grid grid-cols-1">
        {/* Desktop Table Header */}
        <div className="tabular-grid-cell hidden grid-cols-12 items-center px-3 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground md:grid">
          <div className="col-span-8">Nama Akun</div>
          <div className="col-span-4 text-right">Saldo</div>
        </div>

        {activeRootAccounts.length === 0 ? (
          <div className="tabular-grid-cell p-6 text-center text-xs text-muted-foreground">
            <p>Belum ada akun aktif di buku ini.</p>
            <button
              type="button"
              onClick={handleOpenCreateAccount}
              className="mt-2.5 nav-touch-item inline-flex items-center gap-1 rounded border border-border bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90"
            >
              <Plus className="h-3.5 w-3.5" />
              Tambah Akun Baru
            </button>
          </div>
        ) : (
          activeRootAccounts.map((acc, idx) => {
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
                style={{ animationDelay: `${idx * 25}ms` }}
                className="tabular-grid-cell group nav-touch-item animate-card-up flex cursor-pointer items-center justify-between p-3.5 text-sm transition-colors hover:bg-muted/60 active:bg-muted/80 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
              >
                {/* Left: Icon + Full Name + Badge (Max space, no squeeze!) */}
                <div className="flex min-w-0 flex-1 items-center gap-2 pr-3">
                  <IconComp className="h-4 w-4 shrink-0 text-muted-foreground group-hover:text-foreground transition-colors" />
                  <span className="truncate font-semibold text-foreground text-xs sm:text-sm">
                    {acc.name}
                  </span>
                  <span className="shrink-0 rounded border border-border bg-background px-1.5 py-0.2 font-mono text-[10px] text-muted-foreground">
                    {visual.label}
                  </span>
                </div>

                {/* Right: Balance + Initial (if diff) + Chevron. No 'SALDO SAAT INI' clutter! */}
                {/* Right: Balance + Initial (if diff) + Edit Button + Chevron */}
                <div className="flex shrink-0 items-center gap-2">
                  <div className="text-right">
                    <div className="flex items-center justify-end gap-1 font-mono text-xs sm:text-sm font-semibold tabular-nums tracking-tight text-foreground">
                      {currentBal > acc.initial_balance && (
                        <span title="Saldo bertambah dari saldo awal" className="inline-flex">
                          <TrendingUp className="h-3.5 w-3.5 text-emerald-500" />
                        </span>
                      )}
                      {currentBal < acc.initial_balance && (
                        <span title="Saldo berkurang dari saldo awal" className="inline-flex">
                          <TrendingDown className="h-3.5 w-3.5 text-rose-500" />
                        </span>
                      )}
                      <span className={currentBal < 0 ? "text-rose-600 dark:text-rose-400" : ""}>
                        {formatRupiah(currentBal)}
                      </span>
                    </div>
                    {acc.initial_balance !== 0 && (
                      <div className="font-mono text-[10px] text-muted-foreground tabular-nums">
                        Awal: {formatRupiah(acc.initial_balance)}
                      </div>
                    )}
                  </div>
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* 4. Merged Accounts History Section */}
      {mergedAccounts.length > 0 && (
        <div className="tabular-grid-container grid grid-cols-1">
          <div className="tabular-grid-cell px-3 py-2">
            <h2 className="font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Rekening yang Digabungkan ({mergedAccounts.length})
            </h2>
          </div>
          {mergedAccounts.map((m) => (
            <div
              key={m.id}
              className="tabular-grid-cell flex items-center justify-between px-3 py-2 text-xs"
            >
              <div className="min-w-0 flex items-center gap-2">
                <span className="truncate font-medium text-muted-foreground line-through">
                  {m.name}
                </span>
                <span className="shrink-0 font-mono text-[10px] text-amber-500">
                  Tergabung
                </span>
              </div>
              <span className="shrink-0 font-mono text-[10px] tabular-nums tracking-tight text-muted-foreground">
                Saldo awal: {formatRupiah(m.initial_balance)}
              </span>
            </div>
          ))}
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
        <DrawerContent className="fixed inset-x-0 bottom-0 z-50 flex max-h-[90vh] flex-col rounded-t-xl border-t border-border bg-card p-0 shadow-2xl focus:outline-none sm:mx-auto sm:max-w-lg">
          <form onSubmit={handleSaveAccountDirect} className="flex flex-col">
            {/* Header */}
            <div className="border-b border-border py-3">
              <div className="flex items-center justify-between px-4 sm:px-5">
                <div>
                  <DrawerTitle className="text-sm font-semibold text-foreground">
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
                  className="nav-touch-item inline-flex h-7 w-7 items-center justify-center rounded border border-border hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              {
                editingAccount && (
                  <div className="mt-3 px-3">
                    <button
                      type="button"
                      onClick={() => {
                        const target = editingAccount;
                        handleCloseAccountDrawer();
                        handleViewLedger(target);
                      }}
                      className="nav-touch-item flex w-full items-center justify-center gap-1.5 rounded border border-border bg-muted py-1.5 text-xs font-semibold text-primary transition-colors"
                    >
                      <FileText className="h-3.5 w-3.5" />
                      <span>Lihat Mutasi Transaksi</span>
                      <ArrowUpRight className="h-3.5 w-3.5" />
                    </button>

                  </div>
                )
              }
            </div>

            {/* Body */}
            <div className="space-y-3.5 px-4 py-4 sm:px-5">
              {/* Financial & Ledger Summary for Existing Account */}
              {editingAccount && (
                <div className="space-y-2.5 ">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground font-medium">Saldo Saat Ini:</span>
                    <span
                      className={`font-mono text-sm font-bold tabular-nums ${editingAccountBalance < 0
                        ? "text-rose-600 dark:text-rose-400"
                        : "text-foreground"
                        }`}
                    >
                      {formatRupiah(editingAccountBalance)}
                    </span>
                  </div>

                  {editingAccountBalance < 0 && (
                    <div className="flex items-start gap-2 rounded border border-rose-500/20 bg-rose-500/10 p-2 text-[11px] text-rose-700 dark:text-rose-300">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-500" />
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
              <div className="space-y-1">
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

              {/* Account Type: Segmented Buttons for 1-Tap Experience */}
              <div className="space-y-1">
                <span className="text-xs font-medium text-foreground">
                  Jenis Akun
                </span>
                <div className="grid grid-cols-3 gap-1.5">
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
                        className={`nav-touch-item flex items-center justify-center gap-1.5 rounded border py-1.5 px-2 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary ${isSelected
                          ? "border-primary bg-primary/10 font-semibold text-primary"
                          : "border-border bg-background text-muted-foreground hover:bg-muted"
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
              <div className="space-y-1">
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
                <div className="mt-3 border-t border-border/60">
                  <button
                    type="button"
                    onClick={() => {
                      const target = editingAccount;
                      handleCloseAccountDrawer();
                      setAccountPendingDelete(target);
                    }}
                    className="nav-touch-item flex w-full items-center justify-center gap-1.5 rounded-lg border border-rose-500/20 bg-rose-500/5 py-2 text-xs font-medium text-rose-600 hover:bg-rose-500/10 active:scale-[0.99] dark:text-rose-400 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary transition-colors"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>Hapus Akun Ini</span>
                  </button>
                </div>
              )}
            </div>

            {/* Direct Save Action Buttons */}
            <div className="flex items-center justify-end gap-2 border-t border-border px-4 py-2.5 sm:px-5">
              <button
                type="submit"
                disabled={upsertAccountMutation.isPending}
                className="nav-touch-item rounded-lg border flex-1 border-border bg-primary px-4 py-3 text-xs font-semibold text-primary-foreground hover:opacity-90 active:scale-[0.98] disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
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

      {/* 6. Dedicated Delete Account Confirmation Drawer (Identik dengan TransactionTable) */}
      <Drawer
        open={accountPendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setAccountPendingDelete(null);
        }}
      >
        <DrawerContent
          aria-describedby="delete-account-confirm-desc"
          className="p-0 sm:mx-auto sm:max-w-md sm:rounded-t-2xl"
        >
          <div className="flex flex-col items-center px-4 pt-5 pb-2 text-center">
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
              <div className="w-full mt-3 rounded-lg border border-border bg-muted/40 p-3 text-left text-xs space-y-1.5">
                <div className="flex items-center justify-between font-semibold">
                  <span className="truncate text-foreground text-sm">
                    {accountPendingDelete.name}
                  </span>
                  <span className="rounded border border-border bg-background px-1.5 py-0.2 font-mono text-[10px] text-muted-foreground">
                    {formatAccountTypeLabel(accountPendingDelete.account_type)}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground pt-1 border-t border-border/50">
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

          <DrawerFooter className="border-t border-border px-4 py-3 bg-card/60 backdrop-blur-xs flex flex-row items-center gap-2">
            <button
              type="button"
              onClick={() => setAccountPendingDelete(null)}
              className="nav-touch-item flex-1 h-9 rounded-lg border border-border bg-background px-4 font-mono text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground active:scale-98 transition-all focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
            >
              Batal
            </button>
            <button
              type="button"
              disabled={deleteAccountMutation.isPending}
              onClick={() => void handleConfirmDeleteAccount()}
              className="nav-touch-item flex-1 h-9 inline-flex items-center justify-center gap-1.5 rounded-lg bg-rose-600 px-4 text-xs font-semibold text-white shadow-xs hover:bg-rose-700 active:scale-98 transition-all focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-rose-600 disabled:opacity-50"
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
        <DrawerContent className="fixed inset-x-0 bottom-0 z-50 flex max-h-[90vh] flex-col rounded-t-xl border-t border-border bg-card p-0 shadow-2xl focus:outline-none sm:mx-auto sm:max-w-lg">
          <form
            onSubmit={(e) => e.preventDefault()}
            className="flex flex-col overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-5">
              <div>
                <DrawerTitle className="text-sm font-semibold text-foreground">
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
                className="nav-touch-item inline-flex h-7 w-7 items-center justify-center rounded border border-border hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Body */}
            <div className="space-y-3.5 px-4 py-4 sm:px-5">
              <div className="space-y-1">
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
                  className="flex h-8 w-full rounded border border-border bg-background px-2.5 text-xs text-foreground focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
                >
                  {activeRootAccounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.name} ({formatAccountTypeLabel(acc.account_type)})
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
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
                  className="flex h-8 w-full rounded border border-border bg-background px-2.5 text-xs text-foreground focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
                >
                  {activeRootAccounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.name} ({formatAccountTypeLabel(acc.account_type)})
                    </option>
                  ))}
                </select>
              </div>

              <div className="rounded border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-600 dark:text-amber-400">
                <p className="font-semibold">⚠️ Tindakan Permanen</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                  Tindakan ini tidak dapat dibatalkan. Seluruh riwayat transaksi dari akun sumber akan digabungkan secara permanen ke akun tujuan.
                </p>
              </div>
            </div>

            {/* Slider Konfirmasi untuk Safety */}
            <div className="border-t border-border p-3 sm:px-5">
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
    </div>
  );
};
