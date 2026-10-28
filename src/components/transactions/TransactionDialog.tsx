import * as React from "react";
import { useForm, Controller } from "react-hook-form";
import { useQuery } from "@tanstack/react-query";
import { CurrencyInput } from "../ui/currency-input";
import { Input } from "../ui/input";
import {
  tauriApi,
  type AccountView,
  type AddTransactionInput,
  type CategoryView,
  type TransactionType,
  type TransactionView,
  type TransferBetweenBooksInput,
  type UpdateTransactionInput,
} from "../../lib/tauri-api";
import { bookQueryKeys } from "../../hooks/useBookFinance";
import { formatRupiah, todayIsoDate } from "../../lib/utils";
import { pushToast } from "../../lib/toast";

export type DialogTxMode = TransactionType | "CROSS_BOOK_TRANSFER";

export interface TransactionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  bookId: string;
  accounts: AccountView[];
  categories: CategoryView[];
  editingTx?: TransactionView | null;
  onAddTransaction: (input: AddTransactionInput) => Promise<unknown>;
  onUpdateTransaction: (input: UpdateTransactionInput) => Promise<unknown>;
  onTransferBetweenBooks: (input: TransferBetweenBooksInput) => Promise<unknown>;
}

interface TxFormValues {
  mode: DialogTxMode;
  accountId: string;
  toAccountId: string;
  toBookId: string;
  toBookAccountId: string;
  categoryId: string;
  rawAmount: number | null;
  txDate: string;
  note: string;
}

export const TransactionDialog: React.FC<TransactionDialogProps> = ({
  isOpen,
  onClose,
  bookId,
  accounts,
  categories,
  editingTx = null,
  onAddTransaction,
  onUpdateTransaction,
  onTransferBetweenBooks,
}) => {
  const activeAccounts = React.useMemo(
    () => accounts.filter((a) => a.merged_into_id === null),
    [accounts]
  );

  const booksQuery = useQuery({
    queryKey: bookQueryKeys.allBooks,
    queryFn: () => tauriApi.listBooks(),
    enabled: isOpen,
  });

  const otherBooks = React.useMemo(
    () => (booksQuery.data ?? []).filter((b) => b.id !== bookId),
    [booksQuery.data, bookId]
  );

  const { control, register, handleSubmit, watch, reset, setValue } =
    useForm<TxFormValues>({
      defaultValues: {
        mode: "EXPENSE",
        accountId: activeAccounts[0]?.id ?? "",
        toAccountId: activeAccounts[1]?.id ?? "",
        toBookId: "",
        toBookAccountId: "",
        categoryId: "",
        rawAmount: null,
        txDate: todayIsoDate(),
        note: "",
      },
    });

  const currentMode = watch("mode");
  const selectedToBookId = watch("toBookId");

  const destBookAccountsQuery = useQuery({
    queryKey: bookQueryKeys.accounts(selectedToBookId),
    queryFn: () => tauriApi.listAccounts(selectedToBookId),
    enabled:
      isOpen &&
      currentMode === "CROSS_BOOK_TRANSFER" &&
      Boolean(selectedToBookId),
  });

  const destBookAccounts = React.useMemo(
    () =>
      (destBookAccountsQuery.data ?? []).filter(
        (a) => a.merged_into_id === null
      ),
    [destBookAccountsQuery.data]
  );

  const filteredCategories = React.useMemo(() => {
    const targetKind = currentMode === "INCOME" ? "INCOME" : "EXPENSE";
    return categories.filter(
      (c) => c.kind === targetKind && c.merged_into_id === null
    );
  }, [categories, currentMode]);

  React.useEffect(() => {
    if (!isOpen) {
      return;
    }
    if (editingTx) {
      reset({
        mode: editingTx.tx_type,
        accountId: editingTx.account_id,
        toAccountId: editingTx.to_account_id ?? "",
        toBookId: "",
        toBookAccountId: "",
        categoryId: editingTx.category_id ?? "",
        rawAmount: Math.abs(editingTx.amount),
        txDate: editingTx.tx_date,
        note: editingTx.note ?? "",
      });
    } else {
      const expCats = categories.filter(
        (c) => c.kind === "EXPENSE" && c.merged_into_id === null
      );
      reset({
        mode: "EXPENSE",
        accountId: activeAccounts[0]?.id ?? "",
        toAccountId: activeAccounts[1]?.id ?? "",
        toBookId: otherBooks[0]?.id ?? "",
        toBookAccountId: "",
        categoryId: expCats[0]?.id ?? "",
        rawAmount: null,
        txDate: todayIsoDate(),
        note: "",
      });
    }
  }, [isOpen, editingTx, activeAccounts, categories, otherBooks, reset]);

  React.useEffect(() => {
    if (!editingTx && filteredCategories.length > 0) {
      const currentCat = watch("categoryId");
      const stillValid = filteredCategories.some((c) => c.id === currentCat);
      if (!stillValid) {
        setValue("categoryId", filteredCategories[0].id);
      }
    }
  }, [currentMode, filteredCategories, editingTx, setValue, watch]);

  React.useEffect(() => {
    if (
      currentMode === "CROSS_BOOK_TRANSFER" &&
      destBookAccounts.length > 0 &&
      !watch("toBookAccountId")
    ) {
      setValue("toBookAccountId", destBookAccounts[0].id);
    }
  }, [currentMode, destBookAccounts, setValue, watch]);

  if (!isOpen) {
    return null;
  }

  const checkBudgetThresholdAfterExpense = async (
    txDate: string,
    categoryId: string
  ) => {
    const month = txDate.slice(0, 7);
    try {
      const progressList = await tauriApi.getBudgetProgress(bookId, month);
      for (const b of progressList) {
        const isRelevant =
          b.category_id === null || b.category_id === categoryId;
        if (isRelevant && (b.status === "OVER" || b.status === "WARNING")) {
          pushToast(
            b.status === "OVER"
              ? `Anggaran "${b.category_name}" Melebihi Batas (${b.pct}%)`
              : `Peringatan Anggaran "${b.category_name}" (${b.pct}%)`,
            {
              description: `Terpakai ${formatRupiah(b.spent)} dari batas ${formatRupiah(b.amount_limit)} pada bulan ${month}.`,
              variant: b.status === "OVER" ? "error" : "warning",
            }
          );
        }
      }
    } catch {
      // Non-fatal check
    }
  };

  const onSubmit = async (values: TxFormValues) => {
    if (values.rawAmount === null || values.rawAmount <= 0) {
      pushToast("Nominal transaksi tidak valid", {
        description: "Masukkan nominal uang lebih dari Rp 0.",
        variant: "error",
      });
      return;
    }

    if (!values.accountId) {
      pushToast("Akun asal wajib dipilih", { variant: "error" });
      return;
    }

    try {
      if (values.mode === "CROSS_BOOK_TRANSFER") {
        if (!values.toBookId || !values.toBookAccountId) {
          pushToast("Buku tujuan dan akun tujuan wajib dipilih", {
            variant: "error",
          });
          return;
        }
        await onTransferBetweenBooks({
          from_book_id: bookId,
          from_account_id: values.accountId,
          to_book_id: values.toBookId,
          to_account_id: values.toBookAccountId,
          amount: values.rawAmount,
          tx_date: values.txDate,
          note: values.note.trim() || null,
        });
        pushToast("Transfer antar-buku berhasil dicatat", {
          description:
            "EXPENSE (Prive/Penarikan) dan INCOME (Bagi Hasil/Injeksi Modal) telah ditulis.",
          variant: "success",
        });
        onClose();
        return;
      }

      const signedAmount =
        values.mode === "EXPENSE"
          ? -Math.abs(values.rawAmount)
          : Math.abs(values.rawAmount);

      if (values.mode === "TRANSFER") {
        if (!values.toAccountId || values.toAccountId === values.accountId) {
          pushToast("Akun tujuan transfer harus berbeda dari akun asal", {
            variant: "error",
          });
          return;
        }
      } else if (!values.categoryId) {
        pushToast("Kategori wajib dipilih untuk Pemasukan/Pengeluaran", {
          variant: "error",
        });
        return;
      }

      if (editingTx) {
        await onUpdateTransaction({
          id: editingTx.id,
          account_id: values.accountId,
          to_account_id:
            values.mode === "TRANSFER" ? values.toAccountId : null,
          category_id:
            values.mode === "TRANSFER" ? null : values.categoryId,
          amount: signedAmount,
          tx_type: values.mode,
          note: values.note.trim() || null,
          tx_date: values.txDate,
        });
        pushToast("Transaksi berhasil diperbarui", { variant: "success" });
      } else {
        await onAddTransaction({
          account_id: values.accountId,
          to_account_id:
            values.mode === "TRANSFER" ? values.toAccountId : null,
          category_id:
            values.mode === "TRANSFER" ? null : values.categoryId,
          amount: signedAmount,
          tx_type: values.mode,
          note: values.note.trim() || null,
          tx_date: values.txDate,
        });
        pushToast("Transaksi berhasil ditambahkan", { variant: "success" });
      }

      if (values.mode === "EXPENSE") {
        await checkBudgetThresholdAfterExpense(
          values.txDate,
          values.categoryId
        );
      }

      onClose();
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Gagal menyimpan transaksi";
      pushToast("Gagal menyimpan transaksi", {
        description: msg,
        variant: "error",
      });
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="tx-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
    >
      <div className="tabular-grid-container max-h-[90vh] w-full max-w-xl overflow-y-auto shadow-none">
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="tabular-grid-cell space-y-4 p-5"
        >
          <div className="flex items-center justify-between border-b border-border pb-3">
            <div>
              <h2
                id="tx-dialog-title"
                className="text-sm font-semibold text-foreground"
              >
                {editingTx ? "Edit Transaksi" : "Catat Transaksi Baru"}
              </h2>
              <p className="text-xs text-muted-foreground">
                Tanda nominal (+/−) diatur otomatis sesuai jenis transaksi.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded border border-border px-2 py-1 font-mono text-xs text-muted-foreground shadow-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
            >
              ESC
            </button>
          </div>

          {/* Transaction Mode Selector */}
          <div className="tabular-grid-container grid grid-cols-2 sm:grid-cols-4">
            {(
              [
                { key: "EXPENSE", label: "− Pengeluaran", color: "text-rose-500!" },
                { key: "INCOME", label: "+ Pemasukan", color: "text-emerald-500!" },
                { key: "TRANSFER", label: "⇄ Transfer Akun", color: "text-sky-500!" },
                ...(!editingTx
                  ? [
                      {
                        key: "CROSS_BOOK_TRANSFER" as const,
                        label: "⇄ Antar-Buku",
                        color: "text-amber-500!",
                      },
                    ]
                  : []),
              ] as const
            ).map((tab) => {
              const active = currentMode === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setValue("mode", tab.key)}
                  className={`tabular-grid-cell whitespace-nowrap px-2.5 py-2 font-mono text-xs font-semibold shadow-none focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary ${
                    active
                      ? "bg-muted! text-foreground"
                      : `text-muted-foreground hover:text-foreground ${tab.color}`
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label
                htmlFor="tx-account-select"
                className="block text-xs font-medium text-foreground"
              >
                {currentMode === "TRANSFER" ||
                currentMode === "CROSS_BOOK_TRANSFER"
                  ? "Dari Akun"
                  : "Akun"}
              </label>
              <select
                id="tx-account-select"
                {...register("accountId")}
                className="flex h-9 w-full rounded-md border border-border bg-background px-3 py-1.5 text-xs text-foreground shadow-none focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
              >
                {activeAccounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.name} ({acc.account_type})
                  </option>
                ))}
              </select>
            </div>

            {currentMode === "TRANSFER" && (
              <div className="space-y-1">
                <label
                  htmlFor="tx-to-account-select"
                  className="block text-xs font-medium text-foreground"
                >
                  Ke Akun Tujuan
                </label>
                <select
                  id="tx-to-account-select"
                  {...register("toAccountId")}
                  className="flex h-9 w-full rounded-md border border-border bg-background px-3 py-1.5 text-xs text-foreground shadow-none focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
                >
                  <option value="">-- Pilih Akun Tujuan --</option>
                  {activeAccounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.name} ({acc.account_type})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {(currentMode === "EXPENSE" || currentMode === "INCOME") && (
              <div className="space-y-1">
                <label
                  htmlFor="tx-category-select"
                  className="block text-xs font-medium text-foreground"
                >
                  Kategori ({currentMode === "EXPENSE" ? "Pengeluaran" : "Pemasukan"})
                </label>
                <select
                  id="tx-category-select"
                  {...register("categoryId")}
                  className="flex h-9 w-full rounded-md border border-border bg-background px-3 py-1.5 text-xs text-foreground shadow-none focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
                >
                  <option value="">-- Pilih Kategori --</option>
                  {filteredCategories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {currentMode === "CROSS_BOOK_TRANSFER" && (
              <div className="space-y-1">
                <label
                  htmlFor="tx-to-book-select"
                  className="block text-xs font-medium text-foreground"
                >
                  Ke Buku Tujuan
                </label>
                <select
                  id="tx-to-book-select"
                  {...register("toBookId")}
                  className="flex h-9 w-full rounded-md border border-border bg-background px-3 py-1.5 text-xs text-foreground shadow-none focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
                >
                  <option value="">-- Pilih Buku Tujuan --</option>
                  {otherBooks.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} ({b.kind})
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {currentMode === "CROSS_BOOK_TRANSFER" && (
            <div className="space-y-1">
              <label
                htmlFor="tx-to-book-account-select"
                className="block text-xs font-medium text-foreground"
              >
                Akun di Buku Tujuan
              </label>
              <select
                id="tx-to-book-account-select"
                {...register("toBookAccountId")}
                className="flex h-9 w-full rounded-md border border-border bg-background px-3 py-1.5 text-xs text-foreground shadow-none focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
              >
                <option value="">-- Pilih Akun Buku Tujuan --</option>
                {destBookAccounts.map((acc) => (
                  <option key={acc.id} value={acc.id}>
                    {acc.name} ({acc.account_type})
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <label
                htmlFor="tx-amount-input"
                className="block text-xs font-medium text-foreground"
              >
                Nominal (Rupiah)
              </label>
              <Controller
                name="rawAmount"
                control={control}
                render={({ field }) => (
                  <CurrencyInput
                    id="tx-amount-input"
                    aria-label="Nominal Transaksi"
                    value={field.value}
                    onValueChange={field.onChange}
                    onBlur={field.onBlur}
                    ref={field.ref}
                  />
                )}
              />
            </div>

            <div className="space-y-1">
              <label
                htmlFor="tx-date-input"
                className="block text-xs font-medium text-foreground"
              >
                Tanggal Transaksi (YYYY-MM-DD)
              </label>
              <Input
                id="tx-date-input"
                type="date"
                {...register("txDate")}
                className="font-mono tabular-nums tracking-tight"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label
              htmlFor="tx-note-input"
              className="block text-xs font-medium text-foreground"
            >
              Catatan Transaksi (Opsional)
            </label>
            <Input
              id="tx-note-input"
              placeholder="Contoh: Makan siang klien / pembayaran invoice..."
              {...register("note")}
            />
          </div>

          <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground shadow-none hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
            >
              Batal
            </button>
            <button
              type="submit"
              className="rounded-md border border-border bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground shadow-none hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
            >
              {editingTx ? "Simpan Perubahan" : "Simpan Transaksi"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

