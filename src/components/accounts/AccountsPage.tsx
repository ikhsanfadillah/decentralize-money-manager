import * as React from "react";
import { Link } from "@tanstack/react-router";
import { TrendingDown, TrendingUp, X } from "lucide-react";
import { useBookFinance } from "../../hooks/useBookFinance";
import type { AccountType, AccountView } from "../../lib/tauri-api";
import { CurrencyInput } from "../ui/currency-input";
import { Input } from "../ui/input";
import {
  ButtonSlideToConfirm,
  type SlideConfirmResult,
} from "../ui/ButtonSlideToConfirm";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from "../ui/drawer";
import { formatAccountTypeLabel, formatRupiah } from "../../lib/utils";
import { pushToast } from "../../lib/toast";

export interface AccountsPageProps {
  bookId: string;
}

const ACCOUNT_TYPES: { value: AccountType; label: string }[] = [
  { value: "BANK", label: "Rekening Bank" },
  { value: "CASH", label: "Kas Tunai" },
  { value: "EWALLET", label: "Dompet Digital" },
];

export const AccountsPage: React.FC<AccountsPageProps> = ({ bookId }) => {
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

  const handleSlideConfirmAccount = async (): Promise<SlideConfirmResult> => {
    const trimmed = name.trim();
    if (!trimmed) {
      pushToast("Nama akun tidak boleh kosong", { variant: "warning" });
      return { ok: false, message: "Nama akun tidak boleh kosong" };
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
      return { ok: true };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Gagal menyimpan akun";
      pushToast("Gagal menyimpan akun", { description: msg, variant: "error" });
      return { ok: false, message: "Gagal Menyimpan Akun" };
    }
  };

  const handleDeleteAccount = async (acc: AccountView) => {
    try {
      await deleteAccountMutation.mutateAsync(acc.id);
      pushToast(`Akun "${acc.name}" dihapus`, { variant: "info" });
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
      {/* Header & Actions */}
      <div className="tabular-grid-container grid grid-cols-1 md:grid-cols-12">
        <div className="tabular-grid-cell flex flex-col justify-center px-3 py-2.5 md:col-span-7">
          <div className="flex items-center gap-2">
            <Link
              to="/books/$bookId/settings"
              params={{ bookId }}
              className="nav-touch-item inline-flex h-6 shrink-0 items-center rounded border border-border bg-background px-2 font-mono text-[10px] font-semibold text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
            >
              ← Pengaturan
            </Link>
            <h1 className="text-xs font-semibold tracking-tight text-foreground sm:text-sm">
              Manajemen Akun Keuangan
            </h1>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Kelola daftar rekening bank, dompet digital, atau uang tunai Anda.
          </p>
        </div>

        <div className="tabular-grid-cell flex flex-wrap items-center justify-end gap-1.5 px-3 py-2 md:col-span-5">
          <button
            type="button"
            onClick={handleOpenCreateAccount}
            className="nav-touch-item rounded border border-border bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
          >
            + Tambah Akun
          </button>
          <button
            type="button"
            onClick={handleOpenMergeModal}
            className="nav-touch-item rounded border border-border bg-background px-2.5 py-1 text-xs font-semibold text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
          >
            Gabungkan Rekening Ganda
          </button>
        </div>
      </div>

      {/* Active Root Accounts Table */}
      <div className="tabular-grid-container grid grid-cols-1">
        <div className="tabular-grid-cell hidden grid-cols-12 items-center px-3 py-2 font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground md:grid">
          <div className="col-span-4">Nama Akun</div>
          <div className="col-span-2">Jenis</div>
          <div className="col-span-2 text-right">Saldo Awal</div>
          <div className="col-span-2 text-right">Saldo Saat Ini</div>
          <div className="col-span-2 text-right">Aksi</div>
        </div>

        {activeRootAccounts.length === 0 ? (
          <div className="tabular-grid-cell p-6 text-center text-xs text-muted-foreground">
            <p>Belum ada akun aktif di buku ini.</p>
            <button
              type="button"
              onClick={handleOpenCreateAccount}
              className="mt-2.5 nav-touch-item inline-flex items-center rounded border border-border bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90"
            >
              + Tambah Akun Baru
            </button>
          </div>
        ) : (
          activeRootAccounts.map((acc, idx) => {
            const currentBal =
              balanceMap.get(acc.id) ?? acc.initial_balance;
            return (
              <div
                key={acc.id}
                data-testid={`account-row-${acc.id}`}
                style={{ animationDelay: `${idx * 35}ms` }}
                className="tabular-grid-cell animate-card-up grid grid-cols-1 items-center gap-1.5 px-3 py-2.5 text-xs md:grid-cols-12"
              >
                <div className="flex items-center justify-between md:col-span-4 md:block">
                  <div>
                    <p className="font-semibold text-foreground">{acc.name}</p>
                  </div>
                  <span className="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] text-foreground md:hidden">
                    {formatAccountTypeLabel(acc.account_type)}
                  </span>
                </div>

                <div className="hidden md:col-span-2 md:block">
                  <span className="rounded border border-border bg-background px-2 py-0.5 font-mono text-[11px] text-foreground">
                    {formatAccountTypeLabel(acc.account_type)}
                  </span>
                </div>

                <div className="flex items-center justify-between font-mono text-[11px] tabular-nums tracking-tight text-muted-foreground md:col-span-2 md:block md:text-right">
                  <span className="font-sans text-[10px] uppercase text-muted-foreground md:hidden">
                    Saldo Awal:
                  </span>
                  <span>{formatRupiah(acc.initial_balance)}</span>
                </div>

                <div className="flex items-center justify-between font-mono text-xs font-semibold tabular-nums tracking-tight text-foreground sm:text-sm md:col-span-2 md:block md:text-right">
                  <span className="font-sans text-[10px] font-normal uppercase text-muted-foreground md:hidden">
                    Saldo Saat Ini:
                  </span>
                  <span className="inline-flex items-center gap-1 md:justify-end">
                    {currentBal > acc.initial_balance ? (
                      <span title="Saldo bertambah dari saldo awal" className="inline-flex">
                        <TrendingUp
                          className="h-3.5 w-3.5 shrink-0 text-emerald-500"
                          aria-hidden="true"
                        />
                      </span>
                    ) : currentBal < acc.initial_balance ? (
                      <span title="Saldo berkurang dari saldo awal" className="inline-flex">
                        <TrendingDown
                          className="h-3.5 w-3.5 shrink-0 text-rose-500"
                          aria-hidden="true"
                        />
                      </span>
                    ) : null}
                    <span>{formatRupiah(currentBal)}</span>
                  </span>
                </div>

                <div className="flex items-center justify-end gap-1.5 md:col-span-2">
                  <button
                    type="button"
                    onClick={() => handleStartEdit(acc)}
                    className="nav-touch-item rounded border border-border bg-background px-2 py-0.5 text-[11px] font-medium text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDeleteAccount(acc)}
                    className="nav-touch-item rounded border border-border bg-background px-2 py-0.5 text-[11px] font-medium text-rose-500 hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
                  >
                    Hapus
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Merged Accounts History Section (if any) */}
      {mergedAccounts.length > 0 && (
        <div className="tabular-grid-container grid grid-cols-1">
          <div className="tabular-grid-cell px-3 py-2">
            <h2 className="font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Rekening yang Digabungkan ({mergedAccounts.length})
            </h2>
          </div>
          {mergedAccounts.map((m) => (
            <div
              key={m.id}
              className="tabular-grid-cell flex items-center justify-between px-3 py-2 text-xs"
            >
              <div>
                <span className="font-medium text-muted-foreground line-through">
                  {m.name}
                </span>
                <span className="ml-2 font-mono text-[10px] text-amber-500">
                  Tergabung ke rekening utama
                </span>
              </div>
              <span className="font-mono text-[10px] tabular-nums tracking-tight text-muted-foreground">
                Saldo awal dialihkan: {formatRupiah(m.initial_balance)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Add / Edit Account Drawer with ButtonSlideToConfirm */}
      <Drawer
        open={isAccountDrawerOpen}
        onOpenChange={(open) => {
          if (!open) {
            handleCloseAccountDrawer();
          }
        }}
        shouldScaleBackground={false}
      >
        <DrawerContent className="fixed inset-x-0 bottom-0 z-50 flex h-[100dvh] max-h-[100dvh] w-full flex-col rounded-none border-t border-border bg-card p-0 shadow-2xl focus:outline-none sm:mx-auto sm:h-auto sm:max-h-[90vh] sm:max-w-xl sm:rounded-t-2xl">
          <form
            onSubmit={(e) => e.preventDefault()}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
              }
            }}
            className="flex h-full sm:h-auto flex-1 flex-col overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-6 shrink-0 bg-card">
              <div>
                <DrawerTitle
                  id="account-dialog-title"
                  className="text-sm font-semibold text-foreground"
                >
                  {editingAccount
                    ? "Edit Akun Keuangan"
                    : "Tambah Akun Keuangan Baru"}
                </DrawerTitle>
                <DrawerDescription className="mt-0.5 text-xs text-muted-foreground">
                  Kelola daftar rekening bank, dompet digital, atau kas tunai
                  Anda.
                </DrawerDescription>
              </div>
              <button
                type="button"
                onClick={handleCloseAccountDrawer}
                aria-label="Tutup"
                className="nav-touch-item inline-flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 space-y-4">
              <div className="space-y-1.5">
                <label
                  htmlFor="account-name-input"
                  className="block text-xs font-medium text-foreground"
                >
                  Nama Akun
                </label>
                <Input
                  id="account-name-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Contoh: BCA Utama, Kas Dompet, GoPay..."
                  autoFocus
                />
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="account-type-select"
                  className="block text-xs font-medium text-foreground"
                >
                  Jenis Akun
                </label>
                <select
                  id="account-type-select"
                  value={accountType}
                  onChange={(e) => setAccountType(e.target.value as AccountType)}
                  className="flex h-9 w-full rounded border border-input bg-background px-3 py-1 text-xs text-foreground focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
                >
                  {ACCOUNT_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="account-initial-balance"
                  className="block text-xs font-medium text-foreground"
                >
                  Saldo Awal (Rp)
                </label>
                <CurrencyInput
                  id="account-initial-balance"
                  value={initialBalance}
                  onValueChange={(val) => setInitialBalance(val ?? 0)}
                />
              </div>
            </div>

            {/* Footer with ButtonSlideToConfirm */}
            <div className="flex items-center justify-end gap-2 border-t border-border p-2.5 sm:px-6 bg-card/60 backdrop-blur-xs shrink-0">
              <ButtonSlideToConfirm
                key={
                  isAccountDrawerOpen
                    ? `acc-${editingAccount?.id ?? "new"}`
                    : "closed"
                }
                disabled={upsertAccountMutation.isPending}
                label={
                  editingAccount
                    ? "Geser untuk Simpan Perubahan"
                    : "Geser untuk Simpan Akun"
                }
                readyLabel="Lepas untuk Simpan"
                loadingLabel="Menyimpan Akun..."
                successLabel={
                  editingAccount ? "Akun Diperbarui!" : "Akun Disimpan!"
                }
                onConfirm={handleSlideConfirmAccount}
                onSuccessComplete={handleCloseAccountDrawer}
              />
            </div>
          </form>
        </DrawerContent>
      </Drawer>

      {/* Merge Account Drawer with ButtonSlideToConfirm */}
      <Drawer
        open={isMergeModalOpen}
        onOpenChange={setIsMergeModalOpen}
        shouldScaleBackground={false}
      >
        <DrawerContent className="fixed inset-x-0 bottom-0 z-50 flex h-[100dvh] max-h-[100dvh] w-full flex-col rounded-none border-t border-border bg-card p-0 shadow-2xl focus:outline-none sm:mx-auto sm:h-auto sm:max-h-[90vh] sm:max-w-xl sm:rounded-t-2xl">
          <form
            onSubmit={(e) => e.preventDefault()}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
              }
            }}
            className="flex h-full sm:h-auto flex-1 flex-col overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-6 shrink-0 bg-card">
              <div>
                <DrawerTitle
                  id="merge-account-dialog-title"
                  className="text-sm font-semibold text-foreground"
                >
                  Gabungkan Dua Rekening
                </DrawerTitle>
                <DrawerDescription className="mt-0.5 text-xs text-muted-foreground">
                  Seluruh riwayat mutasi dari akun sumber akan disatukan ke akun
                  tujuan secara permanen.
                </DrawerDescription>
              </div>
              <button
                type="button"
                onClick={() => setIsMergeModalOpen(false)}
                aria-label="Tutup"
                className="nav-touch-item inline-flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Scrollable Content */}
            <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 space-y-4">
              <div className="space-y-1.5">
                <label
                  htmlFor="merge-source-account"
                  className="block text-xs font-medium text-foreground"
                >
                  Akun Sumber (Yang Akan Ditutup)
                </label>
                <select
                  id="merge-source-account"
                  value={mergeSourceId}
                  onChange={(e) => setMergeSourceId(e.target.value)}
                  className="flex h-9 w-full rounded border border-input bg-background px-3 py-1 text-xs text-foreground focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
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
                  className="block text-xs font-medium text-foreground"
                >
                  Akun Tujuan (Rekening Utama yang Dipakai)
                </label>
                <select
                  id="merge-target-account"
                  value={mergeTargetId}
                  onChange={(e) => setMergeTargetId(e.target.value)}
                  className="flex h-9 w-full rounded border border-input bg-background px-3 py-1 text-xs text-foreground focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
                >
                  {activeRootAccounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.name} ({formatAccountTypeLabel(acc.account_type)})
                    </option>
                  ))}
                </select>
              </div>

              <div className="rounded border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-600 dark:text-amber-400">
                <p className="font-semibold">Perhatian Penting:</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                  Tindakan ini tidak dapat dibatalkan. Riwayat transaksi dari
                  akun sumber akan digabungkan secara permanen ke akun tujuan.
                </p>
              </div>
            </div>

            {/* Footer with ButtonSlideToConfirm */}
            <div className="flex items-center justify-end gap-2 border-t border-border p-2.5 sm:px-6 bg-card/60 backdrop-blur-xs shrink-0">
              <ButtonSlideToConfirm
                key={isMergeModalOpen ? "merge-open" : "merge-closed"}
                disabled={mergeAccountsMutation.isPending}
                label="Geser untuk Gabungkan Akun"
                readyLabel="Lepas untuk Gabung"
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
