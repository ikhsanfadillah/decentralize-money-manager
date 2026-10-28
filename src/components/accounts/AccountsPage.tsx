import * as React from "react";
import { useBookFinance } from "../../hooks/useBookFinance";
import type { AccountType, AccountView } from "../../lib/tauri-api";
import { CurrencyInput } from "../ui/currency-input";
import { Input } from "../ui/input";
import { formatRupiah } from "../../lib/utils";
import { pushToast } from "../../lib/toast";

export interface AccountsPageProps {
  bookId: string;
}

const ACCOUNT_TYPES: { value: AccountType; label: string }[] = [
  { value: "BANK", label: "Rekening Bank (BANK)" },
  { value: "CASH", label: "Kas Tunai (CASH)" },
  { value: "EWALLET", label: "Dompet Digital (EWALLET)" },
];

export const AccountsPage: React.FC<AccountsPageProps> = ({ bookId }) => {
  const {
    accountsQuery,
    balancesQuery,
    upsertAccountMutation,
    deleteAccountMutation,
    mergeAccountsMutation,
  } = useBookFinance({ bookId });

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
  };

  const handleResetForm = () => {
    setEditingAccount(null);
    setName("");
    setAccountType("BANK");
    setInitialBalance(0);
  };

  const handleSubmitAccount = async (e: React.FormEvent) => {
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
      handleResetForm();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Gagal menyimpan akun";
      pushToast("Gagal menyimpan akun", { description: msg, variant: "error" });
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

  const handleConfirmMerge = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mergeSourceId || !mergeTargetId) {
      pushToast("Pilih akun sumber dan akun tujuan", { variant: "warning" });
      return;
    }
    if (mergeSourceId === mergeTargetId) {
      pushToast("Akun sumber dan akun tujuan tidak boleh sama", {
        variant: "error",
      });
      return;
    }

    try {
      await mergeAccountsMutation.mutateAsync({
        sourceId: mergeSourceId,
        targetId: mergeTargetId,
      });
      pushToast("Akun berhasil digabungkan secara kanonik", {
        variant: "success",
      });
      setIsMergeModalOpen(false);
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Gagal menggabungkan akun";
      pushToast("Gagal menggabungkan akun", {
        description: msg,
        variant: "error",
      });
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Merge Button */}
      <div className="tabular-grid-container grid grid-cols-1 md:grid-cols-12">
        <div className="tabular-grid-cell flex flex-col justify-center p-4 md:col-span-8">
          <h1 className="text-base font-semibold tracking-tight text-foreground">
            Manajemen Akun Keuangan
          </h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Penggabungan akun dilakukan secara manual untuk mencegah penyatuan
            tidak sengaja antar-bank/dompet yang memiliki nama serupa.
          </p>
        </div>

        <div className="tabular-grid-cell flex items-center justify-end p-4 md:col-span-4">
          <button
            type="button"
            onClick={handleOpenMergeModal}
            className="rounded border border-border bg-background px-3 py-1.5 text-xs font-semibold text-foreground shadow-none hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
          >
            Gabungkan Akun Duplikat (Manual Merge)
          </button>
        </div>
      </div>

      {/* Add / Edit Account Form */}
      <form
        onSubmit={(e) => void handleSubmitAccount(e)}
        className="tabular-grid-container grid grid-cols-1 md:grid-cols-12"
      >
        <div className="tabular-grid-cell p-4 md:col-span-4">
          <label
            htmlFor="account-name-input"
            className="mb-1.5 block text-xs font-medium text-foreground"
          >
            {editingAccount ? "Edit Nama Akun" : "Nama Akun Baru"}
          </label>
          <Input
            id="account-name-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Contoh: BCA Utama, Kas Dompet, GoPay..."
          />
        </div>

        <div className="tabular-grid-cell p-4 md:col-span-3">
          <label
            htmlFor="account-type-select"
            className="mb-1.5 block text-xs font-medium text-foreground"
          >
            Jenis Akun
          </label>
          <select
            id="account-type-select"
            value={accountType}
            onChange={(e) => setAccountType(e.target.value as AccountType)}
            className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-xs text-foreground shadow-none focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
          >
            {ACCOUNT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>

        <div className="tabular-grid-cell p-4 md:col-span-3">
          <label
            htmlFor="account-initial-balance"
            className="mb-1.5 block text-xs font-medium text-foreground"
          >
            Saldo Awal (Rp)
          </label>
          <CurrencyInput
            id="account-initial-balance"
            value={initialBalance}
            onValueChange={(val) => setInitialBalance(val ?? 0)}
          />
        </div>

        <div className="tabular-grid-cell flex items-end justify-end gap-2 p-4 md:col-span-2">
          {editingAccount && (
            <button
              type="button"
              onClick={handleResetForm}
              className="h-9 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-foreground shadow-none hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
            >
              Batal
            </button>
          )}
          <button
            type="submit"
            disabled={upsertAccountMutation.isPending}
            className="h-9 w-full rounded-md border border-border bg-primary px-3 text-xs font-semibold text-primary-foreground shadow-none hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary disabled:opacity-50"
          >
            {editingAccount ? "Perbarui" : "+ Tambah Akun"}
          </button>
        </div>
      </form>

      {/* Active Root Accounts Table */}
      <div className="tabular-grid-container grid grid-cols-1">
        <div className="tabular-grid-cell hidden grid-cols-12 items-center px-4 py-2.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground md:grid">
          <div className="col-span-4">Nama Akun & ID</div>
          <div className="col-span-2">Jenis</div>
          <div className="col-span-2 text-right">Saldo Awal</div>
          <div className="col-span-2 text-right">Saldo Saat Ini</div>
          <div className="col-span-2 text-right">Aksi</div>
        </div>

        {activeRootAccounts.length === 0 ? (
          <div className="tabular-grid-cell p-8 text-center text-xs text-muted-foreground">
            Belum ada akun aktif di buku ini.
          </div>
        ) : (
          activeRootAccounts.map((acc) => {
            const currentBal =
              balanceMap.get(acc.id) ?? acc.initial_balance;
            return (
              <div
                key={acc.id}
                data-testid={`account-row-${acc.id}`}
                className="tabular-grid-cell grid grid-cols-1 items-center gap-2 px-4 py-3 text-xs md:grid-cols-12"
              >
                <div className="md:col-span-4">
                  <p className="font-semibold text-foreground">{acc.name}</p>
                  <p className="font-mono text-[11px] text-muted-foreground">
                    ID: {acc.id.slice(0, 8)}
                  </p>
                </div>

                <div className="md:col-span-2">
                  <span className="rounded border border-border bg-background px-2 py-0.5 font-mono text-[11px] text-foreground">
                    {acc.account_type}
                  </span>
                </div>

                <div className="font-mono tabular-nums tracking-tight text-muted-foreground md:col-span-2 md:text-right">
                  <span className="mr-1.5 font-sans text-[10px] uppercase text-muted-foreground md:hidden">
                    Saldo Awal:
                  </span>
                  {formatRupiah(acc.initial_balance)}
                </div>

                <div className="font-mono text-sm font-semibold tabular-nums tracking-tight text-foreground md:col-span-2 md:text-right">
                  <span className="mr-1.5 font-sans text-[10px] font-normal uppercase text-muted-foreground md:hidden">
                    Saldo Saat Ini:
                  </span>
                  {formatRupiah(currentBal)}
                </div>

                <div className="flex items-center justify-end gap-1.5 md:col-span-2">
                  <button
                    type="button"
                    onClick={() => handleStartEdit(acc)}
                    className="rounded border border-border bg-background px-2.5 py-1 text-xs font-medium text-foreground shadow-none hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDeleteAccount(acc)}
                    className="rounded border border-border bg-background px-2.5 py-1 text-xs font-medium text-rose-500 shadow-none hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
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
          <div className="tabular-grid-cell px-4 py-2.5">
            <h2 className="font-mono text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Riwayat Akun yang Digabungkan ({mergedAccounts.length})
            </h2>
          </div>
          {mergedAccounts.map((m) => (
            <div
              key={m.id}
              className="tabular-grid-cell flex items-center justify-between px-4 py-2.5 text-xs"
            >
              <div>
                <span className="font-medium text-muted-foreground line-through">
                  {m.name}
                </span>
                <span className="ml-2 font-mono text-[11px] text-amber-500">
                  MERGED → Root ID {m.root_id.slice(0, 8)}
                </span>
              </div>
              <span className="font-mono text-[11px] tabular-nums tracking-tight text-muted-foreground">
                Saldo awal dialihkan: {formatRupiah(m.initial_balance)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Manual Merge Modal */}
      {isMergeModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="merge-account-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
        >
          <div className="w-full max-w-md rounded-md border border-border bg-card p-5 text-card-foreground shadow-none">
            <div className="border-b border-border pb-3">
              <h2
                id="merge-account-dialog-title"
                className="text-base font-semibold text-foreground"
              >
                Gabungkan Akun Secara Manual
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Seluruh transaksi dan saldo awal dari Akun Sumber akan
                diarahkan ke Akun Tujuan melalui rantai rekursif `account_roots`
                (maks. 16 tingkat dengan pelindung siklus).
              </p>
            </div>

            <form
              onSubmit={(e) => void handleConfirmMerge(e)}
              className="mt-4 space-y-4"
            >
              <div>
                <label
                  htmlFor="merge-source-account"
                  className="mb-1.5 block text-xs font-medium text-foreground"
                >
                  Akun Sumber (Akan Digabungkan)
                </label>
                <select
                  id="merge-source-account"
                  value={mergeSourceId}
                  onChange={(e) => setMergeSourceId(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-xs text-foreground shadow-none focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
                >
                  {activeRootAccounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.name} ({acc.account_type})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="merge-target-account"
                  className="mb-1.5 block text-xs font-medium text-foreground"
                >
                  Akun Tujuan (Kanonik)
                </label>
                <select
                  id="merge-target-account"
                  value={mergeTargetId}
                  onChange={(e) => setMergeTargetId(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-xs text-foreground shadow-none focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
                >
                  {activeRootAccounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.name} ({acc.account_type})
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
                <button
                  type="button"
                  onClick={() => setIsMergeModalOpen(false)}
                  className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground shadow-none hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={mergeAccountsMutation.isPending}
                  className="rounded-md border border-border bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground shadow-none hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary disabled:opacity-50"
                >
                  {mergeAccountsMutation.isPending
                    ? "Menggabungkan..."
                    : "Konfirmasi Gabung"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
