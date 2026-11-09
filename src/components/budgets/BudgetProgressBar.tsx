import * as React from "react";
import type { BudgetStatus } from "../../lib/tauri-api";
import { cn } from "../../lib/utils";

export interface BudgetProgressBarProps {
  pct: number;
  status: BudgetStatus;
  alertThresholdPct: number;
  variant?: "segmented" | "linear";
  tone?: "default" | "hero";
  showStatusLabel?: boolean;
  className?: string;
}

const SEGMENT_COUNT = 24;

export function getBudgetStatusMeta(status: BudgetStatus): {
  label: string;
  barClass: string;
  segmentClass: string;
  textClass: string;
  badgeClass: string;
} {
  switch (status) {
    case "OVER":
      return {
        label: "MELEBIHI BATAS (OVER)",
        barClass: "bg-rose-500",
        segmentClass: "bg-rose-400",
        textClass: "text-rose-500 dark:text-rose-400",
        badgeClass: "border-rose-500/35 bg-rose-500/10",
      };
    case "WARNING":
      return {
        label: "PERINGATAN (WARNING)",
        barClass: "bg-amber-500",
        segmentClass: "bg-amber-400",
        textClass: "text-amber-600 dark:text-amber-400",
        badgeClass: "border-amber-500/35 bg-amber-500/10",
      };
    case "OK":
    default:
      return {
        label: "AMAN (OK)",
        barClass: "bg-emerald-500",
        segmentClass: "bg-emerald-500 dark:bg-emerald-400",
        textClass: "text-emerald-600 dark:text-emerald-400",
        badgeClass: "border-emerald-500/35 bg-emerald-500/10",
      };
  }
}

export const BudgetProgressBar: React.FC<BudgetProgressBarProps> = ({
  pct,
  status,
  alertThresholdPct: _alertThresholdPct,
  variant = "segmented",
  tone = "default",
  showStatusLabel = true,
  className,
}) => {
  const meta = getBudgetStatusMeta(status);
  const clampedPct = Math.max(0, Math.min(100, pct));
  const filledSegments =
    clampedPct === 0
      ? 0
      : Math.min(
          SEGMENT_COUNT,
          Math.max(1, Math.round((clampedPct / 100) * SEGMENT_COUNT))
        );

  const activeSegmentClass =
    tone === "hero" && status === "OK"
      ? "bg-foreground dark:bg-white"
      : meta.segmentClass;

  const emptySegmentClass =
    tone === "hero"
      ? "bg-black/15 dark:bg-white/20"
      : "bg-black/10 dark:bg-white/15";

  return (
    <div className={cn("space-y-2 shadow-none", className)}>
      {showStatusLabel && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <span
            data-testid={`budget-status-label-${status}`}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold tracking-tight",
              meta.badgeClass,
              meta.textClass
            )}
          >
            <span
              data-testid={`budget-progress-fill-${status}`}
              className={cn("inline-block h-1.5 w-1.5 rounded-full", meta.barClass)}
            />
            <span>{meta.label}</span>
          </span>

          <span className="font-mono text-xs font-semibold tabular-nums tracking-tight text-muted-foreground">
            {pct}%
          </span>
        </div>
      )}

      {variant === "segmented" ? (
        <div
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Realisasi anggaran ${pct}% (${meta.label})`}
          className={cn(
            "flex w-full items-stretch gap-1 sm:gap-1.5",
            tone === "hero" ? "h-8 sm:h-9" : "h-5 sm:h-6"
          )}
        >
          {Array.from({ length: SEGMENT_COUNT }, (_, idx) => {
            const isFilled = idx < filledSegments;
            return (
              <span
                key={idx}
                aria-hidden="true"
                className={cn(
                  "flex-1 rounded-[3px] transition-colors duration-200",
                  isFilled ? activeSegmentClass : emptySegmentClass
                )}
              />
            );
          })}
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <div
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            className="relative h-2.5 w-full overflow-hidden rounded-full border border-border bg-muted"
          >
            <div
              className={cn(
                "h-full rounded-full transition-all duration-200",
                meta.barClass
              )}
              style={{ width: `${clampedPct}%` }}
            />
          </div>
        </div>
      )}
    </div>
  );
};
