import * as React from "react";
import { Check, RotateCcw } from "lucide-react";
import { formatCompactRupiah, formatRupiah } from "../../../lib/utils";
import { CurrencyInput } from "../../ui/currency-input";
import {
  TOTAL_BUDGET_QUICK_PILLS,
  type PresetCategoryOption,
} from "./wizard-presets";

export interface WizardStepBudgetProps {
  bookName: string;
  selectedAccountsCount: number;
  selectedCategoriesCount: number;
  selectedExpenseCategories: PresetCategoryOption[];
  activeAutoSplitCount: number;
  totalBudget: number | null;
  isAutoSplitEnabled: boolean;
  excludedBudgetCatKeys: Set<string>;
  hasManualOverridesOrExclusions: boolean;
  totalAllocatedCategoryBudgets: number;
  getEffectiveCategoryBudget: (catKey: string) => number;
  onTotalBudgetChange: (val: number | null) => void;
  onClearTotalBudget: () => void;
  onSelectTotalBudgetPill: (amount: number) => void;
  onToggleAutoSplit: () => void;
  onResetAutoSplitWeights: () => void;
  onToggleBudgetCategoryIncluded: (catKey: string) => void;
  onManualCategoryBudgetChange: (catKey: string, val: number | null) => void;
}

export const WizardStepBudget: React.FC<WizardStepBudgetProps> = ({
  bookName,
  selectedAccountsCount,
  selectedCategoriesCount,
  selectedExpenseCategories,
  activeAutoSplitCount,
  totalBudget,
  isAutoSplitEnabled,
  excludedBudgetCatKeys,
  hasManualOverridesOrExclusions,
  totalAllocatedCategoryBudgets,
  getEffectiveCategoryBudget,
  onTotalBudgetChange,
  onClearTotalBudget,
  onSelectTotalBudgetPill,
  onToggleAutoSplit,
  onResetAutoSplitWeights,
  onToggleBudgetCategoryIncluded,
  onManualCategoryBudgetChange,
}) => (
  <div className="space-y-4" data-testid="wizard-step-4">
    {/* 1. Total Monthly Budget Quick Pills + Input */}
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        <label
          htmlFor="wizard-total-budget-input"
          className="text-xs font-semibold text-foreground"
        >
          Target Total Pengeluaran Bulanan
        </label>
        {totalBudget && totalBudget > 0 ? (
          <button
            type="button"
            onClick={onClearTotalBudget}
            className="text-[11px] font-medium text-muted-foreground hover:text-foreground"
          >
            Kosongkan
          </button>
        ) : null}
      </div>

      {/* Quick Nominal Pills */}
      <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
        {TOTAL_BUDGET_QUICK_PILLS.map((pill) => {
          const isSelected = totalBudget === pill.value;
          return (
            <button
              key={pill.value}
              type="button"
              data-testid={`wizard-budget-pill-${pill.value}`}
              onClick={() => onSelectTotalBudgetPill(pill.value)}
              className={`nav-touch-item rounded-xl border py-2 px-2 font-mono text-xs font-semibold transition-all ${
                isSelected
                  ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
                  : "border-border bg-white/80 text-muted-foreground hover:bg-muted hover:text-foreground dark:bg-white/[0.04]"
              }`}
            >
              {pill.label}
            </button>
          );
        })}
      </div>

      <CurrencyInput
        id="wizard-total-budget-input"
        aria-label="Target Total Pengeluaran Bulanan"
        value={totalBudget}
        onValueChange={onTotalBudgetChange}
        placeholder="Atau ketik nominal anggaran bulanan..."
      />
    </div>

    {/* 2. Smart Auto-Split Section */}
    {selectedExpenseCategories.length > 0 &&
      totalBudget !== null &&
      totalBudget > 0 && (
        <div className="space-y-3 rounded-2xl border border-border bg-black/[0.02] p-3.5 dark:bg-white/[0.04]">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs font-bold text-foreground">
                Smart Auto-Split Kategori
              </p>
              <p className="text-[11px] text-muted-foreground">
                Otomatis dibagi proporsional ke pos pengeluaran Anda
              </p>
            </div>

            <button
              type="button"
              role="switch"
              aria-checked={isAutoSplitEnabled}
              data-testid="wizard-autosplit-toggle"
              onClick={onToggleAutoSplit}
              className={`nav-touch-item inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11px] font-semibold transition-colors ${
                isAutoSplitEnabled
                  ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                  : "border-border bg-muted text-muted-foreground"
              }`}
            >
              {isAutoSplitEnabled ? "Aktif" : "Nonaktif"}
            </button>
          </div>

          {isAutoSplitEnabled && (
            <>
              <div className="flex items-center justify-between border-y border-border/60 py-2 text-[11px]">
                <span className="text-muted-foreground">
                  Total alokasi kategori ({activeAutoSplitCount} pos):
                </span>
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold tabular-nums text-foreground">
                    {formatRupiah(totalAllocatedCategoryBudgets)}
                  </span>
                  {hasManualOverridesOrExclusions && (
                    <button
                      type="button"
                      onClick={onResetAutoSplitWeights}
                      title="Kembalikan ke perhitungan proporsional otomatis"
                      className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-2 py-0.5 text-[10px] font-medium text-muted-foreground hover:text-foreground"
                    >
                      <RotateCcw className="h-2.5 w-2.5" />
                      <span>Reset</span>
                    </button>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                {selectedExpenseCategories.map((cat) => {
                  const CatIcon = cat.icon;
                  const isIncluded = !excludedBudgetCatKeys.has(cat.key);
                  const effectiveAmt = getEffectiveCategoryBudget(cat.key);
                  const pctOfTotal =
                    totalBudget > 0 && isIncluded
                      ? Math.round((effectiveAmt / totalBudget) * 100)
                      : 0;

                  return (
                    <div
                      key={cat.key}
                      data-testid={`wizard-autosplit-row-${cat.key}`}
                      className={`flex flex-col gap-2 rounded-xl border p-2.5 transition-colors sm:flex-row sm:items-center sm:justify-between ${
                        isIncluded
                          ? "border-border bg-card"
                          : "border-border/50 bg-black/[0.01] opacity-60 dark:bg-white/[0.01]"
                      }`}
                    >
                      <div className="flex min-w-0 items-center justify-between gap-2 sm:flex-1">
                        <button
                          type="button"
                          onClick={() =>
                            onToggleBudgetCategoryIncluded(cat.key)
                          }
                          className="flex min-w-0 items-center gap-2 text-left"
                        >
                          <div
                            className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${
                              isIncluded
                                ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
                                : "border-border bg-transparent"
                            }`}
                          >
                            {isIncluded && (
                              <Check className="h-3 w-3 stroke-[3]" />
                            )}
                          </div>
                          <CatIcon className="h-3.5 w-3.5 shrink-0 text-rose-500" />
                          <span className="truncate text-xs font-semibold text-foreground">
                            {cat.name}
                          </span>
                        </button>

                        {isIncluded && (
                          <span className="shrink-0 rounded-full border border-border bg-muted px-2 py-0.5 font-mono text-[10px] font-semibold tabular-nums text-muted-foreground">
                            {pctOfTotal}%
                          </span>
                        )}
                      </div>

                      {isIncluded ? (
                        <div className="w-full sm:w-44">
                          <CurrencyInput
                            aria-label={`Anggaran ${cat.name}`}
                            value={effectiveAmt}
                            onValueChange={(val) =>
                              onManualCategoryBudgetChange(cat.key, val)
                            }
                            className="h-8 text-xs"
                          />
                        </div>
                      ) : (
                        <span className="text-[11px] text-muted-foreground">
                          Tidak dianggarkan
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}

    {/* Summary Preview Pill Box */}
    <div className="rounded-2xl border border-border/80 bg-black/[0.02] p-3.5 text-xs dark:bg-white/[0.04]">
      <p className="font-semibold text-foreground">
        Ringkasan Setup Buku &ldquo;{bookName.trim()}&rdquo;
      </p>
      <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
        <span className="rounded-full border border-border bg-card px-2.5 py-0.5 font-mono">
          {selectedAccountsCount} Akun
        </span>
        <span className="rounded-full border border-border bg-card px-2.5 py-0.5 font-mono">
          {selectedCategoriesCount} Kategori
        </span>
        <span className="rounded-full border border-border bg-card px-2.5 py-0.5 font-mono">
          {totalBudget && totalBudget > 0
            ? `Target ${formatCompactRupiah(totalBudget)}/bln`
            : "Tanpa Target Anggaran"}
        </span>
      </div>
    </div>
  </div>
);

