import * as React from "react";
import { useForm, Controller } from "react-hook-form";
import { Trash2, X } from "lucide-react";
import { CurrencyInput } from "../ui/currency-input";
import { Input } from "../ui/input";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from "../ui/drawer";
import type {
  BudgetProgressItem,
  CategoryView,
  UpsertBudgetInput,
} from "../../lib/tauri-api";
import { pushToast } from "../../lib/toast";

export interface BudgetDialogProps {
  isOpen: boolean;
  onClose: () => void;
  categories: CategoryView[];
  existingBudgets: BudgetProgressItem[];
  initialCategoryId?: string | null;
  onSave: (input: UpsertBudgetInput) => Promise<unknown>;
  onInitiateDelete?: (budget: BudgetProgressItem) => void;
  isSaving?: boolean;
}

interface BudgetFormValues {
  categorySelection: string; // "__ALL__" or category_id
  amountLimit: number | null;
  alertThresholdPct: string;
}

export const BudgetDialog: React.FC<BudgetDialogProps> = ({
  isOpen,
  onClose,
  categories,
  existingBudgets,
  initialCategoryId,
  onSave,
  onInitiateDelete,
  isSaving = false,
}) => {
  const expenseCategories = React.useMemo(
    () =>
      categories.filter(
        (c) => c.kind === "EXPENSE" && c.merged_into_id === null
      ),
    [categories]
  );

  const defaultSelection =
    initialCategoryId === undefined
      ? "__ALL__"
      : initialCategoryId === null
        ? "__ALL__"
        : initialCategoryId;

  const { control, register, getValues, watch, setValue, reset } =
    useForm<BudgetFormValues>({
      defaultValues: {
        categorySelection: defaultSelection,
        amountLimit: null,
        alertThresholdPct: "80",
      },
    });

  const selectedCategoryKey = watch("categorySelection");

  // Detect if budget for selected category + MONTHLY already exists -> automatically switch to edit mode
  const matchedExistingBudget = React.useMemo(() => {
    const targetCatId =
      selectedCategoryKey === "__ALL__" ? null : selectedCategoryKey;
    return (
      existingBudgets.find(
        (b) => (b.category_id ?? null) === targetCatId && b.period === "MONTHLY"
      ) ?? null
    );
  }, [existingBudgets, selectedCategoryKey]);

  React.useEffect(() => {
    if (!isOpen) {
      return;
    }
    const sel =
      initialCategoryId === undefined || initialCategoryId === null
        ? "__ALL__"
        : initialCategoryId;
    const targetCatId = sel === "__ALL__" ? null : sel;
    const found = existingBudgets.find(
      (b) => (b.category_id ?? null) === targetCatId && b.period === "MONTHLY"
    );
    reset({
      categorySelection: sel,
      amountLimit: found ? found.amount_limit : null,
      alertThresholdPct: found ? String(found.alert_threshold_pct) : "80",
    });
  }, [isOpen, initialCategoryId, existingBudgets, reset]);

  React.useEffect(() => {
    if (!isOpen) {
      return;
    }
    if (matchedExistingBudget) {
      setValue("amountLimit", matchedExistingBudget.amount_limit);
      setValue(
        "alertThresholdPct",
        String(matchedExistingBudget.alert_threshold_pct)
      );
    }
  }, [matchedExistingBudget, isOpen, setValue]);

  const handleDirectSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const values = getValues();
    if (values.amountLimit === null || values.amountLimit <= 0) {
      pushToast("Batas anggaran wajib diisi", {
        description: "Masukkan nominal batas anggaran lebih dari Rp 0.",
        variant: "error",
      });
      return;
    }

    const threshold = Number(values.alertThresholdPct);
    if (!Number.isInteger(threshold) || threshold < 1 || threshold > 100) {
      pushToast("Ambang peringatan tidak valid", {
        description:
          "Ambang peringatan harus bilangan bulat antara 1% hingga 100%.",
        variant: "error",
      });
      return;
    }

    const categoryId =
      values.categorySelection === "__ALL__" ? null : values.categorySelection;

    try {
      await onSave({
        category_id: categoryId,
        period: "MONTHLY",
        amount_limit: values.amountLimit,
        alert_threshold_pct: threshold,
      });
      pushToast(
        matchedExistingBudget
          ? "Anggaran berhasil diperbarui"
          : "Anggaran baru berhasil disimpan",
        { variant: "success" }
      );
      onClose();
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Gagal menyimpan anggaran";
      pushToast("Gagal menyimpan anggaran", {
        description: msg,
        variant: "error",
      });
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
      <DrawerContent className="max-h-[90vh] p-0 sm:mx-auto sm:max-w-lg">
        <form onSubmit={handleDirectSubmit} className="flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border/70 px-5 py-3.5">
            <div>
              <DrawerTitle
                id="budget-dialog-title"
                className="text-sm font-bold text-foreground"
              >
                {matchedExistingBudget
                  ? "Detail & Ubah Anggaran"
                  : "Atur Anggaran Bulanan"}
              </DrawerTitle>
              <DrawerDescription className="text-xs text-muted-foreground">
                {matchedExistingBudget
                  ? "Perbarui batas belanja bulanan dan ambang peringatan dini"
                  : "Tentukan batas pengeluaran bulanan dan ambang peringatan dini"}
              </DrawerDescription>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Tutup"
              className="nav-touch-item inline-flex h-8 w-8 items-center justify-center rounded-full border border-border bg-black/[0.04] dark:bg-white/[0.06] hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Form Body */}
          <div className="space-y-4 px-5 py-4">
            <div className="space-y-1.5">
              <label
                htmlFor="budget-category-select"
                className="text-xs font-medium text-foreground"
              >
                Cakupan Kategori Pengeluaran
              </label>
              <select
                id="budget-category-select"
                {...register("categorySelection")}
                className="flex h-10 w-full rounded-xl border border-border bg-black/[0.03] dark:bg-white/[0.06] px-3.5 text-xs text-foreground focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
              >
                <option value="__ALL__">
                  Semua pengeluaran (Total Pengeluaran Bulanan)
                </option>
                {expenseCategories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="budget-limit-input"
                className="text-xs font-medium text-foreground"
              >
                Batas Anggaran Bulanan (Rupiah)
              </label>
              <Controller
                name="amountLimit"
                control={control}
                render={({ field }) => (
                  <CurrencyInput
                    id="budget-limit-input"
                    aria-label="Batas Anggaran Bulanan"
                    value={field.value}
                    onValueChange={field.onChange}
                    onBlur={field.onBlur}
                    ref={field.ref}
                  />
                )}
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="budget-threshold-input"
                  className="text-xs font-medium text-foreground"
                >
                  Ambang Batas Peringatan (%)
                </label>
                <span className="text-[10px] text-muted-foreground">
                  Default: 80%
                </span>
              </div>
              <Input
                id="budget-threshold-input"
                type="number"
                min={1}
                max={100}
                {...register("alertThresholdPct")}
                className="font-mono tabular-nums tracking-tight"
              />
            </div>

            {/* Destructive Action inside Detail (Progressive Disclosure) */}
            {matchedExistingBudget && onInitiateDelete && (
              <div className="pt-2 border-t border-border/60">
                <button
                  type="button"
                  onClick={() => {
                    const target = matchedExistingBudget;
                    onClose();
                    onInitiateDelete(target);
                  }}
                  className="nav-touch-item flex w-full items-center justify-center gap-1.5 rounded-full border border-rose-500/25 bg-rose-500/10 py-2.5 text-xs font-medium text-rose-600 hover:bg-rose-500/15 active:scale-[0.99] dark:text-rose-400 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>Hapus Anggaran Ini</span>
                </button>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 border-t border-border/70 px-5 py-3">
            <button
              type="button"
              onClick={onClose}
              className="nav-touch-item rounded-full border border-border bg-black/[0.04] dark:bg-white/[0.06] px-4 py-2 text-xs font-medium text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="nav-touch-item rounded-full bg-cta-surface px-5 py-2 text-xs font-semibold text-cta-foreground hover:opacity-90 active:scale-[0.98] disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
            >
              {isSaving
                ? "Menyimpan..."
                : matchedExistingBudget
                  ? "Simpan Perubahan"
                  : "Simpan Anggaran"}
            </button>
          </div>
        </form>
      </DrawerContent>
    </Drawer>
  );
};
