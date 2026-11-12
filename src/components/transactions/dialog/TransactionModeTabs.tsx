import { ArrowLeftRight, TrendingDown, TrendingUp } from "lucide-react";
import * as React from "react";
import type { TransactionType } from "../../../lib/tauri-api";

export type DialogTxMode = TransactionType | "CROSS_BOOK_TRANSFER";

export interface TransactionModeTabsProps {
  currentMode: DialogTxMode;
  isEditing: boolean;
  onSelectMode: (mode: DialogTxMode) => void;
}

export const TransactionModeTabs: React.FC<TransactionModeTabsProps> = ({
  currentMode,
  isEditing,
  onSelectMode,
}) => {
  const tabs = [
    {
      key: "EXPENSE" as const,
      label: "Pengeluaran",
      color: "text-rose-700 dark:text-rose-400",
      activeClass:
        "border border-rose-600 bg-rose-500/15 text-rose-800 dark:border-rose-400/60 dark:text-rose-300",
      icon: TrendingDown,
    },
    {
      key: "INCOME" as const,
      label: "Pemasukan",
      color: "text-emerald-700 dark:text-emerald-400",
      activeClass:
        "border border-emerald-700 bg-emerald-500/15 text-emerald-800 dark:border-emerald-400/60 dark:text-emerald-300",
      icon: TrendingUp,
    },
    {
      key: "TRANSFER" as const,
      label: "Pindah Saldo",
      color: "text-sky-700 dark:text-sky-400",
      activeClass:
        "border border-sky-700 bg-sky-500/15 text-sky-800 dark:border-sky-400/60 dark:text-sky-300",
      icon: ArrowLeftRight,
    },
    ...(!isEditing
      ? [
          {
            key: "CROSS_BOOK_TRANSFER" as const,
            label: "Pindah Buku",
            color: "text-amber-700 dark:text-amber-400",
            activeClass:
              "border border-amber-700 bg-amber-500/15 text-amber-800 dark:border-amber-400/60 dark:text-amber-300",
            icon: ArrowLeftRight,
          },
        ]
      : []),
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 rounded-2xl bg-card">
      {tabs.map((tab) => {
        const active = currentMode === tab.key;
        const IconComponent = tab.icon;
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => onSelectMode(tab.key)}
            className={`nav-touch-item inline-flex min-h-11 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-3 py-2 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
              active
                ? tab.activeClass
                : "border border-control-border/50 text-foreground hover:bg-muted/60"
            }`}
          >
            <IconComponent
              className={`h-3.5 w-3.5 shrink-0 ${active ? "" : tab.color}`}
              aria-hidden="true"
            />
            <span>{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
};

