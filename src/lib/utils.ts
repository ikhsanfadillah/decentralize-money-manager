import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

const idrFormatter = new Intl.NumberFormat("id-ID", {
  style: "currency",
  currency: "IDR",
  maximumFractionDigits: 0,
  minimumFractionDigits: 0,
});

export function formatRupiah(amount: number): string {
  if (!Number.isFinite(amount)) {
    return "Rp 0";
  }
  return idrFormatter.format(Math.trunc(amount));
}

export function formatSignedRupiah(
  amount: number,
  txType: "EXPENSE" | "INCOME" | "TRANSFER"
): string {
  const absFormatted = formatRupiah(Math.abs(amount));
  if (txType === "EXPENSE") {
    return `- ${absFormatted}`;
  }
  if (txType === "INCOME") {
    return `+ ${absFormatted}`;
  }
  return `⇄ ${absFormatted}`;
}

export function currentYearMonth(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export function shiftYearMonth(yearMonth: string, deltaMonths: number): string {
  const [yStr, mStr] = yearMonth.split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  if (!Number.isInteger(y) || !Number.isInteger(m)) {
    return currentYearMonth();
  }
  const date = new Date(y, m - 1 + deltaMonths, 1);
  const nextYear = date.getFullYear();
  const nextMonth = String(date.getMonth() + 1).padStart(2, "0");
  return `${nextYear}-${nextMonth}`;
}

export function formatMonthLabel(yearMonth: string): string {
  const [yStr, mStr] = yearMonth.split("-");
  const y = Number(yStr);
  const m = Number(mStr);
  if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) {
    return yearMonth;
  }
  const date = new Date(y, m - 1, 1);
  return new Intl.DateTimeFormat("id-ID", {
    month: "long",
    year: "numeric",
  }).format(date);
}

export function todayIsoDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export type ThemeMode = "dark" | "light";
const THEME_STORAGE_KEY = "dmm-theme-mode";

export function getStoredTheme(): ThemeMode {
  if (typeof window === "undefined") {
    return "dark";
  }
  const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
  return saved === "light" ? "light" : "dark";
}

export function applyTheme(theme: ThemeMode): void {
  if (typeof document === "undefined") {
    return;
  }
  const root = document.documentElement;
  if (theme === "dark") {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
  if (typeof window !== "undefined") {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  }
}

export function formatAccountTypeLabel(accountType: string): string {
  switch (accountType) {
    case "BANK":
      return "Bank";
    case "CASH":
      return "Tunai";
    case "EWALLET":
      return "E-Wallet";
    default:
      return accountType;
  }
}

export function formatBookKindLabel(kind: string): string {
  switch (kind) {
    case "PERSONAL":
      return "Pribadi";
    case "BUSINESS":
      return "Usaha";
    case "OFFICE":
      return "Kantor";
    case "OTHER":
      return "Lainnya";
    default:
      return kind;
  }
}

export function formatTxTypeLabel(txType: string): string {
  switch (txType) {
    case "EXPENSE":
      return "Pengeluaran";
    case "INCOME":
      return "Pemasukan";
    case "TRANSFER":
      return "Pindah Saldo";
    default:
      return txType;
  }
}

