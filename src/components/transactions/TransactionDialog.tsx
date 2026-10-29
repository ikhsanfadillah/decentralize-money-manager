import * as React from "react";
import { useForm, Controller } from "react-hook-form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
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
import {
  formatAccountTypeLabel,
  formatBookKindLabel,
  formatRupiah,
  todayIsoDate,
} from "../../lib/utils";
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

  const queryClient = useQueryClient();
  const [isQuickAddCategory, setIsQuickAddCategory] = React.useState(false);
  const [newCategoryName, setNewCategoryName] = React.useState("");
  const [isAddingCategory, setIsAddingCategory] = React.useState(false);

  const {
    control,
    register,
    getValues,
    watch,
    reset,
    setValue,
    formState: { isSubmitting },
  } = useForm<TxFormValues>({
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
      setIsQuickAddCategory(false);
      setNewCategoryName("");
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

  const handleQuickAddCategory = async () => {
    const trimmed = newCategoryName.trim();
    if (!trimmed) {
      pushToast("Nama kategori tidak boleh kosong", { variant: "warning" });
      return;
    }

    const targetKind = currentMode === "INCOME" ? "INCOME" : "EXPENSE";
    setIsAddingCategory(true);
    try {
      const created = await tauriApi.upsertCategory(bookId, {
        id: null,
        name: trimmed,
        kind: targetKind,
      });
      await queryClient.invalidateQueries({
        queryKey: bookQueryKeys.categories(bookId),
      });
      setValue("categoryId", created.id);
      setIsQuickAddCategory(false);
      setNewCategoryName("");
      pushToast(`Kategori "${trimmed}" berhasil ditambahkan`, {
        variant: "success",
      });
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Gagal menambahkan kategori";
      pushToast("Gagal menambahkan kategori", {
        description: msg,
        variant: "error",
      });
    } finally {
      setIsAddingCategory(false);
    }
  };

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

  const handleSlideConfirm = async (): Promise<SlideConfirmResult> => {
    const values = getValues();

    if (values.rawAmount === null || values.rawAmount <= 0) {
      pushToast("Nominal transaksi tidak valid", {
        description: "Masukkan nominal uang lebih dari Rp 0.",
        variant: "error",
      });
      return { ok: false, message: "Nominal harus > Rp 0" };
    }

    if (!values.accountId) {
      pushToast("Akun asal wajib dipilih", { variant: "error" });
      return { ok: false, message: "Rekening asal wajib dipilih" };
    }

    try {
      if (values.mode === "CROSS_BOOK_TRANSFER") {
        if (!values.toBookId || !values.toBookAccountId) {
          pushToast("Buku tujuan dan akun tujuan wajib dipilih", {
            variant: "error",
          });
          return { ok: false, message: "Pilih buku & rekening tujuan" };
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
            "Saldo berhasil dipindahkan ke buku tujuan.",
          variant: "success",
        });
        return { ok: true };
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
          return { ok: false, message: "Rekening tujuan harus berbeda" };
        }
      } else if (!values.categoryId) {
        pushToast("Kategori wajib dipilih untuk Pemasukan/Pengeluaran", {
          variant: "error",
        });
        return { ok: false, message: "Kategori wajib dipilih" };
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

      return { ok: true };
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Gagal menyimpan transaksi";
      pushToast("Gagal menyimpan transaksi", {
        description: msg,
        variant: "error",
      });
      return { ok: false, message: "Gagal Menyimpan Transaksi" };
    }
  };

  return (
    <Drawer
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
      shouldScaleBackground={false}
    >
      <DrawerContent
        className="fixed inset-x-0 bottom-0 z-50 flex h-[100dvh] max-h-[100dvh] w-full flex-col rounded-none border-t border-border bg-card p-0 shadow-2xl focus:outline-none sm:mx-auto sm:h-auto sm:max-h-[90vh] sm:max-w-xl sm:rounded-t-2xl"
      >
        <form
          onSubmit={(e) => e.preventDefault()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
            }
          }}
          className="flex h-full sm:h-auto flex-1 flex-col overflow-hidden"
        >
          {/* Header - Border divider mentok ke container */}
          <div className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-6 shrink-0 bg-card">
            <div>
              <DrawerTitle
                id="tx-dialog-title"
                className="text-sm font-semibold text-foreground"
              >
                {editingTx ? "Ubah Catatan Transaksi" : "Catat Transaksi Baru"}
              </DrawerTitle>
              <DrawerDescription className="mt-0.5 text-xs text-muted-foreground">
                Pilih jenis transaksi dan isi nominal uangnya.
              </DrawerDescription>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Tutup"
              className="nav-touch-item inline-flex h-8 w-8 items-center justify-center rounded-full border border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Scrollable Content Body - Padding container hanya di content */}
          <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6 space-y-4">
            {/* Transaction Mode Selector */}
            <div className="tabular-grid-container grid grid-cols-2 sm:grid-cols-4 -m-4 mb-4">
              {(
                [
                  { key: "EXPENSE", label: "− Pengeluaran", color: "text-rose-500!" },
                  { key: "INCOME", label: "+ Pemasukan", color: "text-emerald-500!" },
                  { key: "TRANSFER", label: "⇄ Pindah Saldo", color: "text-sky-500!" },
                  ...(!editingTx
                    ? [
                        {
                          key: "CROSS_BOOK_TRANSFER" as const,
                          label: "⇄ Pindah Buku",
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
                    className={`tabular-grid-cell whitespace-nowrap px-2.5 py-2.5 text-xs ${tab.color} font-semibold focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary ${
                      active
                        ? "bg-muted!"
                        : `text-muted-foreground hover:text-foreground`
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
                    ? "Dari Rekening / Dompet"
                    : "Rekening / Dompet"}
                </label>
                <select
                  id="tx-account-select"
                  {...register("accountId")}
                  className="flex h-9 w-full rounded-md border border-border bg-background px-3 py-1.5 text-xs text-foreground shadow-none focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
                >
                  {activeAccounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.name} ({formatAccountTypeLabel(acc.account_type)})
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
                    Ke Rekening / Dompet Tujuan
                  </label>
                  <select
                    id="tx-to-account-select"
                    {...register("toAccountId")}
                    className="flex h-9 w-full rounded-md border border-border bg-background px-3 py-1.5 text-xs text-foreground shadow-none focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
                  >
                    <option value="">-- Pilih Tujuan --</option>
                    {activeAccounts.map((acc) => (
                      <option key={acc.id} value={acc.id}>
                        {acc.name} ({formatAccountTypeLabel(acc.account_type)})
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {(currentMode === "EXPENSE" || currentMode === "INCOME") && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label
                      htmlFor="tx-category-select"
                      className="block text-xs font-medium text-foreground"
                    >
                      Kategori ({currentMode === "EXPENSE" ? "Pengeluaran" : "Pemasukan"})
                    </label>
                    {!isQuickAddCategory && (
                      <button
                        type="button"
                        onClick={() => {
                          setIsQuickAddCategory(true);
                          setNewCategoryName("");
                        }}
                        className="nav-touch-item inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline"
                      >
                        <Plus className="h-3 w-3" />
                        <span>Kategori Baru</span>
                      </button>
                    )}
                  </div>

                  {isQuickAddCategory ? (
                    <div className="rounded-md border border-primary/40 bg-primary/5 p-2.5 space-y-2">
                      <p className="text-[11px] font-medium text-foreground">
                        Tambah Kategori {currentMode === "EXPENSE" ? "Pengeluaran" : "Pemasukan"} Baru:
                      </p>
                      <div className="flex items-center gap-1.5">
                        <Input
                          value={newCategoryName}
                          onChange={(e) => setNewCategoryName(e.target.value)}
                          placeholder="Contoh: Belanja Bulanan, Kopi, Hiburan..."
                          className="h-8 text-xs bg-background"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              void handleQuickAddCategory();
                            } else if (e.key === "Escape") {
                              e.preventDefault();
                              setIsQuickAddCategory(false);
                            }
                          }}
                        />
                        <button
                          type="button"
                          onClick={() => void handleQuickAddCategory()}
                          disabled={isAddingCategory || !newCategoryName.trim()}
                          className="nav-touch-item shrink-0 h-8 px-3 rounded-md bg-primary text-primary-foreground text-xs font-semibold hover:opacity-90 disabled:opacity-50"
                        >
                          {isAddingCategory ? "..." : "Simpan"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setIsQuickAddCategory(false)}
                          className="nav-touch-item shrink-0 h-8 px-2.5 rounded-md border border-border bg-background text-muted-foreground text-xs hover:text-foreground"
                        >
                          Batal
                        </button>
                      </div>
                    </div>
                  ) : (
                    <select
                      id="tx-category-select"
                      {...register("categoryId")}
                      onChange={(e) => {
                        if (e.target.value === "__NEW__") {
                          setIsQuickAddCategory(true);
                          setNewCategoryName("");
                          return;
                        }
                        setValue("categoryId", e.target.value);
                      }}
                      className="flex h-9 w-full rounded-md border border-border bg-background px-3 py-1.5 text-xs text-foreground shadow-none focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
                    >
                      <option value="">-- Pilih Kategori --</option>
                      {filteredCategories.map((cat) => (
                        <option key={cat.id} value={cat.id}>
                          {cat.name}
                        </option>
                      ))}
                      <option value="__NEW__">+ Tambah Kategori Baru...</option>
                    </select>
                  )}
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
                        {b.name} ({formatBookKindLabel(b.kind)})
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
                  Rekening di Buku Tujuan
                </label>
                <select
                  id="tx-to-book-account-select"
                  {...register("toBookAccountId")}
                  className="flex h-9 w-full rounded-md border border-border bg-background px-3 py-1.5 text-xs text-foreground shadow-none focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
                >
                  <option value="">-- Pilih Rekening Buku Tujuan --</option>
                  {destBookAccounts.map((acc) => (
                    <option key={acc.id} value={acc.id}>
                      {acc.name} ({formatAccountTypeLabel(acc.account_type)})
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
                  Nominal Uang (Rp)
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
                  Tanggal Transaksi
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
                Catatan Singkat (Opsional)
              </label>
              <Input
                id="tx-note-input"
                placeholder="Contoh: Beli makan siang, bayar listrik, gaji..."
                {...register("note")}
              />
            </div>
          </div>

          {/* Footer - Border divider mentok ke container */}
          <div className="flex items-center justify-end gap-2 border-t border-border p-2.5 sm:px-6 bg-card/60 backdrop-blur-xs shrink-0">
            <ButtonSlideToConfirm
              key={isOpen ? `open-${editingTx?.id ?? "new"}` : "closed"}
              disabled={isSubmitting}
              label={
                editingTx
                  ? "Geser untuk Simpan Perubahan"
                  : "Geser untuk Simpan Transaksi"
              }
              onConfirm={handleSlideConfirm}
              onSuccessComplete={onClose}
            />
          </div>
        </form>
      </DrawerContent>
    </Drawer>
  );
};

