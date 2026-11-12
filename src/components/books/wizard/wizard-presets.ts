import {
  Banknote,
  BookOpen,
  Briefcase,
  Building2,
  Car,
  Film,
  Gift,
  GraduationCap,
  HeartPulse,
  Laptop,
  MoreHorizontal,
  PieChart,
  ShoppingBag,
  ShoppingCart,
  Smartphone,
  Sparkles,
  Store,
  Tags,
  TrendingUp,
  Tv,
  Users,
  Utensils,
  Wallet,
  Zap,
  type LucideIcon,
} from "lucide-react";
import type { AccountType, CategoryKind } from "../../../lib/tauri-api";

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
  if (
    !Number.isFinite(totalBudget) ||
    totalBudget <= 0 ||
    categories.length === 0
  ) {
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

export const STEP_META: Record<
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

export const ACCOUNT_GROUP_META: Array<{
  type: AccountType;
  label: string;
  icon: LucideIcon;
}> = [
  { type: "CASH", label: "Tunai", icon: Banknote },
  { type: "BANK", label: "Bank", icon: Building2 },
  { type: "EWALLET", label: "E-Wallet", icon: Smartphone },
];

