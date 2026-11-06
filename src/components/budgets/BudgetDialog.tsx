import * as React from "react";
import { useForm, Controller } from "react-hook-form";
import { X } from "lucide-react";
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

  const handleSlideConfirm = async (): Promise<SlideConfirmResult> => {
    const values = getValues();
    if (values.amountLimit === null || values.amountLimit <= 0) {
      pushToast("Batas anggaran wajib diisi", {
        description: "Masukkan nominal batas anggaran lebih dari Rp 0.",
        variant: "error",
      });
      return { ok: false, message: "Nominal batas anggaran wajib diisi" };
    }

    const threshold = Number(values.alertThresholdPct);
    if (!Number.isInteger(threshold) || threshold < 1 || threshold > 100) {
      pushToast("Ambang peringatan tidak valid", {
        description:
          "Ambang peringatan harus bilangan bulat antara 1% hingga 100%.",
        variant: "error",
      });
      return { ok: false, message: "Ambang peringatan harus 1% - 100%" };
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
      return { ok: true };
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Gagal menyimpan anggaran";
      pushToast("Gagal menyimpan anggaran", {
        description: msg,
        variant: "error",
      });
      return { ok: false, message: "Gagal Menyimpan Anggaran" };
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
                id="budget-dialog-title"
                className="text-sm font-semibold text-foreground"
              >
                {matchedExistingBudget
                  ? "Edit Anggaran Bulanan"
                  : "Atur Anggaran Bulanan Baru"}
              </DrawerTitle>
              <DrawerDescription className="mt-0.5 text-xs text-muted-foreground">
                {matchedExistingBudget
                  ? "Perbarui batas anggaran belanja dan ambang peringatan dini."
                  : "Tentukan batas pengeluaran untuk satu bulan dan ambang peringatan dini."}
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

          {/* Scrollable Content */}
          <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6 space-y-4">
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
          </div>

          {/* Footer with ButtonSlideToConfirm */}
          <div className="flex items-center justify-end gap-2 border-t border-border p-2.5 sm:px-6 bg-card/60 backdrop-blur-xs shrink-0">
            <ButtonSlideToConfirm
              key={
                isOpen
                  ? `budget-${selectedCategoryKey}-${matchedExistingBudget?.id ?? "new"}`
                  : "closed"
              }
              disabled={isSaving}
              label={
                matchedExistingBudget
                  ? "Geser untuk Perbarui Anggaran"
                  : "Geser untuk Simpan Anggaran"
              }
              readyLabel="Lepas untuk Simpan"
              loadingLabel="Menyimpan Anggaran..."
              successLabel={
                matchedExistingBudget
                  ? "Anggaran Diperbarui!"
                  : "Anggaran Disimpan!"
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
