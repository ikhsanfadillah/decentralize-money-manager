import * as React from "react";
import type { BudgetStatus } from "../../lib/tauri-api";
import { cn } from "../../lib/utils";

export interface BudgetProgressBarProps {
  pct: number;
  status: BudgetStatus;
  alertThresholdPct: number;
  className?: string;
}

export function getBudgetStatusMeta(status: BudgetStatus): {
  label: string;
  barClass: string;
  textClass: string;
  badgeBorderClass: string;
} {
  switch (status) {
    case "OVER":
      return {
        label: "MELEBIHI BATAS (OVER)",
        barClass: "bg-rose-500",
        textClass: "text-rose-500",
        badgeBorderClass: "border-rose-500/40",
      };
    case "WARNING":
      return {
        label: "PERINGATAN (WARNING)",
        barClass: "bg-amber-500",
        textClass: "text-amber-500",
        badgeBorderClass: "border-amber-500/40",
      };
    case "OK":
    default:
      return {
        label: "Aman (OK)",
        barClass: "bg-primary",
        textClass: "text-primary",
        badgeBorderClass: "border-primary/40",
      };
  }
}

export const BudgetProgressBar: React.FC<BudgetProgressBarProps> = ({
  pct,
  status,
  alertThresholdPct: _alertThresholdPct,
  className,
}) => {
  const meta = getBudgetStatusMeta(status);
  const clampedWidth = Math.max(0, Math.min(100, pct));

  return (
    <div className={cn("space-y-1.5 shadow-none", className)}>
      <div className="flex flex-wrap items-center justify-between gap-1.5 text-xs">
        
      </div>
      <div className="flex items-center gap-2">

        <div
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          className="relative h-3 w-full overflow-hidden rounded-sm border border-border bg-background shadow-none"
        >
          <div
            data-testid={`budget-progress-fill-${status}`}
            className={cn("h-full transition-all duration-200 shadow-none", meta.barClass)}
            style={{ width: `${clampedWidth}%` }}
          />
        </div>
          <span className="shrink-0 font-mono text-xs tabular-nums tracking-tight text-muted-foreground">
            {pct}%
          </span>
      </div>
    </div>
  );
};

