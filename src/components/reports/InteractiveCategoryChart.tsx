import * as React from "react";
import { TrendingDown, TrendingUp } from "lucide-react";
import type {
  CategoryKind,
  CategoryMonthlyBreakdownItem,
} from "../../lib/tauri-api";
import { formatMonthLabel, formatPercent, formatRupiah } from "../../lib/utils";

export type CategoryChartViewMode = "DONUT_PARETO" | "MOM_DELTA";

export interface InteractiveCategoryChartProps {
  items: CategoryMonthlyBreakdownItem[];
  month: string;
  prevMonth: string;
  selectedCategoryId: string | null;
  onSelectCategoryId: (categoryId: string | null) => void;
}

const SLICE_PALETTE = [
  "#10b981", // Emerald 500
  "#0ea5e9", // Sky 500
  "#f59e0b", // Amber 500
  "#f43f5e", // Rose 500
  "#8b5cf6", // Violet 500
  "#14b8a6", // Teal 500
  "#ec4899", // Pink 500
  "#64748b", // Slate 500
];

export const InteractiveCategoryChart: React.FC<
  InteractiveCategoryChartProps
> = ({
  items,
  month,
  prevMonth,
  selectedCategoryId,
  onSelectCategoryId,
}) => {
  const [activeKind, setActiveKind] = React.useState<CategoryKind>("EXPENSE");
  const [viewMode, setViewMode] =
    React.useState<CategoryChartViewMode>("DONUT_PARETO");
  const [hoveredCatId, setHoveredCatId] = React.useState<string | null>(null);

  const kindItems = React.useMemo(() => {
    return items.filter(
      (item) =>
        item.kind === activeKind &&
        (item.current_amount > 0 || item.prev_amount > 0)
    );
  }, [items, activeKind]);

  const totalCurrentAmount = React.useMemo(
    () => kindItems.reduce((acc, i) => acc + i.current_amount, 0),
    [kindItems]
  );

  // Compute Pareto cumulative share bps and SVG donut arcs
  const enrichedItems = React.useMemo(() => {
    let cumulativeBps = 0;
    let cumulativeAngle = 0;
    const radius = 64;
    const circumference = 2 * Math.PI * radius;

    return kindItems.map((item, idx) => {
      const shareRatio =
        totalCurrentAmount > 0 ? item.current_amount / totalCurrentAmount : 0;
      cumulativeBps += item.share_bps;
      const strokeDasharray = `${(shareRatio * circumference).toFixed(2)} ${circumference.toFixed(2)}`;
      const strokeDashoffset = (-cumulativeAngle * circumference).toFixed(2);
      cumulativeAngle += shareRatio;

      return {
        ...item,
        color: SLICE_PALETTE[idx % SLICE_PALETTE.length],
        cumulativePct: Math.min(100, Math.round(cumulativeBps / 100)),
        sharePctText: formatPercent(item.share_bps / 100, 1),
        strokeDasharray,
        strokeDashoffset,
      };
    });
  }, [kindItems, totalCurrentAmount]);

  const activeCategory = React.useMemo(() => {
    if (hoveredCatId) {
      return enrichedItems.find((i) => i.category_id === hoveredCatId) ?? null;
    }
    if (selectedCategoryId) {
      return (
        enrichedItems.find((i) => i.category_id === selectedCategoryId) ?? null
      );
    }
    return enrichedItems[0] ?? null;
  }, [enrichedItems, hoveredCatId, selectedCategoryId]);

  const maxAbsDelta = React.useMemo(() => {
    let maxVal = 100_000;
    for (const item of enrichedItems) {
      const absD = Math.abs(item.delta_amount);
      if (absD > maxVal) maxVal = absD;
    }
    return maxVal;
  }, [enrichedItems]);

  return (
    <div
      data-testid="interactive-category-chart"
      className="tabular-grid-container grid grid-cols-1 border-t border-border"
    >
      {/* Header & Controls */}
      <div className="tabular-grid-cell flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="space-y-0.5">
          <h2 className="text-xs font-semibold text-foreground sm:text-sm">
            Distribusi Kategori
          </h2>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Proporsi kategori dan perbandingan terhadap {formatMonthLabel(prevMonth)}.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Segmented Control 1: Jenis Kategori */}
          <div className="inline-flex items-center rounded-lg border border-border bg-muted/40 p-0.5">
            <button
              type="button"
              onClick={() => {
                setActiveKind("EXPENSE");
                onSelectCategoryId(null);
              }}
              className={`nav-touch-item inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-all ${
                activeKind === "EXPENSE"
                  ? "bg-background text-foreground font-semibold shadow-xs border border-border/50"
                  : "text-muted-foreground hover:text-foreground font-medium"
              }`}
            >
              <TrendingDown
                className={`h-3.5 w-3.5 shrink-0 ${activeKind === "EXPENSE" ? "text-rose-500" : "text-muted-foreground"}`}
                aria-hidden="true"
              />
              <span>Pengeluaran</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveKind("INCOME");
                onSelectCategoryId(null);
              }}
              className={`nav-touch-item inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-all ${
                activeKind === "INCOME"
                  ? "bg-background text-foreground font-semibold shadow-xs border border-border/50"
                  : "text-muted-foreground hover:text-foreground font-medium"
              }`}
            >
              <TrendingUp
                className={`h-3.5 w-3.5 shrink-0 ${activeKind === "INCOME" ? "text-emerald-500" : "text-muted-foreground"}`}
                aria-hidden="true"
              />
              <span>Pemasukan</span>
            </button>
          </div>

          {/* Segmented Control 2: Mode Tampilan Visual */}
          <div className="inline-flex items-center rounded-lg border border-border bg-muted/40 p-0.5">
            <button
              type="button"
              onClick={() => setViewMode("DONUT_PARETO")}
              className={`nav-touch-item rounded-md px-2.5 py-1 text-xs transition-all ${
                viewMode === "DONUT_PARETO"
                  ? "bg-background text-foreground font-semibold shadow-xs border border-border/50"
                  : "text-muted-foreground hover:text-foreground font-medium"
              }`}
            >
              Diagram Lingkaran
            </button>
            <button
              type="button"
              onClick={() => setViewMode("MOM_DELTA")}
              className={`nav-touch-item rounded-md px-2.5 py-1 text-xs transition-all ${
                viewMode === "MOM_DELTA"
                  ? "bg-background text-foreground font-semibold shadow-xs border border-border/50"
                  : "text-muted-foreground hover:text-foreground font-medium"
              }`}
            >
              Batang Selisih
            </button>
          </div>
        </div>
      </div>

      {enrichedItems.length === 0 ? (
        <div className="tabular-grid-cell p-6 text-center text-xs text-muted-foreground">
          Belum ada data kategori{" "}
          {activeKind === "EXPENSE" ? "pengeluaran" : "pemasukan"} pada periode{" "}
          {month} maupun {prevMonth}.
        </div>
      ) : viewMode === "DONUT_PARETO" ? (
        <div className="grid grid-cols-1 gap-px bg-border lg:grid-cols-12">
          {/* Interactive SVG Donut Ring + Center Readout (5 cols) */}
          <div className="tabular-grid-cell flex flex-col items-center justify-center p-5 lg:col-span-5">
            <div className="relative flex items-center justify-center">
              <svg
                viewBox="0 0 180 180"
                className="h-48 w-48 -rotate-90 select-none"
                role="img"
                aria-label="Donut Distribusi Kategori"
              >
                <circle
                  cx="90"
                  cy="90"
                  r="64"
                  fill="transparent"
                  className="stroke-muted/50"
                  strokeWidth="20"
                />
                {enrichedItems.map((slice) => {
                  const isActive =
                    activeCategory?.category_id === slice.category_id;
                  const isSelected = selectedCategoryId === slice.category_id;
                  return (
                    <circle
                      key={slice.category_id}
                      cx="90"
                      cy="90"
                      r="64"
                      fill="transparent"
                      stroke={slice.color}
                      strokeWidth={isActive || isSelected ? "25" : "20"}
                      strokeDasharray={slice.strokeDasharray}
                      strokeDashoffset={slice.strokeDashoffset}
                      className="cursor-pointer transition-all duration-150"
                      onMouseEnter={() => setHoveredCatId(slice.category_id)}
                      onMouseLeave={() => setHoveredCatId(null)}
                      onClick={() =>
                        onSelectCategoryId(
                          isSelected ? null : slice.category_id
                        )
                      }
                    />
                  );
                })}
              </svg>

              {/* Center Donut Summary */}
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-0.5 px-6 text-center">
                {activeCategory ? (
                  <>
                    <span className="line-clamp-1 text-xs font-medium text-muted-foreground">
                      {activeCategory.category_name}
                    </span>
                    <span className="font-mono text-sm font-bold tabular-nums tracking-tight text-foreground">
                      {formatRupiah(activeCategory.current_amount)}
                    </span>
                    <span className="font-mono text-[11px] font-medium text-primary">
                      {activeCategory.sharePctText}% dari total
                    </span>
                  </>
                ) : (
                  <span className="font-mono text-xs text-muted-foreground">
                    {formatRupiah(totalCurrentAmount)}
                  </span>
                )}
              </div>
            </div>

            {selectedCategoryId && (
              <button
                type="button"
                onClick={() => onSelectCategoryId(null)}
                className="mt-3 rounded border border-primary/50 bg-background px-2.5 py-1 text-xs font-medium text-primary shadow-none hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
              >
                Reset Filter Kategori ×
              </button>
            )}
          </div>

          {/* Pareto 80/20 Interactive Table (Fully Responsive, Delta moved under Nominal) */}
          <div className="tabular-grid-cell divide-y divide-border lg:col-span-7">
            <div>
              <div className="grid grid-cols-12 items-center bg-muted/40 px-3 py-2 text-[11px] font-medium text-muted-foreground sm:px-4">
                <div className="col-span-6 sm:col-span-5">Kategori & Porsi</div>
                <div className="col-span-4 sm:col-span-5 text-right">Nominal & Tren</div>
                <div className="col-span-2 text-right">Akumulasi</div>
              </div>

              {enrichedItems.map((item) => {
                const isSelected = selectedCategoryId === item.category_id;
                const isHovered = hoveredCatId === item.category_id;
                const isParetoCore = item.cumulativePct <= 85;

                return (
                  <div
                    key={item.category_id}
                    data-testid={`report-category-row-${item.category_id}`}
                    onMouseEnter={() => setHoveredCatId(item.category_id)}
                    onMouseLeave={() => setHoveredCatId(null)}
                    onClick={() =>
                      onSelectCategoryId(isSelected ? null : item.category_id)
                    }
                    className={`grid cursor-pointer grid-cols-12 items-center gap-2 px-3 py-2.5 text-xs transition-colors sm:px-4 sm:py-3 ${
                      isSelected
                        ? "bg-primary/10"
                        : isHovered
                          ? "bg-muted/50"
                          : ""
                    }`}
                  >
                    {/* Col 1: Kategori & Porsi Bar */}
                    <div className="col-span-6 sm:col-span-5 space-y-1.5 min-w-0">
                      <div className="flex items-center gap-1.5 sm:gap-2">
                        <span
                          className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm"
                          style={{ backgroundColor: item.color }}
                        />
                        <span className="truncate font-semibold text-foreground">
                          {item.category_name}
                        </span>
                        {item.is_system && (
                          <span className="shrink-0 rounded border border-primary/40 px-1 py-0.2 text-[9px] font-medium text-primary">
                            Khusus
                          </span>
                        )}
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-sm border border-border bg-background">
                        <div
                          className="h-full"
                          style={{
                            width: `${Math.min(100, Math.round(item.share_bps / 100))}%`,
                            backgroundColor: item.color,
                          }}
                        />
                      </div>
                    </div>

                    {/* Col 2: Nominal & Delta Badge Underneath */}
                    <div className="col-span-4 sm:col-span-5 space-y-1 text-right font-mono tabular-nums tracking-tight">
                      <p className="font-semibold text-foreground text-xs sm:text-sm">
                        {formatRupiah(item.current_amount)}
                      </p>
                      <div className="flex flex-wrap items-center justify-end gap-1 font-sans text-[10px] sm:text-[11px]">
                        {item.delta_pct !== null ? (
                          <span
                            className={`inline-flex items-center gap-0.5 rounded px-1 py-0.2 font-mono font-medium ${
                              item.delta_amount > 0
                                ? activeKind === "EXPENSE"
                                  ? "bg-rose-500/10 text-rose-500"
                                  : "bg-emerald-500/10 text-emerald-500"
                                : item.delta_amount < 0
                                  ? activeKind === "EXPENSE"
                                    ? "bg-emerald-500/10 text-emerald-500"
                                    : "bg-rose-500/10 text-rose-500"
                                  : "bg-muted text-muted-foreground"
                            }`}
                          >
                            <span>{item.delta_amount > 0 ? "▲" : item.delta_amount < 0 ? "▼" : "•"}</span>
                            <span>{formatPercent(Math.abs(item.delta_pct), 0)}</span>
                          </span>
                        ) : (
                          <span className="rounded bg-primary/10 px-1 py-0.2 font-medium text-primary">
                            Baru
                          </span>
                        )}
                        <span className="text-muted-foreground">
                          {item.sharePctText} · {item.tx_count} transaksi
                        </span>
                      </div>
                    </div>

                    {/* Col 3: Akumulasi Pareto */}
                    <div className="col-span-2 text-right font-mono text-xs tabular-nums tracking-tight">
                      <span
                        className={`rounded border px-1.5 py-0.5 text-[10px] sm:text-[11px] ${
                          isParetoCore
                            ? "border-amber-500/30 bg-amber-500/5 text-amber-500"
                            : "border-border text-muted-foreground"
                        }`}
                      >
                        {formatPercent(item.cumulativePct, 0)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        /* Diverging Month-over-Month Delta Bar View */
        <div className="tabular-grid-cell divide-y divide-border overflow-x-auto scrollbar-thin">
          <div className="min-w-[440px]">
            <div className="grid grid-cols-12 items-center bg-muted/40 px-4 py-2 text-[11px] font-medium text-muted-foreground">
              <div className="col-span-3">Kategori</div>
              <div className="col-span-2 text-right">{formatMonthLabel(prevMonth)}</div>
              <div className="col-span-2 text-right">{formatMonthLabel(month)}</div>
              <div className="col-span-5 px-3 text-center">
                Perubahan Nominal vs Bulan Lalu
              </div>
            </div>

            {enrichedItems.map((item) => {
              const ratio = Math.min(
                1,
                Math.abs(item.delta_amount) / Math.max(1, maxAbsDelta)
              );
              const widthPct = Math.round(ratio * 50);
              const isIncrease = item.delta_amount >= 0;

              return (
                <div
                  key={item.category_id}
                  onClick={() =>
                    onSelectCategoryId(
                      selectedCategoryId === item.category_id
                        ? null
                        : item.category_id
                    )
                  }
                  className="grid cursor-pointer grid-cols-12 items-center gap-2 px-4 py-3 text-xs hover:bg-muted/40"
                >
                  <div className="col-span-3 font-semibold text-foreground">
                    {item.category_name}
                  </div>
                  <div className="col-span-2 text-right font-mono tabular-nums tracking-tight text-muted-foreground">
                    {formatRupiah(item.prev_amount)}
                  </div>
                  <div className="col-span-2 text-right font-mono font-semibold tabular-nums tracking-tight text-foreground">
                    {formatRupiah(item.current_amount)}
                  </div>
                  <div className="col-span-5 space-y-1.5 px-3">
                    <div className="relative h-2.5 w-full rounded-sm border border-border bg-background">
                      <div className="absolute left-1/2 top-0 h-full w-px bg-border" />
                      {item.delta_amount !== 0 && (
                        <div
                          className={`
                            absolute top-0 h-full ${
                              isIncrease
                                ? activeKind === "EXPENSE"
                                  ? "bg-rose-500"
                                  : "bg-emerald-500"
                                : activeKind === "EXPENSE"
                                  ? "bg-emerald-500"
                                  : "bg-rose-500"
                            }
                          `}
                          style={{
                            left: isIncrease ? "50%" : `${50 - widthPct}%`,
                            width: `${Math.max(2, widthPct)}%`,
                          }}
                        />
                      )}
                    </div>
                    <div className="flex items-center justify-end gap-1 font-mono text-[11px] tabular-nums tracking-tight text-muted-foreground">
                      {item.delta_amount > 0 ? (
                        <>
                          <TrendingUp
                            className={`h-3 w-3 shrink-0 ${
                              activeKind === "EXPENSE" ? "text-rose-500" : "text-emerald-500"
                            }`}
                            aria-hidden="true"
                          />
                          <span>+{formatRupiah(item.delta_amount)}</span>
                        </>
                      ) : item.delta_amount < 0 ? (
                        <>
                          <TrendingDown
                            className={`h-3 w-3 shrink-0 ${
                              activeKind === "EXPENSE" ? "text-emerald-500" : "text-rose-500"
                            }`}
                            aria-hidden="true"
                          />
                          <span>−{formatRupiah(Math.abs(item.delta_amount))}</span>
                        </>
                      ) : (
                        <span>Tetap (Rp 0)</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
