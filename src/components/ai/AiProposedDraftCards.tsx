import * as React from "react";
import { Check, Loader2, Target } from "lucide-react";
import { formatDateShort } from "../../lib/date";
import { formatRupiah, formatSignedRupiah } from "../../lib/utils";
import type {
  ProposedBudgetDraft,
  ProposedTransactionDraft,
} from "../../stores/ai-store";

export interface ProposedTransactionCardProps {
  draft: ProposedTransactionDraft;
  isApplying: boolean;
  onApply: () => void;
}

export const ProposedTransactionCard: React.FC<
  ProposedTransactionCardProps
> = ({ draft, isApplying, onApply }) => {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-primary/35 bg-primary/[0.06] px-3.5 py-2.5 text-xs">
      <div className="min-w-0 flex-1">
        <p className="truncate font-bold text-foreground">{draft.note}</p>
        <p className="truncate text-[11px] text-muted-foreground">
          {draft.account_name} · {draft.category_name ?? "Transfer"} ·{" "}
          {formatDateShort(draft.tx_date)}
        </p>
        <p
          className={`mt-0.5 font-mono text-xs font-bold ${
            draft.tx_type === "INCOME" ? "text-emerald-500" : "text-rose-500"
          }`}
        >
          {formatSignedRupiah(draft.amount, draft.tx_type)}
        </p>
      </div>

      <button
        type="button"
        disabled={draft.applied || isApplying}
        onClick={onApply}
        className={`nav-touch-item shrink-0 inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-bold ${
          draft.applied
            ? "border border-emerald-500/40 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
            : "bg-cta-surface text-cta-foreground hover:opacity-90"
        }`}
      >
        {draft.applied ? (
          <>
            <Check className="h-3.5 w-3.5" />
            <span>Tersimpan</span>
          </>
        ) : isApplying ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <span>Simpan Transaksi</span>
        )}
      </button>
    </div>
  );
};

export interface ProposedBudgetCardProps {
  draft: ProposedBudgetDraft;
  isApplying: boolean;
  onApply: () => void;
}

export const ProposedBudgetCard: React.FC<ProposedBudgetCardProps> = ({
  draft,
  isApplying,
  onApply,
}) => {
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-primary/35 bg-primary/[0.06] px-3.5 py-2.5 text-xs">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <Target className="h-3.5 w-3.5 text-primary shrink-0" />
          <span className="truncate font-bold text-foreground">
            {draft.category_name}
          </span>
        </div>
        <p className="mt-0.5 font-mono text-xs font-bold text-primary">
          Batas: {formatRupiah(draft.amount_limit)} /bln
        </p>
        {draft.reason && (
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {draft.reason}
          </p>
        )}
      </div>

      <button
        type="button"
        disabled={draft.applied || isApplying}
        onClick={onApply}
        className={`nav-touch-item shrink-0 inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-bold ${
          draft.applied
            ? "border border-emerald-500/40 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
            : "bg-cta-surface text-cta-foreground hover:opacity-90"
        }`}
      >
        {draft.applied ? (
          <>
            <Check className="h-3.5 w-3.5" />
            <span>Diterapkan</span>
          </>
        ) : isApplying ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <span>Terapkan Anggaran</span>
        )}
      </button>
    </div>
  );
};

