import * as React from "react";
import {
  CircleCheck,
  OctagonAlert,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
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

const BUDGET_SPECTRUM_GRADIENT =
  "linear-gradient(90deg, #22c55e 0%, #eab308 35%, #f97316 62%, #ef4444 84%, #7f1d1d 100%)";

export function getBudgetStatusMeta(status: BudgetStatus): {
  label: string;
  icon: LucideIcon;
  textClass: string;
  badgeClass: string;
} {
  switch (status) {
    case "OVER":
      return {
        label: "Melebihi Batas (Over)",
        icon: OctagonAlert,
        textClass: "text-rose-500 dark:text-rose-400",
        badgeClass: "border-rose-500/35 bg-rose-500/10",
      };
    case "WARNING":
      return {
        label: "Peringatan (Warning)",
        icon: TriangleAlert,
        textClass: "text-amber-600 dark:text-amber-400",
        badgeClass: "border-amber-500/35 bg-amber-500/10",
      };
    case "OK":
    default:
      return {
        label: "Aman (Ok)",
        icon: CircleCheck,
        textClass: "text-emerald-600 dark:text-emerald-400",
        badgeClass: "border-emerald-500/35 bg-emerald-500/10",
      };
  }
}

export const BudgetProgressBar: React.FC<BudgetProgressBarProps> = ({
  pct,
  status,
  alertThresholdPct,
  variant = "segmented",
  tone = "default",
  showStatusLabel = true,
  className,
}) => {
  const meta = getBudgetStatusMeta(status);
  const StatusIcon = meta.icon;
  const clampedPct = Math.max(0, Math.min(100, pct));
  const hasThresholdMarker = alertThresholdPct > 0 && alertThresholdPct < 100;

  const trackSizeClass =
    tone === "hero"
      ? "h-4 sm:h-4.5 p-[2px]"
      : variant === "linear"
        ? "h-2.5 p-[1.5px]"
        : "h-3 sm:h-3.5 p-[2px]";

  return (
    <div className={cn("flex items-center gap-2 shadow-none", className)}>
      {/* Modern Full-Spectrum Gradient Progress Track (Green -> Yellow -> Orange -> Red -> Dark Red) */}
      <div
        role="progressbar"
        aria-valuenow={clampedPct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={`${pct}%`}
        aria-label={`Realisasi anggaran ${pct}% (${meta.label})`}
        className={cn(
          "relative w-full overflow-hidden rounded-full border border-border/75 bg-black/[0.06] dark:bg-white/[0.07]",
          trackSizeClass
        )}
      >
        <div
          className="relative h-full w-full overflow-hidden rounded-full"
          style={{ containerType: "inline-size" }}
        >
          {/* Active clipped spectrum gradient */}
          {clampedPct > 0 && (
            <div
              data-testid="budget-gradient-clip"
              className="relative h-full overflow-hidden rounded-full transition-[width] duration-500 ease-out"
              style={{ width: `${clampedPct}%` }}
            >
              <div
                data-testid="budget-gradient-fill"
                className="h-full w-[100cqw] rounded-full"
                style={{ backgroundImage: BUDGET_SPECTRUM_GRADIENT }}
              />
              {/* Subtle top sheen for modern depth without heavy drop shadows */}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 rounded-full bg-gradient-to-b from-white/25 via-transparent to-black/10"
              />
            </div>
          )}

          {/* Subtle warning threshold marker */}
          {hasThresholdMarker && (
            <span
              data-testid="budget-threshold-marker"
              aria-hidden="true"
              title={`Ambang peringatan ${alertThresholdPct}%`}
              className="pointer-events-none absolute top-0 bottom-0 z-10 w-[1.5px] -translate-x-1/2 bg-foreground/30 dark:bg-white/40"
              style={{ left: `${alertThresholdPct}%` }}
            />
          )}
        </div>
      </div>
      {showStatusLabel && (
        <div className="flex items-center justify-end text-xs">
          <span className="font-mono text-xs font-semibold tabular-nums tracking-tight text-muted-foreground">
            {pct}%
          </span>
          <span
            data-testid={`budget-status-label-${status}`}
            role="img"
            aria-label={meta.label}
            title={meta.label}
            className={cn(
              "inline-flex h-6 w-6 items-center justify-center ",
              meta.textClass
            )}
          >
            <StatusIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          </span>

        </div>
      )}
    </div>
  );
};
