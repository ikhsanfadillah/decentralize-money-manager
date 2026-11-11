import * as React from "react";
import { useForm, Controller } from "react-hook-form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  AlertCircle,
  ArrowLeft,
  ArrowLeftRight,
  Loader2,
  Plus,
  ScanText,
  Trash2,
  TrendingDown,
  TrendingUp,
  X,
} from "lucide-react";
import {
  SmartMagicInputBar,
  type SmartMagicInputActionState,
  type SmartMagicInputBarHandle,
} from "../ai/SmartMagicInputBar";
import { DeleteTransactionDrawer } from "./DeleteTransactionDrawer";
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
  formatRupiah,
  todayIsoDate,
} from "../../lib/utils";
import { formatDateReadable } from "../../lib/date";
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
  onDeleteTransaction?: (txId: string) => Promise<unknown> | void;
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
  onDeleteTransaction,
}) => {
  const [txPendingDelete, setTxPendingDelete] =
    React.useState<TransactionView | null>(null);
  const [isDeleting, setIsDeleting] = React.useState(false);
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
  const shouldReduceMotion = useReducedMotion();
  const magicInputRef = React.useRef<SmartMagicInputBarHandle>(null);
  const [magicActionState, setMagicActionState] =
    React.useState<SmartMagicInputActionState>({
      canSubmit: false,
      isParsing: false,
    });
  const [isAiModeOpen, setIsAiModeOpen] = React.useState(false);
  const [aiSuggestedCategory, setAiSuggestedCategory] = React.useState<{
    name: string;
    kind: "EXPENSE" | "INCOME";
  } | null>(null);
  const [isCreatingAiCategory, setIsCreatingAiCategory] = React.useState(false);
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
  const selectedTxDate = watch("txDate");

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
    setIsAiModeOpen(false);
    setAiSuggestedCategory(null);
    setMagicActionState({ canSubmit: false, isParsing: false });
  }, [isOpen, editingTx]);

  React.useEffect(() => {
    if (!isOpen) {
      setIsQuickAddCategory(false);
      setNewCategoryName("");
      return;
    }
    setTxPendingDelete(null);
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

  const handleConfirmDelete = async (txId: string) => {
    if (!onDeleteTransaction || isDeleting) return;
    setIsDeleting(true);
    try {
      await onDeleteTransaction(txId);
      pushToast("Transaksi berhasil dihapus", { variant: "info" });
      setTxPendingDelete(null);
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Gagal menghapus transaksi";
      pushToast("Gagal menghapus transaksi", {
        description: msg,
        variant: "error",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <>
      <Drawer
        open={isOpen}
        onOpenChange={(open) => {
          if (!open) {
            onClose();
          }
        }}
        shouldScaleBackground={false}
      >
        <DrawerContent className="h-[92dvh] max-h-[92dvh] w-full p-0 sm:mx-auto sm:h-auto sm:max-h-[90vh] sm:max-w-xl">
          <form
            onSubmit={(e) => e.preventDefault()}
            onKeyDown={(e) => {
              if (e.key === "Enter" && e.target instanceof HTMLInputElement) {
                e.preventDefault();
              }
            }}
            className="flex h-full sm:h-auto flex-1 flex-col overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border/70 px-5 py-3.5 shrink-0">
              <div>
                <DrawerTitle
                  id="tx-dialog-title"
                  className="text-sm font-bold text-foreground"
                >
                  {editingTx ? "Detail & Ubah Transaksi" : "Catat Transaksi Baru"}
                </DrawerTitle>
                <DrawerDescription className="mt-0.5 text-xs text-muted-foreground">
                  {editingTx
                    ? "Tinjau detail, ubah catatan, atau hapus transaksi ini."
                    : isAiModeOpen
                      ? "Tulis kalimat transaksi atau unggah struk untuk mengisi otomatis."
                      : "Pilih jenis transaksi dan isi nominal uangnya."}
                </DrawerDescription>
              </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Tutup"
              className="nav-touch-item inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-black/[0.04] dark:bg-white/[0.06] text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary transition-colors"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          {/* Scrollable Content Body with iOS Fluid View Morphing */}
          <div className="flex-1 overflow-y-auto overflow-x-hidden overscroll-contain px-5 py-4">
            <AnimatePresence mode="popLayout" initial={false}>
              {!editingTx && isAiModeOpen ? (
                <motion.div
                  key="ai-smart-view"
                  initial={
                    shouldReduceMotion
                      ? { opacity: 0 }
                      : { opacity: 0, scale: 0.96, y: 12 }
                  }
                  animate={
                    shouldReduceMotion
                      ? { opacity: 1 }
                      : { opacity: 1, scale: 1, y: 0 }
                  }
                  exit={
                    shouldReduceMotion
                      ? { opacity: 0 }
                      : { opacity: 0, scale: 0.96, y: 10 }
                  }
                  transition={
                    shouldReduceMotion
                      ? { duration: 0.01 }
                      : {
                          type: "spring",
                          stiffness: 380,
                          damping: 32,
                          mass: 0.8,
                        }
                  }
                >
                  <SmartMagicInputBar
                    ref={magicInputRef}
                    bookId={bookId}
                    accounts={accounts}
                    categories={categories}
                    hideSubmitButton
                    onActionStateChange={setMagicActionState}
                    onCloseAiMode={() => setIsAiModeOpen(false)}
                    onApplySingleDraft={(draft) => {
                      setValue("mode", draft.tx_type);
                      setValue("accountId", draft.account_id);
                      if (draft.tx_type === "TRANSFER" && draft.to_account_id) {
                        setValue("toAccountId", draft.to_account_id);
                      }
                      if (draft.category_id) {
                        setValue("categoryId", draft.category_id);
                      }
                      if (
                        draft.suggested_new_category &&
                        (draft.tx_type === "EXPENSE" ||
                          draft.tx_type === "INCOME")
                      ) {
                        setAiSuggestedCategory({
                          name: draft.suggested_new_category,
                          kind: draft.tx_type,
                        });
                      } else {
                        setAiSuggestedCategory(null);
                      }
                      setValue("rawAmount", Math.abs(draft.amount));
                      setValue("txDate", draft.tx_date);
                      setValue("note", draft.note);
                    }}
                    onSaveMultipleDrafts={async (inputs) => {
                      for (const inp of inputs) {
                        await onAddTransaction(inp);
                      }
                      pushToast(`${inputs.length} transaksi berhasil disimpan`, {
                        variant: "success",
                      });
                      onClose();
                    }}
                    onQuickCreateCategory={async (name, kind) => {
                      try {
                        const created = await tauriApi.upsertCategory(bookId, {
                          id: null,
                          name,
                          kind,
                        });
                        await queryClient.invalidateQueries({
                          queryKey: bookQueryKeys.categories(bookId),
                        });
                        setValue("categoryId", created.id);
                        pushToast(`Kategori "${name}" berhasil dibuat`, {
                          variant: "success",
                        });
                        return created.id;
                      } catch (err: unknown) {
                        pushToast(
                          err instanceof Error
                            ? err.message
                            : "Gagal membuat kategori",
                          { variant: "error" }
                        );
                        return null;
                      }
                    }}
                  />
                </motion.div>
              ) : (
                <motion.div
                  key="manual-form-view"
                  initial={
                    shouldReduceMotion
                      ? { opacity: 0 }
                      : { opacity: 0, scale: 0.97, y: -8 }
                  }
                  animate={
                    shouldReduceMotion
                      ? { opacity: 1 }
                      : { opacity: 1, scale: 1, y: 0 }
                  }
                  exit={
                    shouldReduceMotion
                      ? { opacity: 0 }
                      : { opacity: 0, scale: 0.97, y: -8 }
                  }
                  transition={
                    shouldReduceMotion
                      ? { duration: 0.01 }
                      : {
                          type: "spring",
                          stiffness: 380,
                          damping: 32,
                          mass: 0.8,
                        }
                  }
                  className="space-y-4"
                >
                  {/* Transaction Mode Selector */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 rounded-2xl bg-card">
                    {(
                      [
                        {
                          key: "EXPENSE",
                          label: "Pengeluaran",
                          color: "text-rose-700 dark:text-rose-400",
                          activeClass:
                            "border border-rose-600 bg-rose-500/15 text-rose-800 dark:border-rose-400/60 dark:text-rose-300",
                          icon: TrendingDown,
                        },
                        {
                          key: "INCOME",
                          label: "Pemasukan",
                          color: "text-emerald-700 dark:text-emerald-400",
                          activeClass:
                            "border border-emerald-700 bg-emerald-500/15 text-emerald-800 dark:border-emerald-400/60 dark:text-emerald-300",
                          icon: TrendingUp,
                        },
                        {
                          key: "TRANSFER",
                          label: "Pindah Saldo",
                          color: "text-sky-700 dark:text-sky-400",
                          activeClass:
                            "border border-sky-700 bg-sky-500/15 text-sky-800 dark:border-sky-400/60 dark:text-sky-300",
                          icon: ArrowLeftRight,
                        },
                        ...(!editingTx
                          ? [
                              {
                                key: "CROSS_BOOK_TRANSFER" as const,
                                label: "Pindah Buku",
                                color: "text-amber-700 dark:text-amber-400",
                                activeClass:
                                  "border border-amber-700 bg-amber-500/15 text-amber-800 dark:border-amber-400/60 dark:text-amber-300",
                                icon: ArrowLeftRight,
                              },
                            ]
                          : []),
                      ] as const
                    ).map((tab) => {
                      const active = currentMode === tab.key;
                      const IconComponent = tab.icon;
                      return (
                        <button
                          key={tab.key}
                          type="button"
                          onClick={() => setValue("mode", tab.key)}
                          className={`nav-touch-item inline-flex min-h-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-3 py-2 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
                            active
                              ? tab.activeClass
                              : "border border-control-border/50 text-foreground hover:bg-muted/60"
                          }`}
                        >
                          <IconComponent
                            className={`h-3.5 w-3.5 shrink-0 ${active ? "" : tab.color}`}
                            aria-hidden="true"
                          />
                          <span>{tab.label}</span>
                        </button>
                      );
                    })}
                  </div>

                  {/* Suggested New Category Banner (when returning from Single Draft Auto-fill) */}
                  {aiSuggestedCategory &&
                    (currentMode === "EXPENSE" || currentMode === "INCOME") && (
                      <div className="flex items-center justify-between gap-2 rounded-xl border border-control-border bg-primary/5 px-3 py-2 text-xs">
                        <span className="text-muted-foreground">
                          Kategori baru yang disarankan:{" "}
                          <strong className="text-foreground">
                            {aiSuggestedCategory.name}
                          </strong>
                        </span>
                        <button
                          type="button"
                          disabled={isCreatingAiCategory}
                          onClick={async () => {
                            setIsCreatingAiCategory(true);
                            try {
                              const created = await tauriApi.upsertCategory(
                                bookId,
                                {
                                  id: null,
                                  name: aiSuggestedCategory.name,
                                  kind: aiSuggestedCategory.kind,
                                }
                              );
                              await queryClient.invalidateQueries({
                                queryKey: bookQueryKeys.categories(bookId),
                              });
                              setValue("categoryId", created.id);
                              setAiSuggestedCategory(null);
                              pushToast(
                                `Kategori "${aiSuggestedCategory.name}" berhasil dibuat`,
                                { variant: "success" }
                              );
                            } catch (err: unknown) {
                              pushToast(
                                err instanceof Error
                                  ? err.message
                                  : "Gagal membuat kategori",
                                { variant: "error" }
                              );
                            } finally {
                              setIsCreatingAiCategory(false);
                            }
                          }}
                          className="nav-touch-item inline-flex min-h-11 shrink-0 items-center gap-1 rounded-xl bg-primary/15 px-3.5 text-xs font-semibold text-foreground hover:bg-primary/25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-60"
                        >
                          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                          <span>
                            {isCreatingAiCategory
                              ? "Membuat..."
                              : "Buat & Pilih"}
                          </span>
                        </button>
                      </div>
                    )}

                  <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                    <div className="space-y-1.5">
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
                        disabled={activeAccounts.length === 0}
                        {...register("accountId")}
                        className="flex h-11 w-full rounded-xl border border-control-border bg-black/[0.03] dark:bg-white/[0.06] px-3.5 py-2 text-xs text-foreground shadow-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-60"
                      >
                        {activeAccounts.length === 0 ? (
                          <option value="">-- Belum ada rekening aktif --</option>
                        ) : (
                          activeAccounts.map((acc) => (
                            <option key={acc.id} value={acc.id}>
                              {acc.name} ({formatAccountTypeLabel(acc.account_type)})
                            </option>
                          ))
                        )}
                      </select>
                      {activeAccounts.length === 0 && (
                        <p className="text-xs text-amber-800 dark:text-amber-300">
                          Belum ada rekening aktif di buku ini. Tambahkan rekening terlebih dahulu di halaman Rekening.
                        </p>
                      )}
                    </div>

                    {currentMode === "TRANSFER" && (
                      <div className="space-y-1.5">
                        <label
                          htmlFor="tx-to-account-select"
                          className="block text-xs font-medium text-foreground"
                        >
                          Ke Rekening / Dompet Tujuan
                        </label>
                        <select
                          id="tx-to-account-select"
                          disabled={activeAccounts.length < 2}
                          {...register("toAccountId")}
                          className="flex h-11 w-full rounded-xl border border-control-border bg-black/[0.03] dark:bg-white/[0.06] px-3.5 py-2 text-xs text-foreground shadow-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-60"
                        >
                          <option value="">-- Pilih Tujuan --</option>
                          {activeAccounts.map((acc) => (
                            <option key={acc.id} value={acc.id}>
                              {acc.name} ({formatAccountTypeLabel(acc.account_type)})
                            </option>
                          ))}
                        </select>
                        {activeAccounts.length < 2 && (
                          <p className="text-xs text-muted-foreground">
                            Pindah saldo membutuhkan minimal 2 rekening aktif.
                          </p>
                        )}
                      </div>
                    )}

                    {(currentMode === "EXPENSE" || currentMode === "INCOME") && (
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
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
                              className="nav-touch-item inline-flex min-h-11 items-center gap-1 rounded-xl px-2.5 text-xs font-semibold text-primary hover:bg-muted hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                            >
                              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                              <span>Kategori Baru</span>
                            </button>
                          )}
                        </div>

                        {isQuickAddCategory ? (
                          <div className="rounded-xl border border-control-border bg-primary/10 p-3 space-y-2">
                            <label
                              htmlFor="tx-new-category-input"
                              className="block text-xs font-medium text-foreground"
                            >
                              Tambah Kategori {currentMode === "EXPENSE" ? "Pengeluaran" : "Pemasukan"} Baru:
                            </label>
                            <div className="flex items-center gap-2">
                              <Input
                                id="tx-new-category-input"
                                value={newCategoryName}
                                onChange={(e) => setNewCategoryName(e.target.value)}
                                placeholder="Contoh: Belanja Bulanan, Kopi, Hiburan..."
                                className="h-11 text-xs"
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
                                className="nav-touch-item shrink-0 h-11 px-3.5 rounded-xl bg-cta-surface text-cta-foreground text-xs font-semibold hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:border disabled:border-control-border disabled:bg-zinc-200 disabled:text-zinc-700 dark:disabled:bg-zinc-800 dark:disabled:text-zinc-300"
                              >
                                {isAddingCategory ? "..." : "Simpan"}
                              </button>
                              <button
                                type="button"
                                onClick={() => setIsQuickAddCategory(false)}
                                className="nav-touch-item shrink-0 h-11 px-3 rounded-full bg-black/[0.04] dark:bg-white/[0.06] text-foreground text-xs font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                              >
                                Batal
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
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
                              className="flex h-11 w-full rounded-xl border border-control-border bg-black/[0.03] dark:bg-white/[0.06] px-3.5 py-2 text-xs text-foreground shadow-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                            >
                              <option value="">-- Pilih Kategori --</option>
                              {filteredCategories.map((cat) => (
                                <option key={cat.id} value={cat.id}>
                                  {cat.name}
                                </option>
                              ))}
                              <option value="__NEW__">+ Tambah Kategori Baru...</option>
                            </select>
                            {filteredCategories.length === 0 && (
                              <p className="text-xs text-muted-foreground">
                                Belum ada kategori. Pilih Kategori Baru untuk membuat.
                              </p>
                            )}
                          </>
                        )}
                      </div>
                    )}

                    {currentMode === "CROSS_BOOK_TRANSFER" && (
                      <div className="space-y-1.5">
                        <label
                          htmlFor="tx-to-book-select"
                          className="block text-xs font-medium text-foreground"
                        >
                          Ke Buku Tujuan
                        </label>
                        <select
                          id="tx-to-book-select"
                          disabled={booksQuery.isLoading || otherBooks.length === 0}
                          {...register("toBookId")}
                          className="flex h-11 w-full rounded-xl border border-control-border bg-black/[0.03] dark:bg-white/[0.06] px-3.5 py-2 text-xs text-foreground shadow-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-60"
                        >
                          <option value="">
                            {booksQuery.isLoading
                              ? "Memuat daftar buku..."
                              : "-- Pilih Buku Tujuan --"}
                          </option>
                          {otherBooks.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.name}
                            </option>
                          ))}
                        </select>
                        {booksQuery.isError ? (
                          <p role="alert" className="flex items-center gap-1.5 text-xs text-rose-700 dark:text-rose-400">
                            <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                            <span>Gagal memuat daftar buku tujuan.</span>
                          </p>
                        ) : !booksQuery.isLoading && otherBooks.length === 0 ? (
                          <p className="text-xs text-muted-foreground">
                            Belum ada buku lain sebagai tujuan transfer.
                          </p>
                        ) : null}
                      </div>
                    )}
                  </div>

                  {currentMode === "CROSS_BOOK_TRANSFER" && (
                    <div className="space-y-1.5">
                      <label
                        htmlFor="tx-to-book-account-select"
                        className="block text-xs font-medium text-foreground"
                      >
                        Rekening di Buku Tujuan
                      </label>
                      <select
                        id="tx-to-book-account-select"
                        disabled={
                          !selectedToBookId ||
                          destBookAccountsQuery.isLoading ||
                          destBookAccounts.length === 0
                        }
                        {...register("toBookAccountId")}
                        className="flex h-11 w-full rounded-xl border border-control-border bg-black/[0.03] dark:bg-white/[0.06] px-3.5 py-2 text-xs text-foreground shadow-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-60"
                      >
                        <option value="">
                          {destBookAccountsQuery.isLoading
                            ? "Memuat rekening buku tujuan..."
                            : "-- Pilih Rekening Buku Tujuan --"}
                        </option>
                        {destBookAccounts.map((acc) => (
                          <option key={acc.id} value={acc.id}>
                            {acc.name} ({formatAccountTypeLabel(acc.account_type)})
                          </option>
                        ))}
                      </select>
                      {destBookAccountsQuery.isError ? (
                        <p role="alert" className="flex items-center gap-1.5 text-xs text-rose-700 dark:text-rose-400">
                          <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          <span>Gagal memuat rekening buku tujuan.</span>
                        </p>
                      ) : selectedToBookId &&
                        !destBookAccountsQuery.isLoading &&
                        destBookAccounts.length === 0 ? (
                        <p className="text-xs text-muted-foreground">
                          Buku tujuan belum memiliki rekening aktif.
                        </p>
                      ) : null}
                    </div>
                  )}

                  <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                    <div className="space-y-1.5">
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

                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <label
                          htmlFor="tx-date-input"
                          className="block text-xs font-medium text-foreground"
                        >
                          Tanggal Transaksi
                        </label>
                        {selectedTxDate && (
                          <span className="text-xs font-medium text-primary">
                            {formatDateReadable(selectedTxDate, { withDayName: true })}
                          </span>
                        )}
                      </div>
                      <Input
                        id="tx-date-input"
                        type="date"
                        {...register("txDate")}
                        className="font-mono tabular-nums tracking-tight"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
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

                  {/* Destructive Action inside Detail (Progressive Disclosure) */}
                  {editingTx && onDeleteTransaction && (
                    <div className="pt-2 border-t border-border/60">
                      <button
                        type="button"
                        data-testid="tx-detail-delete-button"
                        onClick={() => {
                          const target = editingTx;
                          onClose();
                          setTxPendingDelete(target);
                        }}
                        className="nav-touch-item flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-rose-700/40 bg-rose-500/12 py-2.5 text-xs font-semibold text-rose-800 hover:bg-rose-500/20 dark:border-rose-400/50 dark:text-rose-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary transition-colors"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                        <span>Hapus Transaksi Ini</span>
                      </button>
                    </div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Footer: Primary CTA (Slide or Proses & Isi Otomatis) + Mode Toggle / Back */}
          <div className="flex items-center gap-2.5 border-t border-border/70 px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5 shrink-0">
            {!editingTx && (
              <motion.button
                type="button"
                data-testid="toggle-ai-magic-mode-btn"
                onClick={() => setIsAiModeOpen((prev) => !prev)}
                whileTap={shouldReduceMotion ? undefined : { scale: 0.92 }}
                aria-label={
                  isAiModeOpen
                    ? "Kembali ke Form Manual"
                    : "Buka Isi Otomatis dari Teks & Struk"
                }
                title={
                  isAiModeOpen
                    ? "Kembali ke Form Manual"
                    : "Isi Otomatis dari Teks & Struk"
                }
                className={`bg-muted border-border relative inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
                  isAiModeOpen
                    ? "text-foreground"
                    : "hover:opacity-90"
                }`}
              >
                <AnimatePresence mode="wait" initial={false}>
                  {isAiModeOpen ? (
                    <motion.span
                      key="close-ai-icon"
                      initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.6 }}
                      animate={shouldReduceMotion ? { opacity: 1 } : { opacity: 1, scale: 1 }}
                      exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.6 }}
                      transition={
                        shouldReduceMotion
                          ? { duration: 0.01 }
                          : {
                              type: "spring",
                              stiffness: 420,
                              damping: 28,
                            }
                      }
                      className="inline-flex items-center justify-center"
                    >
                      <ArrowLeft className="h-5 w-5" aria-hidden="true" />
                    </motion.span>
                  ) : (
                    <motion.span
                      key="open-ai-icon"
                      initial={
                        shouldReduceMotion
                          ? { opacity: 0 }
                          : { opacity: 0, scale: 0.6 }
                      }
                      animate={
                        shouldReduceMotion
                          ? { opacity: 1 }
                          : { opacity: 1, scale: 1 }
                      }
                      exit={
                        shouldReduceMotion
                          ? { opacity: 0 }
                          : { opacity: 0, scale: 0.6 }
                      }
                      transition={
                        shouldReduceMotion
                          ? { duration: 0.01 }
                          : {
                              type: "spring",
                              stiffness: 420,
                              damping: 28,
                            }
                      }
                      className="inline-flex items-center justify-center"
                    >
                      <ScanText className="h-5 w-5" aria-hidden="true" />
                    </motion.span>
                  )}
                </AnimatePresence>
              </motion.button>
            )}
            <div className="flex-1 min-w-0">
              <AnimatePresence mode="popLayout" initial={false}>
                {!editingTx && isAiModeOpen ? (
                  <motion.button
                    key="ai-submit-btn"
                    type="button"
                    data-testid="magic-input-submit-btn"
                    disabled={magicActionState.isParsing || !magicActionState.canSubmit}
                    onClick={() => magicInputRef.current?.submit()}
                    initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -6 }}
                    transition={{ duration: shouldReduceMotion ? 0.01 : 0.16 }}
                    className="nav-touch-item flex h-12 w-full items-center justify-center gap-2 rounded-full bg-cta-surface px-4 text-xs font-bold text-cta-foreground hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:border disabled:border-none disabled:bg-zinc-200 disabled:text-zinc-700 disabled:hover:opacity-100 dark:disabled:bg-zinc-800 dark:disabled:text-zinc-300 transition-colors"
                  >
                    {magicActionState.isParsing ? (
                      <>
                        <Loader2
                          className={`h-4 w-4 shrink-0 ${shouldReduceMotion ? "" : "animate-spin"}`}
                          aria-hidden="true"
                        />
                        <span>Membaca transaksi...</span>
                      </>
                    ) : (
                      <span>Proses &amp; Isi Otomatis</span>
                    )}
                  </motion.button>
                ) : (
                  <motion.div
                    key="slide-to-confirm-wrapper"
                    initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -6 }}
                    transition={{ duration: shouldReduceMotion ? 0.01 : 0.16 }}
                  >
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
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

          </div>
        </form>
      </DrawerContent>
    </Drawer>

    <DeleteTransactionDrawer
      tx={txPendingDelete}
      isDeleting={isDeleting}
      onClose={() => {
        if (!isDeleting) {
          setTxPendingDelete(null);
        }
      }}
      onConfirmDelete={(txId) => void handleConfirmDelete(txId)}
    />
    </>
  );
};

