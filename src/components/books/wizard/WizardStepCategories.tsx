import * as React from "react";
import { Check, Plus, RotateCcw } from "lucide-react";
import type { CategoryKind } from "../../../lib/tauri-api";
import { Input } from "../../ui/input";
import type { PresetCategoryOption } from "./wizard-presets";

export interface WizardStepCategoriesProps {
  categoryOptions: PresetCategoryOption[];
  selectedCategoryKeys: Set<string>;
  selectedCount: number;
  customCategoryKind: CategoryKind | null;
  customCategoryName: string;
  onToggleCategoryKey: (key: string) => void;
  onSelectAllCategories: () => void;
  onResetDefaultCategories: () => void;
  onOpenCustomCategoryKind: (kind: CategoryKind | null) => void;
  onCustomCategoryNameChange: (name: string) => void;
  onAddCustomCategory: () => void;
}

export const WizardStepCategories: React.FC<WizardStepCategoriesProps> = ({
  categoryOptions,
  selectedCategoryKeys,
  selectedCount,
  customCategoryKind,
  customCategoryName,
  onToggleCategoryKey,
  onSelectAllCategories,
  onResetDefaultCategories,
  onOpenCustomCategoryKind,
  onCustomCategoryNameChange,
  onAddCustomCategory,
}) => (
  <div className="space-y-4" data-testid="wizard-step-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span
        data-testid="selected-categories-count"
        className="rounded-full border border-zinc-900 bg-zinc-900 px-2.5 py-0.5 font-mono text-[11px] font-semibold text-white dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
      >
        {selectedCount} kategori dipilih
      </span>

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={onSelectAllCategories}
          className="nav-touch-item rounded-full border border-border bg-black/[0.03] px-2.5 py-1 text-[11px] font-medium text-foreground hover:bg-muted dark:bg-white/[0.05]"
        >
          Pilih Semua
        </button>
        <button
          type="button"
          onClick={onResetDefaultCategories}
          className="nav-touch-item inline-flex items-center gap-1 rounded-full border border-border bg-black/[0.03] px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground dark:bg-white/[0.05]"
        >
          <RotateCcw className="h-3 w-3" />
          <span>Reset</span>
        </button>
      </div>
    </div>

    {(
      [
        {
          kind: "EXPENSE" as CategoryKind,
          label: "Pos Pengeluaran",
          badgeColor: "text-rose-500 dark:text-rose-400",
        },
        {
          kind: "INCOME" as CategoryKind,
          label: "Pos Pemasukan",
          badgeColor: "text-emerald-600 dark:text-emerald-400",
        },
      ] as const
    ).map((section) => {
      const sectionItems = categoryOptions.filter(
        (c) => c.kind === section.kind
      );
      const isAddingCustomHere = customCategoryKind === section.kind;

      return (
        <div key={section.kind} className="space-y-2">
          <div className="flex items-center justify-between px-0.5">
            <span
              className={`font-mono text-[10px] font-semibold uppercase tracking-wider ${section.badgeColor}`}
            >
              {section.label}
            </span>
            <span className="text-[10px] text-muted-foreground">
              {
                sectionItems.filter((i) => selectedCategoryKeys.has(i.key))
                  .length
              }{" "}
              aktif
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {sectionItems.map((cat) => {
              const CatIcon = cat.icon;
              const isSelected = selectedCategoryKeys.has(cat.key);
              const isExpense = cat.kind === "EXPENSE";

              return (
                <button
                  key={cat.key}
                  type="button"
                  aria-pressed={isSelected}
                  data-testid={`wizard-category-chip-${cat.key}`}
                  onClick={() => onToggleCategoryKey(cat.key)}
                  className={`nav-touch-item flex items-center justify-between gap-2 rounded-2xl border px-3 py-2.5 text-left text-xs transition-all focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary ${
                    isSelected
                      ? "border-zinc-900 bg-zinc-900 font-semibold text-white dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
                      : "border-border bg-white/80 text-muted-foreground hover:bg-muted/60 hover:text-foreground dark:bg-white/[0.04]"
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <div
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-xl border transition-colors ${
                        isSelected
                          ? isExpense
                            ? "border-white/15 bg-white/15 text-rose-400"
                            : "border-white/15 bg-white/15 text-emerald-400"
                          : "border-border bg-black/[0.04] text-muted-foreground dark:bg-white/[0.06]"
                      }`}
                    >
                      <CatIcon className="h-3.5 w-3.5" />
                    </div>
                    <span className="truncate">{cat.name}</span>
                  </div>
                  <div
                    className={`flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full border transition-colors ${
                      isSelected
                        ? "border-white bg-white text-zinc-900"
                        : "border-border/80 bg-transparent"
                    }`}
                  >
                    {isSelected && (
                      <Check className="h-2.5 w-2.5 stroke-[3]" />
                    )}
                  </div>
                </button>
              );
            })}

            <button
              type="button"
              data-testid={`wizard-add-custom-category-${section.kind}`}
              onClick={() =>
                onOpenCustomCategoryKind(
                  isAddingCustomHere ? null : section.kind
                )
              }
              className="nav-touch-item flex items-center justify-center gap-1.5 rounded-2xl border border-dashed border-border bg-transparent px-3 py-2.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>+ Kustom</span>
            </button>
          </div>

          {isAddingCustomHere && (
            <div className="flex items-center gap-2 rounded-2xl border border-border bg-black/[0.03] p-2 dark:bg-white/[0.05]">
              <Input
                value={customCategoryName}
                onChange={(e) => onCustomCategoryNameChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    onAddCustomCategory();
                  }
                }}
                placeholder={`Nama kategori ${section.kind === "EXPENSE" ? "pengeluaran" : "pemasukan"}...`}
                aria-label={`Nama Kategori ${section.kind} Kustom`}
                className="h-8 text-xs"
                autoFocus
              />
              <button
                type="button"
                onClick={onAddCustomCategory}
                className="nav-touch-item shrink-0 rounded-xl bg-cta-surface px-3 py-1.5 text-xs font-semibold text-cta-foreground hover:opacity-90"
              >
                Tambah
              </button>
            </div>
          )}
        </div>
      );
    })}
  </div>
);

