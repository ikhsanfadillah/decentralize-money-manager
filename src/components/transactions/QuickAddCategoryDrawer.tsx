import * as React from "react";
import { AlertCircle, Check, Loader2, TrendingDown, TrendingUp, X } from "lucide-react";
import { useReducedMotion } from "motion/react";
import type { CategoryKind, CategoryView } from "../../lib/tauri-api";
import { normalizeCategoryName } from "../../lib/web-core";
import { Input } from "../ui/input";
import {
  DrawerContent,
  DrawerDescription,
  DrawerNested,
  DrawerTitle,
} from "../ui/drawer";

const EXPENSE_CATEGORY_SUGGESTIONS = [
  "Makan & Minum",
  "Kopi & Jajan",
  "Transportasi",
  "Belanja",
  "Tagihan",
  "Hiburan",
  "Kesehatan",
  "Pendidikan",
];

const INCOME_CATEGORY_SUGGESTIONS = [
  "Gaji",
  "Bonus",
  "Freelance",
  "Bisnis",
  "Investasi",
  "Cashback",
  "Hadiah",
];

export interface QuickAddCategoryDrawerProps {
  isOpen: boolean;
  kind: CategoryKind;
  existingCategories: CategoryView[];
  isSaving?: boolean;
  onClose: () => void;
  onCreateCategory: (name: string) => Promise<void> | void;
  onSelectExistingCategory: (categoryId: string) => void;
}

export const QuickAddCategoryDrawer: React.FC<QuickAddCategoryDrawerProps> = ({
  isOpen,
  kind,
  existingCategories,
  isSaving = false,
  onClose,
  onCreateCategory,
  onSelectExistingCategory,
}) => {
  const shouldReduceMotion = useReducedMotion();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [name, setName] = React.useState("");

  React.useEffect(() => {
    if (isOpen) {
      setName("");
    }
  }, [isOpen, kind]);

  const trimmedName = name.trim();
  const normalizedInput = React.useMemo(
    () => (trimmedName ? normalizeCategoryName(trimmedName) : ""),
    [trimmedName]
  );

  const duplicateMatch = React.useMemo(() => {
    if (!normalizedInput) return null;
    return (
      existingCategories.find(
        (cat) => cat.normalized_name === normalizedInput
      ) ?? null
    );
  }, [existingCategories, normalizedInput]);

  const isMissingAlphanumeric =
    trimmedName.length > 0 && normalizedInput.length === 0;

  const availableSuggestions = React.useMemo(() => {
    const existingSet = new Set(
      existingCategories.map((cat) => cat.normalized_name)
    );
    const base =
      kind === "INCOME"
        ? INCOME_CATEGORY_SUGGESTIONS
        : EXPENSE_CATEGORY_SUGGESTIONS;
    return base.filter((item) => !existingSet.has(normalizeCategoryName(item)));
  }, [existingCategories, kind]);

  const canSubmit =
    !isSaving &&
    trimmedName.length > 0 &&
    !isMissingAlphanumeric &&
    !duplicateMatch;

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!canSubmit) return;
    void onCreateCategory(trimmedName);
  };

  return (
    <DrawerNested
      open={isOpen}
      onOpenChange={(open) => {
        if (!open && !isSaving) {
          onClose();
        }
      }}
      shouldScaleBackground={false}
    >
      <DrawerContent
        overlayClassName="z-[60]"
        aria-describedby="quick-add-category-desc"
        data-testid="quick-add-category-drawer"
        className="z-[60] w-full p-0 sm:mx-auto sm:max-w-md"
      >
        <form onSubmit={handleSubmit} className="flex flex-col">
          {/* Header */}
          <div className="flex items-start justify-between gap-3 border-b border-border/70 px-5 py-3.5">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <DrawerTitle className="text-sm font-bold text-foreground">
                  Tambah Kategori Baru
                </DrawerTitle>
                <span
                  className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                    kind === "INCOME"
                      ? "border-emerald-500/35 bg-emerald-500/12 text-emerald-800 dark:text-emerald-300"
                      : "border-rose-500/35 bg-rose-500/12 text-rose-800 dark:text-rose-300"
                  }`}
                >
                  {kind === "INCOME" ? (
                    <TrendingUp className="h-3 w-3 shrink-0" aria-hidden="true" />
                  ) : (
                    <TrendingDown className="h-3 w-3 shrink-0" aria-hidden="true" />
                  )}
                  <span>{kind === "INCOME" ? "Pemasukan" : "Pengeluaran"}</span>
                </span>
              </div>
              <DrawerDescription
                id="quick-add-category-desc"
                className="text-xs text-muted-foreground"
              >
                Kategori baru akan langsung dipilih untuk transaksi ini.
              </DrawerDescription>
            </div>

            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              aria-label="Tutup"
              className="nav-touch-item inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-black/[0.04] dark:bg-white/[0.06] text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50 transition-colors"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>

          {/* Body */}
          <div className="space-y-4 px-5 py-4">
            <div className="space-y-1.5">
              <label
                htmlFor="quick-add-category-input"
                className="block text-xs font-medium text-foreground"
              >
                Nama Kategori
              </label>
              <div className="relative">
                <Input
                  ref={inputRef}
                  id="quick-add-category-input"
                  data-testid="quick-add-category-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  disabled={isSaving}
                  autoFocus
                  placeholder={
                    kind === "INCOME"
                      ? "Contoh: Gaji, Bonus, Freelance..."
                      : "Contoh: Belanja Bulanan, Kopi, Hiburan..."
                  }
                  className="h-11 pr-11 text-xs"
                />
                {name && !isSaving && (
                  <button
                    type="button"
                    onClick={() => {
                      setName("");
                      inputRef.current?.focus();
                    }}
                    aria-label="Bersihkan nama kategori"
                    className="nav-touch-item absolute right-0 top-0 inline-flex h-11 w-11 items-center justify-center rounded-xl text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  >
                    <X className="h-4 w-4" aria-hidden="true" />
                  </button>
                )}
              </div>

              {isMissingAlphanumeric && (
                <p
                  role="alert"
                  className="flex items-center gap-1.5 text-xs text-rose-700 dark:text-rose-400"
                >
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>Nama kategori minimal mengandung 1 huruf atau angka.</span>
                </p>
              )}

              {duplicateMatch && (
                <div
                  role="status"
                  data-testid="quick-add-category-duplicate-alert"
                  className="flex items-center justify-between gap-2.5 rounded-xl border border-amber-700/40 bg-amber-500/12 px-3 py-2 text-xs"
                >
                  <span className="min-w-0 text-amber-900 dark:text-amber-200">
                    Kategori{" "}
                    <strong className="font-semibold">
                      &ldquo;{duplicateMatch.name}&rdquo;
                    </strong>{" "}
                    sudah tersedia.
                  </span>
                  <button
                    type="button"
                    onClick={() => onSelectExistingCategory(duplicateMatch.id)}
                    className="nav-touch-item inline-flex min-h-9 shrink-0 items-center gap-1 rounded-full bg-cta-surface px-3.5 text-xs font-semibold text-cta-foreground hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  >
                    <Check className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Pilih</span>
                  </button>
                </div>
              )}
            </div>

            {availableSuggestions.length > 0 && (
              <div className="space-y-2">
                <span className="block text-xs font-medium text-muted-foreground">
                  Saran cepat:
                </span>
                <div
                  className="flex flex-wrap gap-2"
                  data-testid="quick-add-category-suggestions"
                >
                  {availableSuggestions.map((suggestion) => {
                    const isSelected =
                      normalizedInput === normalizeCategoryName(suggestion);
                    return (
                      <button
                        key={suggestion}
                        type="button"
                        disabled={isSaving}
                        aria-pressed={isSelected}
                        onClick={() => {
                          setName(suggestion);
                          inputRef.current?.focus();
                        }}
                        className={`nav-touch-item inline-flex min-h-10 items-center rounded-full border px-3.5 py-1.5 text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50 ${
                          isSelected
                            ? "border-cta-surface bg-cta-surface font-semibold text-cta-foreground"
                            : "border-control-border/45 bg-black/[0.03] font-medium text-foreground hover:border-control-border hover:bg-muted dark:bg-white/[0.05]"
                        }`}
                      >
                        {suggestion}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center gap-2.5 border-t border-border/70 px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="nav-touch-item h-11 flex-1 rounded-full border border-control-border/45 bg-black/[0.04] dark:bg-white/[0.06] px-4 text-xs font-semibold text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50 transition-colors"
            >
              Batal
            </button>
            <button
              type="submit"
              data-testid="quick-add-category-submit-btn"
              disabled={!canSubmit}
              className="nav-touch-item inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-full bg-cta-surface px-4 text-xs font-bold text-cta-foreground hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:border disabled:border-control-border/40 disabled:bg-zinc-200 disabled:text-zinc-600 disabled:hover:opacity-100 dark:disabled:bg-zinc-800 dark:disabled:text-zinc-400 transition-colors"
            >
              {isSaving ? (
                <>
                  <Loader2
                    className={`h-4 w-4 shrink-0 ${shouldReduceMotion ? "" : "animate-spin"}`}
                    aria-hidden="true"
                  />
                  <span>Menyimpan...</span>
                </>
              ) : (
                <span>Simpan Kategori</span>
              )}
            </button>
          </div>
        </form>
      </DrawerContent>
    </DrawerNested>
  );
};

