import * as React from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  TrendingDown,
  TrendingUp,
  X,
} from "lucide-react";
import {
  tauriApi,
  type AccountType,
  type BookMetadata,
  type CategoryKind,
  type CategoryView,
} from "../../lib/tauri-api";
import { DEFAULT_CASH_ACCOUNT_ID } from "../../lib/web-core";
import { pushToast } from "../../lib/toast";
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
import { WizardStepAccounts } from "./wizard/WizardStepAccounts";
import { WizardStepBookName } from "./wizard/WizardStepBookName";
import { WizardStepBudget } from "./wizard/WizardStepBudget";
import { WizardStepCategories } from "./wizard/WizardStepCategories";
import {
  BOOK_NAME_SUGGESTIONS,
  PRESET_ACCOUNT_OPTIONS,
  PRESET_CATEGORY_OPTIONS,
  STEP_META,
  TOTAL_BUDGET_QUICK_PILLS,
  computeSmartBudgetAllocations,
  type PresetAccountOption,
  type PresetCategoryOption,
  type WeightedCategoryAllocation,
  type WizardStep,
} from "./wizard/wizard-presets";

export {
  BOOK_NAME_SUGGESTIONS,
  PRESET_ACCOUNT_OPTIONS,
  PRESET_CATEGORY_OPTIONS,
  TOTAL_BUDGET_QUICK_PILLS,
  computeSmartBudgetAllocations,
  type PresetAccountOption,
  type PresetCategoryOption,
  type WeightedCategoryAllocation,
  type WizardStep,
};

export interface BookSetupWizardDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onBookCreated: (book: BookMetadata) => void;
}

export const BookSetupWizardDrawer: React.FC<BookSetupWizardDrawerProps> = ({
  open,
  onOpenChange,
  onBookCreated,
}) => {
  const [step, setStep] = React.useState<WizardStep>(1);
  const [bookName, setBookName] = React.useState("");
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const pendingCreatedBookRef = React.useRef<BookMetadata | null>(null);

  // Step 2: Accounts state
  const [accountOptions, setAccountOptions] = React.useState<
    PresetAccountOption[]
  >(() => PRESET_ACCOUNT_OPTIONS);
  const [selectedAccountKeys, setSelectedAccountKeys] = React.useState<
    Set<string>
  >(
    () =>
      new Set(
        PRESET_ACCOUNT_OPTIONS.filter((a) => a.defaultSelected).map(
          (a) => a.key
        )
      )
  );
  const [customAccountGroup, setCustomAccountGroup] =
    React.useState<AccountType | null>(null);
  const [customAccountName, setCustomAccountName] = React.useState("");

  // Step 3: Categories state
  const [categoryOptions, setCategoryOptions] = React.useState<
    PresetCategoryOption[]
  >(() => PRESET_CATEGORY_OPTIONS);
  const [selectedCategoryKeys, setSelectedCategoryKeys] = React.useState<
    Set<string>
  >(
    () =>
      new Set(
        PRESET_CATEGORY_OPTIONS.filter((c) => c.defaultSelected).map(
          (c) => c.key
        )
      )
  );
  const [customCategoryKind, setCustomCategoryKind] =
    React.useState<CategoryKind | null>(null);
  const [customCategoryName, setCustomCategoryName] = React.useState("");

  // Step 4: Budgets state
  const [totalBudget, setTotalBudget] = React.useState<number | null>(null);
  const [isAutoSplitEnabled, setIsAutoSplitEnabled] =
    React.useState<boolean>(true);
  const [excludedBudgetCatKeys, setExcludedBudgetCatKeys] = React.useState<
    Set<string>
  >(() => new Set());
  const [manualCategoryAmounts, setManualCategoryAmounts] = React.useState<
    Record<string, number>
  >({});

  // Reset wizard state whenever drawer closes
  const resetWizardState = React.useCallback(() => {
    setStep(1);
    setBookName("");
    setIsSubmitting(false);
    setAccountOptions(PRESET_ACCOUNT_OPTIONS);
    setSelectedAccountKeys(
      new Set(
        PRESET_ACCOUNT_OPTIONS.filter((a) => a.defaultSelected).map(
          (a) => a.key
        )
      )
    );
    setCustomAccountGroup(null);
    setCustomAccountName("");
    setCategoryOptions(PRESET_CATEGORY_OPTIONS);
    setSelectedCategoryKeys(
      new Set(
        PRESET_CATEGORY_OPTIONS.filter((c) => c.defaultSelected).map(
          (c) => c.key
        )
      )
    );
    setCustomCategoryKind(null);
    setCustomCategoryName("");
    setTotalBudget(null);
    setIsAutoSplitEnabled(true);
    setExcludedBudgetCatKeys(new Set());
    setManualCategoryAmounts({});
  }, []);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && isSubmitting) {
      return;
    }
    onOpenChange(nextOpen);
    if (!nextOpen) {
      resetWizardState();
    }
  };

  // Derived selected items
  const selectedAccounts = React.useMemo(
    () => accountOptions.filter((a) => selectedAccountKeys.has(a.key)),
    [accountOptions, selectedAccountKeys]
  );

  const selectedCategories = React.useMemo(
    () => categoryOptions.filter((c) => selectedCategoryKeys.has(c.key)),
    [categoryOptions, selectedCategoryKeys]
  );

  const selectedExpenseCategories = React.useMemo(
    () => selectedCategories.filter((c) => c.kind === "EXPENSE"),
    [selectedCategories]
  );

  const activeAutoSplitCategories = React.useMemo(
    () =>
      selectedExpenseCategories.filter(
        (c) => !excludedBudgetCatKeys.has(c.key)
      ),
    [selectedExpenseCategories, excludedBudgetCatKeys]
  );

  const computedAllocations = React.useMemo(
    () =>
      computeSmartBudgetAllocations(
        totalBudget ?? 0,
        activeAutoSplitCategories
      ),
    [totalBudget, activeAutoSplitCategories]
  );

  const computedAllocationMap = React.useMemo(() => {
    const map = new Map<string, WeightedCategoryAllocation>();
    for (const item of computedAllocations) {
      map.set(item.key, item);
    }
    return map;
  }, [computedAllocations]);

  const getEffectiveCategoryBudget = React.useCallback(
    (catKey: string): number => {
      if (excludedBudgetCatKeys.has(catKey)) {
        return 0;
      }
      if (catKey in manualCategoryAmounts) {
        return manualCategoryAmounts[catKey];
      }
      return computedAllocationMap.get(catKey)?.amount ?? 0;
    },
    [excludedBudgetCatKeys, manualCategoryAmounts, computedAllocationMap]
  );

  const totalAllocatedCategoryBudgets = React.useMemo(() => {
    return activeAutoSplitCategories.reduce(
      (sum, cat) => sum + getEffectiveCategoryBudget(cat.key),
      0
    );
  }, [activeAutoSplitCategories, getEffectiveCategoryBudget]);

  // Handlers for Step 2 (Accounts)
  const toggleAccountKey = (key: string) => {
    setSelectedAccountKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const handleAddCustomAccount = () => {
    if (!customAccountGroup) return;
    const trimmed = customAccountName.trim();
    if (!trimmed) {
      pushToast("Nama akun kustom tidak boleh kosong", { variant: "warning" });
      return;
    }
    const existing = accountOptions.find(
      (a) =>
        a.accountType === customAccountGroup &&
        a.name.toLowerCase() === trimmed.toLowerCase()
    );
    if (existing) {
      setSelectedAccountKeys((prev) => new Set(prev).add(existing.key));
      setCustomAccountName("");
      setCustomAccountGroup(null);
      return;
    }
    const newKey = `custom-acc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const newOption: PresetAccountOption = {
      key: newKey,
      name: trimmed,
      accountType: customAccountGroup,
      isCustom: true,
    };
    setAccountOptions((prev) => [...prev, newOption]);
    setSelectedAccountKeys((prev) => new Set(prev).add(newKey));
    setCustomAccountName("");
    setCustomAccountGroup(null);
  };

  // Handlers for Step 3 (Categories)
  const toggleCategoryKey = (key: string) => {
    setSelectedCategoryKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const handleSelectAllCategories = () => {
    setSelectedCategoryKeys(new Set(categoryOptions.map((c) => c.key)));
  };

  const handleResetDefaultCategories = () => {
    setSelectedCategoryKeys(
      new Set(
        categoryOptions.filter((c) => c.defaultSelected).map((c) => c.key)
      )
    );
  };

  const handleAddCustomCategory = () => {
    if (!customCategoryKind) return;
    const trimmed = customCategoryName.trim();
    if (!trimmed) {
      pushToast("Nama kategori kustom tidak boleh kosong", {
        variant: "warning",
      });
      return;
    }
    const existing = categoryOptions.find(
      (c) =>
        c.kind === customCategoryKind &&
        c.name.toLowerCase() === trimmed.toLowerCase()
    );
    if (existing) {
      setSelectedCategoryKeys((prev) => new Set(prev).add(existing.key));
      setCustomCategoryName("");
      setCustomCategoryKind(null);
      return;
    }
    const newKey = `custom-cat-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const newOption: PresetCategoryOption = {
      key: newKey,
      name: trimmed,
      kind: customCategoryKind,
      icon: customCategoryKind === "EXPENSE" ? TrendingDown : TrendingUp,
      defaultSelected: false,
      budgetWeight: customCategoryKind === "EXPENSE" ? 12 : 0,
      isCustom: true,
    };
    setCategoryOptions((prev) => [...prev, newOption]);
    setSelectedCategoryKeys((prev) => new Set(prev).add(newKey));
    setCustomCategoryName("");
    setCustomCategoryKind(null);
  };

  // Handlers for Step 4 (Budgets)
  const handleSelectTotalBudgetPill = (amount: number) => {
    setTotalBudget(amount);
    setManualCategoryAmounts({});
  };

  const toggleBudgetCategoryIncluded = (catKey: string) => {
    setExcludedBudgetCatKeys((prev) => {
      const next = new Set(prev);
      if (next.has(catKey)) {
        next.delete(catKey);
      } else {
        next.add(catKey);
      }
      return next;
    });
  };

  const handleManualCategoryBudgetChange = (
    catKey: string,
    val: number | null
  ) => {
    setManualCategoryAmounts((prev) => ({
      ...prev,
      [catKey]: val && val > 0 ? val : 0,
    }));
  };

  const handleResetAutoSplitWeights = () => {
    setManualCategoryAmounts({});
    setExcludedBudgetCatKeys(new Set());
  };

  /**
   * Executes book creation and seeds accounts, categories, and budgets up to `maxSeededStep`.
   */
  const executeCreateAndSeedBook = async (
    maxSeededStep: WizardStep
  ): Promise<BookMetadata> => {
    const trimmedBookName = bookName.trim();
    if (!trimmedBookName) {
      throw new Error("Nama buku tidak boleh kosong");
    }

    setIsSubmitting(true);
    try {
      const createdBook = await tauriApi.createBook(
        trimmedBookName,
        "PERSONAL"
      );

      if (maxSeededStep >= 2) {
        const hasDefaultCashSelected = selectedAccounts.some(
          (a) => a.isDefaultCash
        );
        const nonDefaultAccounts = selectedAccounts.filter(
          (a) => !a.isDefaultCash
        );

        for (const acc of nonDefaultAccounts) {
          await tauriApi.upsertAccount(createdBook.id, {
            name: acc.name,
            account_type: acc.accountType,
            initial_balance: 0,
          });
        }

        if (!hasDefaultCashSelected) {
          await tauriApi.deleteAccount(createdBook.id, DEFAULT_CASH_ACCOUNT_ID);
        }
      }

      const seededCategoryMap = new Map<string, CategoryView>();
      if (maxSeededStep >= 3) {
        for (const cat of selectedCategories) {
          const savedCat = await tauriApi.upsertCategory(createdBook.id, {
            name: cat.name,
            kind: cat.kind,
          });
          seededCategoryMap.set(cat.key, savedCat);
        }
      }

      if (maxSeededStep >= 4 && totalBudget !== null && totalBudget > 0) {
        await tauriApi.upsertBudget(createdBook.id, {
          category_id: null,
          period: "MONTHLY",
          amount_limit: totalBudget,
          alert_threshold_pct: 80,
        });

        if (isAutoSplitEnabled) {
          for (const expCat of activeAutoSplitCategories) {
            const catLimit = getEffectiveCategoryBudget(expCat.key);
            if (catLimit <= 0) continue;

            let savedCat = seededCategoryMap.get(expCat.key);
            if (!savedCat) {
              savedCat = await tauriApi.upsertCategory(createdBook.id, {
                name: expCat.name,
                kind: "EXPENSE",
              });
              seededCategoryMap.set(expCat.key, savedCat);
            }

            await tauriApi.upsertBudget(createdBook.id, {
              category_id: savedCat.id,
              period: "MONTHLY",
              amount_limit: catLimit,
              alert_threshold_pct: 80,
            });
          }
        }
      }

      return createdBook;
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleNextStep = () => {
    const trimmed = bookName.trim();
    if (!trimmed) {
      pushToast("Nama buku tidak boleh kosong", { variant: "warning" });
      return;
    }
    if (step < 4) {
      setStep((prev) => (prev + 1) as WizardStep);
    }
  };

  const handlePrevStep = () => {
    if (step > 1) {
      setStep((prev) => (prev - 1) as WizardStep);
    }
  };

  const handleSkipAndCreateNow = async () => {
    const trimmed = bookName.trim();
    if (!trimmed) {
      pushToast("Nama buku tidak boleh kosong", { variant: "warning" });
      return;
    }
    try {
      const targetSeededStep: WizardStep = step === 4 ? 3 : step;
      const created = await executeCreateAndSeedBook(targetSeededStep);
      onOpenChange(false);
      resetWizardState();
      onBookCreated(created);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Gagal membuat buku";
      pushToast("Gagal membuat buku", { description: msg, variant: "error" });
    }
  };

  const handleSlideConfirmFinalCreate =
    async (): Promise<SlideConfirmResult> => {
      const trimmed = bookName.trim();
      if (!trimmed) {
        pushToast("Nama buku tidak boleh kosong", { variant: "warning" });
        return { ok: false, message: "Nama buku tidak boleh kosong" };
      }
      try {
        const created = await executeCreateAndSeedBook(4);
        pendingCreatedBookRef.current = created;
        return { ok: true };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Gagal membuat buku";
        pushToast("Gagal membuat buku", { description: msg, variant: "error" });
        return { ok: false, message: "Gagal Membuat Buku" };
      }
    };

  const handleSlideSuccessComplete = () => {
    const created = pendingCreatedBookRef.current;
    pendingCreatedBookRef.current = null;
    onOpenChange(false);
    resetWizardState();
    if (created) {
      onBookCreated(created);
    }
  };

  const currentMeta = STEP_META[step];

  return (
    <Drawer
      open={open}
      onOpenChange={handleOpenChange}
      shouldScaleBackground={false}
    >
      <DrawerContent className="p-0 max-sm:data-[vaul-drawer-direction=bottom]:h-dvh max-sm:data-[vaul-drawer-direction=bottom]:max-h-dvh max-sm:data-[vaul-drawer-direction=bottom]:rounded-none data-[vaul-drawer-direction=bottom]:w-full data-[vaul-drawer-direction=bottom]:sm:mx-auto data-[vaul-drawer-direction=bottom]:sm:max-h-[90dvh] sm:max-w-xl">
        <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
          {/* Top Header & Step Progress Indicator */}
          <div className="shrink-0 space-y-3 border-b border-border px-5 pt-4 pb-3.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center rounded-full border border-zinc-900 bg-zinc-900 px-2.5 py-0.5 font-mono text-[10px] font-semibold text-white dark:border-zinc-600 dark:bg-zinc-800 dark:text-white">
                    Langkah {step} / 4
                  </span>
                  {bookName.trim() && step > 1 && (
                    <span className="truncate rounded-full border border-border bg-muted px-2.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                      {bookName.trim()}
                    </span>
                  )}
                </div>
                <DrawerTitle
                  id="create-book-drawer-title"
                  className="mt-1.5 text-sm font-bold text-foreground sm:text-base"
                >
                  {currentMeta.title}
                </DrawerTitle>
                <DrawerDescription className="mt-0.5 text-xs text-muted-foreground">
                  {currentMeta.subtitle}
                </DrawerDescription>
              </div>

              <button
                type="button"
                onClick={() => handleOpenChange(false)}
                disabled={isSubmitting}
                aria-label="Tutup"
                className="nav-touch-item inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary disabled:opacity-50"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* 4-Step Segmented Pill Stepper */}
            <div
              className="grid grid-cols-4 gap-1.5"
              role="list"
              aria-label="Tahapan pembuatan buku"
            >
              {([1, 2, 3, 4] as const).map((s) => {
                const meta = STEP_META[s];
                const StepIcon = meta.icon;
                const isActive = s === step;
                const isDone = s < step;
                const canJump = s < step || (s > 1 && Boolean(bookName.trim()));

                return (
                  <button
                    key={s}
                    type="button"
                    disabled={!canJump || isSubmitting}
                    onClick={() => {
                      if (canJump) setStep(s);
                    }}
                    data-testid={`wizard-step-tab-${s}`}
                    className={`flex items-center justify-center gap-1.5 rounded-xl border px-2 py-1.5 text-[11px] font-semibold transition-all focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary ${
                      isActive
                        ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
                        : isDone
                          ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                          : "border-border/70 bg-black/[0.02] text-muted-foreground dark:bg-white/[0.03]"
                    } ${canJump ? "cursor-pointer hover:opacity-90" : "cursor-default opacity-70"}`}
                  >
                    {isDone ? (
                      <Check className="h-3 w-3 shrink-0" aria-hidden="true" />
                    ) : (
                      <StepIcon
                        className="h-3 w-3 shrink-0"
                        aria-hidden="true"
                      />
                    )}
                    <span className="truncate">{meta.shortLabel}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Step Body Content */}
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-5 py-4">
            {step === 1 && (
              <WizardStepBookName
                bookName={bookName}
                onBookNameChange={setBookName}
                onEnterNext={handleNextStep}
              />
            )}

            {step === 2 && (
              <WizardStepAccounts
                accountOptions={accountOptions}
                selectedAccountKeys={selectedAccountKeys}
                selectedCount={selectedAccounts.length}
                customAccountGroup={customAccountGroup}
                customAccountName={customAccountName}
                onToggleAccountKey={toggleAccountKey}
                onOpenCustomAccountGroup={(group) => {
                  setCustomAccountGroup(group);
                  setCustomAccountName("");
                }}
                onCustomAccountNameChange={setCustomAccountName}
                onAddCustomAccount={handleAddCustomAccount}
              />
            )}

            {step === 3 && (
              <WizardStepCategories
                categoryOptions={categoryOptions}
                selectedCategoryKeys={selectedCategoryKeys}
                selectedCount={selectedCategories.length}
                customCategoryKind={customCategoryKind}
                customCategoryName={customCategoryName}
                onToggleCategoryKey={toggleCategoryKey}
                onSelectAllCategories={handleSelectAllCategories}
                onResetDefaultCategories={handleResetDefaultCategories}
                onOpenCustomCategoryKind={(kind) => {
                  setCustomCategoryKind(kind);
                  setCustomCategoryName("");
                }}
                onCustomCategoryNameChange={setCustomCategoryName}
                onAddCustomCategory={handleAddCustomCategory}
              />
            )}

            {step === 4 && (
              <WizardStepBudget
                bookName={bookName}
                selectedAccountsCount={selectedAccounts.length}
                selectedCategoriesCount={selectedCategories.length}
                selectedExpenseCategories={selectedExpenseCategories}
                activeAutoSplitCount={activeAutoSplitCategories.length}
                totalBudget={totalBudget}
                isAutoSplitEnabled={isAutoSplitEnabled}
                excludedBudgetCatKeys={excludedBudgetCatKeys}
                hasManualOverridesOrExclusions={
                  Object.keys(manualCategoryAmounts).length > 0 ||
                  excludedBudgetCatKeys.size > 0
                }
                totalAllocatedCategoryBudgets={totalAllocatedCategoryBudgets}
                getEffectiveCategoryBudget={getEffectiveCategoryBudget}
                onTotalBudgetChange={setTotalBudget}
                onClearTotalBudget={() => {
                  setTotalBudget(null);
                  setManualCategoryAmounts({});
                }}
                onSelectTotalBudgetPill={handleSelectTotalBudgetPill}
                onToggleAutoSplit={() =>
                  setIsAutoSplitEnabled((prev) => !prev)
                }
                onResetAutoSplitWeights={handleResetAutoSplitWeights}
                onToggleBudgetCategoryIncluded={toggleBudgetCategoryIncluded}
                onManualCategoryBudgetChange={handleManualCategoryBudgetChange}
              />
            )}
          </div>

          {/* Footer Navigation & Action Strip */}
          <div className="shrink-0 space-y-2.5 border-t border-border p-3.5 sm:px-5">
            {step < 4 ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  {step > 1 && (
                    <button
                      type="button"
                      disabled={isSubmitting}
                      onClick={handlePrevStep}
                      data-testid="wizard-prev-btn"
                      className="nav-touch-item inline-flex h-10 items-center gap-1 rounded-full border border-border bg-black/[0.04] px-3.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted dark:bg-white/[0.06] disabled:opacity-50"
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                      <span>Kembali</span>
                    </button>
                  )}

                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => void handleSkipAndCreateNow()}
                    data-testid="wizard-skip-btn"
                    className="nav-touch-item inline-flex h-10 items-center rounded-full border border-border bg-transparent px-3.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                  >
                    {isSubmitting
                      ? "Menyiapkan..."
                      : step === 1
                        ? "Lewati Setup & Buat"
                        : "Lewati & Buat Buku"}
                  </button>
                </div>

                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={handleNextStep}
                  data-testid="wizard-next-btn"
                  className="nav-touch-item inline-flex h-10 items-center gap-1.5 rounded-full bg-cta-surface px-5 text-xs font-bold text-cta-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  <span>Lanjut</span>
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={handlePrevStep}
                    data-testid="wizard-prev-btn"
                    className="nav-touch-item inline-flex h-9 items-center gap-1 rounded-full border border-border bg-black/[0.04] px-3.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted dark:bg-white/[0.06] disabled:opacity-50"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                    <span>Kembali</span>
                  </button>

                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => void handleSkipAndCreateNow()}
                    data-testid="wizard-skip-btn"
                    className="nav-touch-item inline-flex h-9 items-center rounded-full border border-border bg-transparent px-3.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                  >
                    {isSubmitting
                      ? "Menyiapkan..."
                      : "Lewati Anggaran & Buat Buku"}
                  </button>
                </div>

                <ButtonSlideToConfirm
                  key={
                    open && step === 4 ? "wizard-step4-open" : "wizard-closed"
                  }
                  disabled={isSubmitting}
                  label="Geser untuk Buat Buku"
                  readyLabel="Lepas untuk Buat Buku"
                  loadingLabel="Menyiapkan Buku..."
                  successLabel="Buku Berhasil Dibuat!"
                  onConfirm={handleSlideConfirmFinalCreate}
                  onSuccessComplete={handleSlideSuccessComplete}
                />
              </div>
            )}
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  );
};
