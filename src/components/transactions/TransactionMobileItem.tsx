import { TrendingDown, TrendingUp } from "lucide-react";
import * as React from "react";
import { formatDateReadable } from "../../lib/date";
import type { TransactionView } from "../../lib/tauri-api";
import { formatSignedRupiah } from "../../lib/utils";

export interface TransactionItemProps {
  tx: TransactionView;
  onEdit: (tx: TransactionView) => void;
}

export const TransactionItem: React.FC<TransactionItemProps> = ({
  tx,
  onEdit,
}) => {
  const isExpense = tx.tx_type === "EXPENSE";
  const isIncome = tx.tx_type === "INCOME";
  const isTransfer = tx.tx_type === "TRANSFER";

  const dotColor = isExpense
    ? "bg-rose-500"
    : isIncome
      ? "bg-emerald-500"
      : "bg-sky-500";

  const amountColor = isExpense
    ? "text-rose-500"
    : isIncome
      ? "text-emerald-500"
      : "text-sky-500";

  const title = isTransfer
    ? `${tx.account_name} → ${tx.to_account_name ?? "-"}`
    : (tx.category_name ?? "Tanpa Kategori");

  const accountDisplay = isTransfer ? "Pindah Saldo" : tx.account_name;

  return (
    <div
      data-testid={`tx-mobile-card-${tx.id}`}
      role="button"
      tabIndex={0}
      aria-label={`Detail dan edit transaksi ${title}`}
      onClick={() => onEdit(tx)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onEdit(tx);
        }
      }}
      className="group cursor-pointer bg-card px-4 py-3 transition-colors hover:bg-black/[0.03] active:bg-black/[0.05] dark:hover:bg-white/[0.04] dark:active:bg-white/[0.07] focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
    >
      {/* Row 1: Category (+ inline note) & Nominal */}
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          {isExpense ? (
            <TrendingDown
              className="h-3.5 w-3.5 shrink-0 self-center text-rose-400"
              aria-hidden="true"
            />
          ) : isIncome ? (
            <TrendingUp
              className="h-3.5 w-3.5 shrink-0 self-center text-emerald-400"
              aria-hidden="true"
            />
          ) : (
            <span
              className={`h-2 w-2 shrink-0 self-center rounded-full ${dotColor}`}
              aria-hidden="true"
            />
          )}
          <span className="truncate text-xs font-semibold text-foreground">
            {title}
          </span>
          {tx.note && (
            <span className="truncate text-[11px] text-muted-foreground">
              · {tx.note}
            </span>
          )}
          {tx.link_id && (
            <span className="shrink-0 rounded-full border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[9px] font-medium text-primary">
              Pindah Buku
            </span>
          )}
        </div>

        <span
          className={`shrink-0 font-mono text-xs font-bold tabular-nums tracking-tight ${amountColor}`}
        >
          {formatSignedRupiah(tx.amount, tx.tx_type)}
        </span>
      </div>

      {/* Row 2: Date, Account, Device */}
      <div className="mt-1 flex items-center justify-between gap-2 pl-5">
        <p
          title={`Tanggal: ${tx.tx_date} · Rekening: ${accountDisplay} · Dibuat oleh perangkat ID: ${tx.created_by_device.slice(0, 8)}`}
          className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground"
        >
          <span className="font-mono">
            {formatDateReadable(tx.tx_date)}
            <span className="sr-only"> ({tx.tx_date})</span>
          </span>
          <span className="mx-1.5 opacity-50">·</span>
          <span className="font-medium text-foreground/80">
            {accountDisplay}
          </span>
          <span className="sr-only">#{tx.created_by_device.slice(0, 6)}</span>
        </p>
      </div>
    </div>
  );
};

