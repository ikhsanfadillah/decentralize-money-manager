import * as React from "react";
import { useForm, Controller } from "react-hook-form";
import { CurrencyInput } from "../ui/currency-input";
import { Input } from "../ui/input";
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

  const { control, register, handleSubmit, watch, setValue, reset } =
    useForm<BudgetFormValues>({
      defaultValues: {
        categorySelection: defaultSelection,
        amountLimit: null,
        alertThresholdPct: "80",
      },
    });

  const selectedCategoryKey = watch("categorySelection");

  // Detect if budget for selected category + MONTHLY already exists -> automatically switch to edit mode (Section 9.5)
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

  if (!isOpen) {
    return null;
  }

  const onSubmit = async (values: BudgetFormValues) => {
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
        description: "Ambang peringatan harus bilangan bulat antara 1% hingga 100%.",
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
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="budget-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
    >
      <div className="tabular-grid-container w-full max-w-md shadow-none">
        <form
          onSubmit={handleSubmit(onSubmit)}
          className="tabular-grid-cell space-y-4 p-5"
        >
          <div className="flex items-center justify-between border-b border-border pb-3">
            <div>
              <h2
                id="budget-dialog-title"
                className="text-sm font-semibold text-foreground"
              >
                {matchedExistingBudget
                  ? "Edit Anggaran Bulanan"
                  : "Buat Anggaran Bulanan"}
              </h2>
              <p className="text-xs text-muted-foreground">
                {matchedExistingBudget
                  ? "Perbarui batas anggaran untuk kategori ini."
                  : "Tentukan batas pengeluaran untuk satu bulan."}
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

          <div className="space-y-1.5">
            <label
              htmlFor="budget-category-select"
              className="block text-xs font-medium text-foreground"
            >
              Cakupan Kategori Pengeluaran
            </label>
            <select
              id="budget-category-select"
              {...register("categorySelection")}
              className="flex h-9 w-full rounded-md border border-border bg-background px-3 py-1.5 text-xs text-foreground shadow-none focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
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
              className="block text-xs font-medium text-foreground"
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
            <label
              htmlFor="budget-threshold-input"
              className="block text-xs font-medium text-foreground"
            >
              Ingatkan Saya Saat Mencapai (%) — misal 80%
            </label>
            <Input
              id="budget-threshold-input"
              type="number"
              min={1}
              max={100}
              {...register("alertThresholdPct")}
              className="font-mono tabular-nums tracking-tight"
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
              disabled={isSaving}
              className="rounded-md border border-border bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow-none hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary disabled:opacity-50"
            >
              {isSaving
                ? "Menyimpan..."
                : matchedExistingBudget
                  ? "Simpan Perubahan"
                  : "Buat Anggaran"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

