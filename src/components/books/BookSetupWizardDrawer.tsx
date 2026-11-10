import * as React from "react";
import {
  Banknote,
  BookOpen,
  Briefcase,
  Building2,
  Car,
  Check,
  ChevronLeft,
  ChevronRight,
  Film,
  Gift,
  GraduationCap,
  HeartPulse,
  Laptop,
  MoreHorizontal,
  PieChart,
  Plus,
  RotateCcw,
  ShoppingBag,
  ShoppingCart,
  Smartphone,
  Sparkles,
  Store,
  Tags,
  TrendingDown,
  TrendingUp,
  Tv,
  Users,
  Utensils,
  Wallet,
  X,
  Zap,
  type LucideIcon,
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
import { formatCompactRupiah, formatRupiah } from "../../lib/utils";
import {
  ButtonSlideToConfirm,
  type SlideConfirmResult,
} from "../ui/ButtonSlideToConfirm";
import { CurrencyInput } from "../ui/currency-input";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from "../ui/drawer";
import { Input } from "../ui/input";

export type WizardStep = 1 | 2 | 3 | 4;

export interface PresetAccountOption {
  key: string;
  name: string;
  accountType: AccountType;
  isDefaultCash?: boolean;
  defaultSelected?: boolean;
  isCustom?: boolean;
}

export interface PresetCategoryOption {
  key: string;
  name: string;
  kind: CategoryKind;
  icon: LucideIcon;
  defaultSelected: boolean;
  /** Relative weight used for Smart Auto-Split on Step 4 (EXPENSE only) */
  budgetWeight: number;
  isCustom?: boolean;
}

export const BOOK_NAME_SUGGESTIONS = [
  "Keuangan Pribadi",
  "Uang Rumah Tangga",
  "Tabungan & Dana Darurat",
  "Kas Usaha",
] as const;

export const PRESET_ACCOUNT_OPTIONS: PresetAccountOption[] = [
  // Tunai (CASH)
  {
    key: "cash-kas-tunai",
    name: "Kas Tunai",
    accountType: "CASH",
    isDefaultCash: true,
    defaultSelected: true,
  },
  {
    key: "cash-uang-darurat",
    name: "Uang Darurat",
    accountType: "CASH",
    defaultSelected: false,
  },
  // Bank (BANK)
  {
    key: "bank-bca",
    name: "BCA",
    accountType: "BANK",
    defaultSelected: false,
  },
  {
    key: "bank-mandiri",
    name: "Mandiri",
    accountType: "BANK",
    defaultSelected: false,
  },
  {
    key: "bank-bri",
    name: "BRI",
    accountType: "BANK",
    defaultSelected: false,
  },
  {
    key: "bank-bni",
    name: "BNI",
    accountType: "BANK",
    defaultSelected: false,
  },
  {
    key: "bank-jago",
    name: "Jago",
    accountType: "BANK",
    defaultSelected: false,
  },
  {
    key: "bank-seabank",
    name: "SeaBank",
    accountType: "BANK",
    defaultSelected: false,
  },
  {
    key: "bank-bsi",
    name: "BSI",
    accountType: "BANK",
    defaultSelected: false,
  },
  // E-Wallet (EWALLET)
  {
    key: "ewallet-gopay",
    name: "GoPay",
    accountType: "EWALLET",
    defaultSelected: false,
  },
  {
    key: "ewallet-ovo",
    name: "OVO",
    accountType: "EWALLET",
    defaultSelected: false,
  },
  {
    key: "ewallet-dana",
    name: "DANA",
    accountType: "EWALLET",
    defaultSelected: false,
  },
  {
    key: "ewallet-shopeepay",
    name: "ShopeePay",
    accountType: "EWALLET",
    defaultSelected: false,
  },
];

export const PRESET_CATEGORY_OPTIONS: PresetCategoryOption[] = [
  // EXPENSE - 5 Essential Pre-selected
  {
    key: "exp-makan-minum",
    name: "Makan & Minum",
    kind: "EXPENSE",
    icon: Utensils,
    defaultSelected: true,
    budgetWeight: 30,
  },
  {
    key: "exp-belanja-bulanan",
    name: "Belanja Bulanan",
    kind: "EXPENSE",
    icon: ShoppingBag,
    defaultSelected: true,
    budgetWeight: 25,
  },
  {
    key: "exp-tagihan-utilitas",
    name: "Tagihan & Utilitas",
    kind: "EXPENSE",
    icon: Zap,
    defaultSelected: true,
    budgetWeight: 20,
  },
  {
    key: "exp-transportasi",
    name: "Transportasi",
    kind: "EXPENSE",
    icon: Car,
    defaultSelected: true,
    budgetWeight: 15,
  },
  {
    key: "exp-hiburan",
    name: "Hiburan",
    kind: "EXPENSE",
    icon: Film,
    defaultSelected: true,
    budgetWeight: 10,
  },
  // EXPENSE - Additional
  {
    key: "exp-kesehatan",
    name: "Kesehatan",
    kind: "EXPENSE",
    icon: HeartPulse,
    defaultSelected: false,
    budgetWeight: 10,
  },
  {
    key: "exp-belanja-online",
    name: "Belanja Online",
    kind: "EXPENSE",
    icon: ShoppingCart,
    defaultSelected: false,
    budgetWeight: 12,
  },
  {
    key: "exp-pendidikan",
    name: "Pendidikan",
    kind: "EXPENSE",
    icon: GraduationCap,
    defaultSelected: false,
    budgetWeight: 15,
  },
  {
    key: "exp-keluarga-sosial",
    name: "Keluarga & Sosial",
    kind: "EXPENSE",
    icon: Users,
    defaultSelected: false,
    budgetWeight: 12,
  },
  {
    key: "exp-langganan-digital",
    name: "Langganan Digital",
    kind: "EXPENSE",
    icon: Tv,
    defaultSelected: false,
    budgetWeight: 8,
  },
  {
    key: "exp-perawatan-diri",
    name: "Perawatan Diri",
    kind: "EXPENSE",
    icon: Sparkles,
    defaultSelected: false,
    budgetWeight: 8,
  },
  {
    key: "exp-lainnya",
    name: "Lainnya",
    kind: "EXPENSE",
    icon: MoreHorizontal,
    defaultSelected: false,
    budgetWeight: 8,
  },
  // INCOME - 2 Essential Pre-selected
  {
    key: "inc-gaji",
    name: "Gaji",
    kind: "INCOME",
    icon: Briefcase,
    defaultSelected: true,
    budgetWeight: 0,
  },
  {
    key: "inc-bonus-thr",
    name: "Bonus & THR",
    kind: "INCOME",
    icon: Gift,
    defaultSelected: true,
    budgetWeight: 0,
  },
  // INCOME - Additional
  {
    key: "inc-hasil-usaha",
    name: "Hasil Usaha",
    kind: "INCOME",
    icon: Store,
    defaultSelected: false,
    budgetWeight: 0,
  },
  {
    key: "inc-freelance",
    name: "Freelance",
    kind: "INCOME",
    icon: Laptop,
    defaultSelected: false,
    budgetWeight: 0,
  },
  {
    key: "inc-investasi",
    name: "Investasi & Bunga",
    kind: "INCOME",
    icon: TrendingUp,
    defaultSelected: false,
    budgetWeight: 0,
  },
];

export const TOTAL_BUDGET_QUICK_PILLS = [
  { label: "Rp 2 Jt", value: 2_000_000 },
  { label: "Rp 3 Jt", value: 3_000_000 },
  { label: "Rp 5 Jt", value: 5_000_000 },
  { label: "Rp 7,5 Jt", value: 7_500_000 },
  { label: "Rp 10 Jt", value: 10_000_000 },
  { label: "Rp 15 Jt", value: 15_000_000 },
] as const;

export interface WeightedCategoryAllocation {
  key: string;
  name: string;
  weight: number;
  sharePct: number;
  amount: number;
}

/**
 * Computes weighted proportional budget allocations across active expense categories.
 * Rounds each allocation to clean increments and adjusts the highest-weight item so
 * the sum matches `totalBudget` exactly.
 */
export function computeSmartBudgetAllocations(
  totalBudget: number,
  categories: Array<{ key: string; name: string; budgetWeight: number }>
): WeightedCategoryAllocation[] {
  if (!Number.isFinite(totalBudget) || totalBudget <= 0 || categories.length === 0) {
    return categories.map((c) => ({
      key: c.key,
      name: c.name,
      weight: c.budgetWeight,
      sharePct: 0,
      amount: 0,
    }));
  }

  const totalWeight = categories.reduce(
    (sum, c) => sum + Math.max(1, c.budgetWeight),
    0
  );

  const stepUnit =
    totalBudget >= 1_000_000
      ? 10_000
      : totalBudget >= 100_000
        ? 1_000
        : 100;

  const allocations: WeightedCategoryAllocation[] = categories.map((cat) => {
    const w = Math.max(1, cat.budgetWeight);
    const exactRatio = w / totalWeight;
    const rawAmount = totalBudget * exactRatio;
    const rounded =
      categories.length === 1
        ? Math.trunc(totalBudget)
        : Math.max(stepUnit, Math.round(rawAmount / stepUnit) * stepUnit);
    return {
      key: cat.key,
      name: cat.name,
      weight: w,
      sharePct: Math.round(exactRatio * 100),
      amount: rounded,
    };
  });

  // Reconcile rounding remainder on the largest allocation so sum === totalBudget
  const currentSum = allocations.reduce((sum, item) => sum + item.amount, 0);
  const diff = Math.trunc(totalBudget) - currentSum;
  if (diff !== 0 && allocations.length > 0) {
    let largestIdx = 0;
    for (let i = 1; i < allocations.length; i++) {
      if (allocations[i].weight > allocations[largestIdx].weight) {
        largestIdx = i;
      }
    }
    allocations[largestIdx].amount = Math.max(
      0,
      allocations[largestIdx].amount + diff
    );
  }

  return allocations;
}

export interface BookSetupWizardDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onBookCreated: (book: BookMetadata) => void;
}

const STEP_META: Record<
  WizardStep,
  {
    shortLabel: string;
    title: string;
    subtitle: string;
    icon: LucideIcon;
  }
> = {
  1: {
    shortLabel: "Buku",
    title: "Buat Buku Keuangan Baru",
    subtitle:
      "Beri nama buku untuk memisahkan catatan harian, tabungan rumah tangga, atau kas usaha.",
    icon: BookOpen,
  },
  2: {
    shortLabel: "Akun",
    title: "Pilih Rekening & Dompet",
    subtitle:
      "Ketuk akun yang sehari-hari Anda gunakan. Saldo awal dapat diatur kapan saja nanti.",
    icon: Wallet,
  },
  3: {
    shortLabel: "Kategori",
    title: "Pilih Kategori Transaksi",
    subtitle:
      "Kategori esensial sudah dipilih otomatis. Sesuaikan dengan kebutuhan pencatatan Anda.",
    icon: Tags,
  },
  4: {
    shortLabel: "Anggaran",
    title: "Target Anggaran Bulanan",
    subtitle:
      "Tentukan batas belanja bulanan dan biarkan sistem membagi proporsi ideal per kategori.",
    icon: PieChart,
  },
};

const ACCOUNT_GROUP_META: Array<{
  type: AccountType;
  label: string;
  icon: LucideIcon;
}> = [
  { type: "CASH", label: "Tunai", icon: Banknote },
  { type: "BANK", label: "Bank", icon: Building2 },
  { type: "EWALLET", label: "E-Wallet", icon: Smartphone },
];

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
    // Clear manual overrides when switching quick total pill so auto-split recalculates cleanly
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
   * - If skipped at Step 1 (`maxSeededStep === 1`), only creates the book (which includes default "Kas Tunai").
   * - If skipped at Step 2 (`maxSeededStep === 2`), seeds selected accounts from Step 2.
   * - If skipped at Step 3 (`maxSeededStep === 3`), seeds selected accounts (Step 2) + categories (Step 3).
   * - If completed at Step 4 (`maxSeededStep === 4`), seeds accounts + categories + budgets.
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

      // Step 2: Seed Accounts if maxSeededStep >= 2
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

        // If user explicitly unchecked "Kas Tunai" in Step 2, remove the auto-seeded default cash account
        if (!hasDefaultCashSelected) {
          await tauriApi.deleteAccount(createdBook.id, DEFAULT_CASH_ACCOUNT_ID);
        }
      }

      // Step 3: Seed Categories if maxSeededStep >= 3
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

      // Step 4: Seed Budgets if maxSeededStep >= 4 and totalBudget > 0
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
      // If user clicks Skip at Step 1 -> maxSeededStep = 1 (only default Kas Tunai)
      // If user clicks Skip at Step 2 -> maxSeededStep = 2 (saves Step 2 accounts)
      // If user clicks Skip at Step 3 -> maxSeededStep = 3 (saves Step 2 accounts + Step 3 categories)
      // If user clicks Skip at Step 4 -> maxSeededStep = 3 (saves Step 2 accounts + Step 3 categories, skips Step 4 budgets)
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
      <DrawerContent className="fixed inset-x-0 bottom-0 z-50 flex h-[100dvh] max-h-[100dvh] w-full flex-col rounded-none border-t border-border p-0 focus:outline-none sm:mx-auto sm:h-auto sm:max-h-[90vh] sm:max-w-xl sm:rounded-t-3xl">
        <div className="flex h-full flex-1 flex-col overflow-hidden sm:h-auto">
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
          <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
            {/* ============================================================ */}
            {/* STEP 1: BOOK NAME                                            */}
            {/* ============================================================ */}
            {step === 1 && (
              <div className="space-y-4" data-testid="wizard-step-1">
                <div className="space-y-1.5">
                  <label
                    htmlFor="new-book-name"
                    className="block text-xs font-medium text-foreground"
                  >
                    Nama Buku Keuangan
                  </label>
                  <Input
                    id="new-book-name"
                    value={bookName}
                    onChange={(e) => setBookName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        handleNextStep();
                      }
                    }}
                    placeholder="Contoh: Uang Rumah Tangga, Tabungan, Usaha..."
                    autoFocus
                  />
                </div>

                {/* Quick Name Suggestions */}
                <div className="space-y-2">
                  <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Ide Nama Cepat
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {BOOK_NAME_SUGGESTIONS.map((suggestion) => {
                      const isSelected = bookName.trim() === suggestion;
                      return (
                        <button
                          key={suggestion}
                          type="button"
                          onClick={() => setBookName(suggestion)}
                          className={`nav-touch-item inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all ${
                            isSelected
                              ? "border-zinc-900 bg-zinc-900 font-semibold text-white dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
                              : "border-border bg-white/80 text-muted-foreground hover:bg-muted hover:text-foreground dark:bg-white/[0.04]"
                          }`}
                        >
                          <span>{suggestion}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Setup Overview Card */}
                <div className="rounded-2xl border border-border/80 bg-black/[0.02] p-3.5 dark:bg-white/[0.04]">
                  <p className="text-xs font-semibold text-foreground">
                    Setup Cepat dalam 3 Langkah Berikutnya (Opsional)
                  </p>
                  <ul className="mt-2 space-y-1.5 text-[11px] text-muted-foreground">
                    <li className="flex items-center gap-2">
                      <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-zinc-900 font-mono text-[10px] font-bold text-white dark:bg-zinc-800 dark:text-white">
                        1
                      </span>
                      <span>
                        Pilih rekening bank, e-wallet, dan dompet tunai Anda
                      </span>
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-zinc-900 font-mono text-[10px] font-bold text-white dark:bg-zinc-800 dark:text-white">
                        2
                      </span>
                      <span>
                        Pilih kategori pengeluaran &amp; pemasukan sehari-hari
                      </span>
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-zinc-900 font-mono text-[10px] font-bold text-white dark:bg-zinc-800 dark:text-white">
                        3
                      </span>
                      <span>
                        Atur target anggaran bulanan dengan Smart Auto-Split
                      </span>
                    </li>
                  </ul>
                </div>
              </div>
            )}

            {/* ============================================================ */}
            {/* STEP 2: ACCOUNTS (TACTILE ICON CHIPS)                        */}
            {/* ============================================================ */}
            {step === 2 && (
              <div className="space-y-4" data-testid="wizard-step-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-muted-foreground">
                    Ketuk untuk memilih akun yang aktif dipakai
                  </span>
                  <span
                    data-testid="selected-accounts-count"
                    className="rounded-full border border-zinc-900 bg-zinc-900 px-2.5 py-0.5 font-mono text-[11px] font-semibold text-white dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
                  >
                    {selectedAccounts.length} dipilih
                  </span>
                </div>

                {ACCOUNT_GROUP_META.map((group) => {
                  const GroupIcon = group.icon;
                  const groupItems = accountOptions.filter(
                    (a) => a.accountType === group.type
                  );
                  const isAddingCustomHere = customAccountGroup === group.type;

                  return (
                    <div key={group.type} className="space-y-2">
                      <div className="flex items-center gap-1.5 px-0.5">
                        <GroupIcon className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                          {group.label}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {groupItems.map((item) => {
                          const isSelected = selectedAccountKeys.has(item.key);
                          return (
                            <button
                              key={item.key}
                              type="button"
                              aria-pressed={isSelected}
                              data-testid={`wizard-account-chip-${item.key}`}
                              onClick={() => toggleAccountKey(item.key)}
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
                                      ? "border-white/15 bg-white/15 text-white"
                                      : "border-border bg-black/[0.04] text-muted-foreground dark:bg-white/[0.06]"
                                  }`}
                                >
                                  <GroupIcon className="h-3.5 w-3.5" />
                                </div>
                                <span className="truncate">{item.name}</span>
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

                        {/* "+ Kustom" trigger chip */}
                        <button
                          type="button"
                          data-testid={`wizard-add-custom-account-${group.type}`}
                          onClick={() => {
                            setCustomAccountGroup(
                              isAddingCustomHere ? null : group.type
                            );
                            setCustomAccountName("");
                          }}
                          className="nav-touch-item flex items-center justify-center gap-1.5 rounded-2xl border border-dashed border-border bg-transparent px-3 py-2.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          <span>+ Kustom</span>
                        </button>
                      </div>

                      {isAddingCustomHere && (
                        <div className="flex items-center gap-2 rounded-2xl border border-border bg-black/[0.03] p-2 dark:bg-white/[0.05]">
                          <Input
                            value={customAccountName}
                            onChange={(e) =>
                              setCustomAccountName(e.target.value)
                            }
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                handleAddCustomAccount();
                              }
                            }}
                            placeholder={`Nama ${group.label} baru...`}
                            aria-label={`Nama ${group.label} Kustom`}
                            className="h-8 text-xs"
                            autoFocus
                          />
                          <button
                            type="button"
                            onClick={handleAddCustomAccount}
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
            )}

            {/* ============================================================ */}
            {/* STEP 3: CATEGORIES (TACTILE ICON CHIPS)                      */}
            {/* ============================================================ */}
            {step === 3 && (
              <div className="space-y-4" data-testid="wizard-step-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span
                    data-testid="selected-categories-count"
                    className="rounded-full border border-zinc-900 bg-zinc-900 px-2.5 py-0.5 font-mono text-[11px] font-semibold text-white dark:border-zinc-600 dark:bg-zinc-800 dark:text-white"
                  >
                    {selectedCategories.length} kategori dipilih
                  </span>

                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={handleSelectAllCategories}
                      className="nav-touch-item rounded-full border border-border bg-black/[0.03] px-2.5 py-1 text-[11px] font-medium text-foreground hover:bg-muted dark:bg-white/[0.05]"
                    >
                      Pilih Semua
                    </button>
                    <button
                      type="button"
                      onClick={handleResetDefaultCategories}
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
                  const isAddingCustomHere =
                    customCategoryKind === section.kind;

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
                            sectionItems.filter((i) =>
                              selectedCategoryKeys.has(i.key)
                            ).length
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
                              onClick={() => toggleCategoryKey(cat.key)}
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
                          onClick={() => {
                            setCustomCategoryKind(
                              isAddingCustomHere ? null : section.kind
                            );
                            setCustomCategoryName("");
                          }}
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
                            onChange={(e) =>
                              setCustomCategoryName(e.target.value)
                            }
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                handleAddCustomCategory();
                              }
                            }}
                            placeholder={`Nama kategori ${section.kind === "EXPENSE" ? "pengeluaran" : "pemasukan"}...`}
                            aria-label={`Nama Kategori ${section.kind} Kustom`}
                            className="h-8 text-xs"
                            autoFocus
                          />
                          <button
                            type="button"
                            onClick={handleAddCustomCategory}
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
            )}

            {/* ============================================================ */}
            {/* STEP 4: BUDGETS (TOTAL QUICK PILLS + SMART AUTO-SPLIT)       */}
            {/* ============================================================ */}
            {step === 4 && (
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
                        onClick={() => {
                          setTotalBudget(null);
                          setManualCategoryAmounts({});
                        }}
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
                          onClick={() => handleSelectTotalBudgetPill(pill.value)}
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
                    onValueChange={(val) => setTotalBudget(val)}
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
                          onClick={() =>
                            setIsAutoSplitEnabled((prev) => !prev)
                          }
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
                              Total alokasi kategori (
                              {activeAutoSplitCategories.length} pos):
                            </span>
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-bold tabular-nums text-foreground">
                                {formatRupiah(totalAllocatedCategoryBudgets)}
                              </span>
                              {(Object.keys(manualCategoryAmounts).length > 0 ||
                                excludedBudgetCatKeys.size > 0) && (
                                <button
                                  type="button"
                                  onClick={handleResetAutoSplitWeights}
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
                              const isIncluded = !excludedBudgetCatKeys.has(
                                cat.key
                              );
                              const effectiveAmt = getEffectiveCategoryBudget(
                                cat.key
                              );
                              const pctOfTotal =
                                totalBudget > 0 && isIncluded
                                  ? Math.round(
                                      (effectiveAmt / totalBudget) * 100
                                    )
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
                                        toggleBudgetCategoryIncluded(cat.key)
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
                                          handleManualCategoryBudgetChange(
                                            cat.key,
                                            val
                                          )
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
                      {selectedAccounts.length} Akun
                    </span>
                    <span className="rounded-full border border-border bg-card px-2.5 py-0.5 font-mono">
                      {selectedCategories.length} Kategori
                    </span>
                    <span className="rounded-full border border-border bg-card px-2.5 py-0.5 font-mono">
                      {totalBudget && totalBudget > 0
                        ? `Target ${formatCompactRupiah(totalBudget)}/bln`
                        : "Tanpa Target Anggaran"}
                    </span>
                  </div>
                </div>
              </div>
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
                  key={open && step === 4 ? "wizard-step4-open" : "wizard-closed"}
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
