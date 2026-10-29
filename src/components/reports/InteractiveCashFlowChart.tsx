import * as React from "react";
import type { DailyCashFlowPoint } from "../../lib/tauri-api";
import { formatRupiah } from "../../lib/utils";

export type CashFlowChartMode = "DAILY_BARS" | "CUMULATIVE_BURN";
export type TimeScaleMode = "FULL_MONTH" | "TWO_WEEKS";

export interface InteractiveCashFlowChartProps {
  dailySeries: DailyCashFlowPoint[];
  daysInMonth: number;
  elapsedDays: number;
  totalBudgetLimit: number | null;
  selectedDate: string | null;
  onSelectDate: (date: string | null) => void;
}

interface Point {
  x: number;
  y: number;
}

/**
 * Generates an SVG path data string using Catmull-Rom to Cubic Bézier spline.
 * Passes smoothly through every data point without angular kinks.
 */
function getSmoothLinePath(
  points: Point[],
  minY: number,
  maxY: number
): string {
  if (points.length === 0) return "";
  if (points.length === 1) {
    return `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  }

  let path = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;

  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];

    // Catmull-Rom to cubic Bézier control points (tension = 0.5)
    let cp1x = p1.x + (p2.x - p0.x) / 6;
    let cp1y = p1.y + (p2.y - p0.y) / 6;
    let cp2x = p2.x - (p3.x - p1.x) / 6;
    let cp2y = p2.y - (p3.y - p1.y) / 6;

    // Clamp vertical control points to stay strictly within chart boundaries
    cp1y = Math.max(minY, Math.min(maxY, cp1y));
    cp2y = Math.max(minY, Math.min(maxY, cp2y));

    path += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }

  return path;
}

/**
 * Creates a closed SVG area path for soft gradient fill underneath the smooth curve.
 */
function getSmoothAreaPath(
  points: Point[],
  baselineY: number,
  minY: number,
  maxY: number
): string {
  if (points.length === 0) return "";
  const linePath = getSmoothLinePath(points, minY, maxY);
  const firstX = points[0].x.toFixed(1);
  const lastX = points[points.length - 1].x.toFixed(1);
  const base = baselineY.toFixed(1);

  return `${linePath} L ${lastX} ${base} L ${firstX} ${base} Z`;
}

export const InteractiveCashFlowChart: React.FC<
  InteractiveCashFlowChartProps
> = ({
  dailySeries,
  daysInMonth,
  elapsedDays,
  totalBudgetLimit,
  selectedDate,
  onSelectDate,
}) => {
  const [chartMode, setChartMode] =
    React.useState<CashFlowChartMode>("DAILY_BARS");
  const [timeScale, setTimeScale] =
    React.useState<TimeScaleMode>("FULL_MONTH");
  const [showIncome, setShowIncome] = React.useState(true);
  const [showExpense, setShowExpense] = React.useState(true);
  const [showNetLine, setShowNetLine] = React.useState(true);
  const [hoveredDay, setHoveredDay] = React.useState<number | null>(null);
  const scrollContainerRef = React.useRef<HTMLDivElement>(null);

  const todayStr = React.useMemo(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }, []);

  const todayDay = React.useMemo(() => {
    const pt = dailySeries.find((d) => d.date === todayStr);
    return pt ? pt.day : null;
  }, [dailySeries, todayStr]);

  const activePoint = React.useMemo(() => {
    if (hoveredDay !== null) {
      return dailySeries.find((d) => d.day === hoveredDay) ?? null;
    }
    if (selectedDate !== null) {
      return dailySeries.find((d) => d.date === selectedDate) ?? null;
    }
    const todayPt = dailySeries.find((d) => d.date === todayStr);
    if (todayPt) {
      return todayPt;
    }
    const fallbackIdx = Math.min(
      Math.max(0, elapsedDays - 1),
      dailySeries.length - 1
    );
    return dailySeries[fallbackIdx] ?? null;
  }, [dailySeries, hoveredDay, selectedDate, todayStr, elapsedDays]);

  const initialFocusDay = React.useMemo(() => {
    if (selectedDate) {
      const pt = dailySeries.find((d) => d.date === selectedDate);
      if (pt) return pt.day;
    }
    if (todayDay !== null) {
      return todayDay;
    }
    if (elapsedDays > 0 && elapsedDays <= daysInMonth) {
      return elapsedDays;
    }
    return 1;
  }, [selectedDate, todayDay, dailySeries, elapsedDays, daysInMonth]);

  const maxDailyValue = React.useMemo(() => {
    let maxVal = 100_000;
    for (const pt of dailySeries) {
      if (showIncome && pt.income > maxVal) maxVal = pt.income;
      if (showExpense && pt.expense > maxVal) maxVal = pt.expense;
      if (showNetLine && Math.abs(pt.net) > maxVal) maxVal = Math.abs(pt.net);
    }
    return maxVal;
  }, [dailySeries, showIncome, showExpense, showNetLine]);

  const maxCumulativeValue = React.useMemo(() => {
    let maxVal = totalBudgetLimit ?? 100_000;
    for (const pt of dailySeries) {
      if (pt.cumulative_expense > maxVal) maxVal = pt.cumulative_expense;
      if (showIncome && pt.cumulative_income > maxVal) {
        maxVal = pt.cumulative_income;
      }
    }
    return Math.max(maxVal, 100_000);
  }, [dailySeries, totalBudgetLimit, showIncome]);

  // Coordinate constants - tight margins eliminate top and bottom whitespace gaps
  const svgHeight = 200;
  const padTop = 10;
  const padBottom = 22;
  const baselineY = svgHeight - padBottom;
  const plotHeight = baselineY - padTop;

  // Sticky Y-Axis layout
  const yAxisSvgWidth = 42;

  // Time scale dynamic plot width & day step
  // FULL_MONTH: compact (approx 24px/day)
  // TWO_WEEKS: roomy zoom (46px/day, thicker bars & every day label visible)
  const padRight = 14;
  const plotSvgWidth = React.useMemo(() => {
    if (timeScale === "TWO_WEEKS") {
      return Math.round(daysInMonth * 46 + padRight);
    }
    return 760;
  }, [timeScale, daysInMonth, padRight]);

  const plotUsableWidth = plotSvgWidth - padRight;
  const dayStep = plotUsableWidth / Math.max(1, daysInMonth);

  // Smooth scroll helper to jump or center on a specific day
  const scrollToDay = React.useCallback(
    (day: number) => {
      const container = scrollContainerRef.current;
      if (!container) return;
      const dayCenterX = yAxisSvgWidth + (day - 0.5) * dayStep;
      const targetScrollLeft = dayCenterX - container.clientWidth / 2;
      const left = Math.max(0, targetScrollLeft);

      if (typeof container.scrollTo === "function") {
        container.scrollTo({
          left,
          behavior: "smooth",
        });
      } else {
        container.scrollLeft = left;
      }
    },
    [dayStep, yAxisSvgWidth]
  );

  // Auto-scroll on mount/focus-change or timeScale toggle
  React.useEffect(() => {
    const timer = setTimeout(() => {
      scrollToDay(initialFocusDay);
    }, 60);
    return () => clearTimeout(timer);
  }, [initialFocusDay, scrollToDay, timeScale]);

  const handleTimeScaleChange = (mode: TimeScaleMode) => {
    setTimeScale(mode);
  };

  const handleScrollToTransactions = (dateStr: string) => {
    onSelectDate(dateStr);
    const el = document.getElementById("drilldown-transactions-section");
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  const yForValue = (val: number, maxVal: number) => {
    const ratio = Math.max(0, Math.min(1, val / Math.max(1, maxVal)));
    return padTop + plotHeight - ratio * plotHeight;
  };

  const formatCompactRupiah = (val: number): string => {
    const abs = Math.abs(val);
    if (abs >= 1_000_000_000) {
      return `${(val / 1_000_000_000).toFixed(1)}M`;
    }
    if (abs >= 1_000_000) {
      return `${(val / 1_000_000).toFixed(1)}jt`;
    }
    if (abs >= 1_000) {
      return `${Math.round(val / 1_000)}rb`;
    }
    return String(val);
  };

  // Smooth Bézier Spline Curves
  const netCurvePoints = React.useMemo(() => {
    return dailySeries.map((pt) => ({
      x: (pt.day - 0.5) * dayStep,
      y: yForValue(Math.max(0, pt.net), maxDailyValue),
    }));
  }, [dailySeries, dayStep, maxDailyValue]);

  const netSmoothPath = React.useMemo(() => {
    return getSmoothLinePath(netCurvePoints, padTop, baselineY);
  }, [netCurvePoints, padTop, baselineY]);

  const netSmoothArea = React.useMemo(() => {
    return getSmoothAreaPath(netCurvePoints, baselineY, padTop, baselineY);
  }, [netCurvePoints, baselineY, padTop]);

  const cumulativeExpensePoints = React.useMemo(() => {
    return dailySeries.map((pt) => ({
      x: (pt.day - 0.5) * dayStep,
      y: yForValue(pt.cumulative_expense, maxCumulativeValue),
    }));
  }, [dailySeries, dayStep, maxCumulativeValue]);

  const cumulativeExpenseSmoothPath = React.useMemo(() => {
    return getSmoothLinePath(cumulativeExpensePoints, padTop, baselineY);
  }, [cumulativeExpensePoints, padTop, baselineY]);

  const cumulativeExpenseSmoothArea = React.useMemo(() => {
    return getSmoothAreaPath(
      cumulativeExpensePoints,
      baselineY,
      padTop,
      baselineY
    );
  }, [cumulativeExpensePoints, baselineY, padTop]);

  const cumulativeIncomePoints = React.useMemo(() => {
    return dailySeries.map((pt) => ({
      x: (pt.day - 0.5) * dayStep,
      y: yForValue(pt.cumulative_income, maxCumulativeValue),
    }));
  }, [dailySeries, dayStep, maxCumulativeValue]);

  const cumulativeIncomeSmoothPath = React.useMemo(() => {
    return getSmoothLinePath(cumulativeIncomePoints, padTop, baselineY);
  }, [cumulativeIncomePoints, padTop, baselineY]);

  const cumulativeIncomeSmoothArea = React.useMemo(() => {
    return getSmoothAreaPath(
      cumulativeIncomePoints,
      baselineY,
      padTop,
      baselineY
    );
  }, [cumulativeIncomePoints, baselineY, padTop]);

  const activeMax =
    chartMode === "DAILY_BARS" ? maxDailyValue : maxCumulativeValue;
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((t) =>
    Math.round(activeMax * t)
  );

  const idealPaceOnActiveDay = React.useMemo(() => {
    if (!activePoint || !totalBudgetLimit || totalBudgetLimit <= 0) {
      return null;
    }
    return Math.round((totalBudgetLimit * activePoint.day) / daysInMonth);
  }, [activePoint, totalBudgetLimit, daysInMonth]);

  // Floating mini-tooltip clamped horizontal position
  const tooltipX = React.useMemo(() => {
    if (!activePoint) return 0;
    const rawX = (activePoint.day - 0.5) * dayStep;
    // Keep pill within horizontal bounds so it doesn't get clipped
    return Math.max(90, Math.min(plotSvgWidth - 90, rawX));
  }, [activePoint, dayStep, plotSvgWidth]);

  return (
    <div
      data-testid="interactive-cashflow-chart"
      className="tabular-grid-container grid grid-cols-1 border-t border-border"
    >
      {/* Header & Interactive Mode Controls + Time Scale Toggle */}
      <div className="tabular-grid-cell flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="space-y-0.5">
          <h2 className="text-xs font-semibold text-foreground sm:text-sm">
            Grafik Arus Kas Harian
          </h2>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Sentuh tanggal pada grafik untuk memeriksa rincian transaksi.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Mode Arus Kas */}
          <div className="inline-flex rounded border border-border bg-background p-0.5">
            <button
              type="button"
              onClick={() => setChartMode("DAILY_BARS")}
              className={`nav-touch-item rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                chartMode === "DAILY_BARS"
                  ? "bg-primary text-primary-foreground font-semibold"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              Arus Harian
            </button>
            <button
              type="button"
              onClick={() => setChartMode("CUMULATIVE_BURN")}
              className={`nav-touch-item rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                chartMode === "CUMULATIVE_BURN"
                  ? "bg-primary text-primary-foreground font-semibold"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              Akumulasi & Laju Anggaran
            </button>
          </div>

          {/* Rentang Skala Waktu (1 Bulan vs 2 Minggu) */}
          <div className="inline-flex rounded border border-border bg-background p-0.5">
            <button
              type="button"
              onClick={() => handleTimeScaleChange("FULL_MONTH")}
              className={`nav-touch-item rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                timeScale === "FULL_MONTH"
                  ? "bg-muted text-foreground font-semibold"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              1 Bulan
            </button>
            <button
              type="button"
              onClick={() => handleTimeScaleChange("TWO_WEEKS")}
              className={`nav-touch-item rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                timeScale === "TWO_WEEKS"
                  ? "bg-muted text-foreground font-semibold"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              2 Minggu
            </button>
          </div>
        </div>
      </div>

      {/* Series Toggle Bar, Quick Period Jump & Live HUD Inspector */}
      <div className="tabular-grid-cell flex flex-wrap items-center justify-between gap-2.5 bg-background/50 px-4 py-2.5 text-xs">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setShowIncome((v) => !v)}
            className={`inline-flex items-center gap-1.5 rounded border px-2.5 py-1 text-xs font-medium shadow-none focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary ${
              showIncome
                ? "border-emerald-500/40 bg-card text-emerald-500"
                : "border-border bg-background text-muted-foreground opacity-60"
            }`}
          >
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
            Pemasukan
          </button>

          <button
            type="button"
            onClick={() => setShowExpense((v) => !v)}
            className={`inline-flex items-center gap-1.5 rounded border px-2.5 py-1 text-xs font-medium shadow-none focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary ${
              showExpense
                ? "border-rose-500/40 bg-card text-rose-500"
                : "border-border bg-background text-muted-foreground opacity-60"
            }`}
          >
            <span className="inline-block h-2 w-2 rounded-full bg-rose-500" />
            Pengeluaran
          </button>

          {chartMode === "DAILY_BARS" && (
            <button
              type="button"
              onClick={() => setShowNetLine((v) => !v)}
              className={`inline-flex items-center gap-1.5 rounded border px-2.5 py-1 text-xs font-medium shadow-none focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary ${
                showNetLine
                  ? "border-sky-500/40 bg-card text-sky-500"
                  : "border-border bg-background text-muted-foreground opacity-60"
              }`}
            >
              <span className="inline-block h-2 w-2 rounded-full bg-sky-500" />
              Surplus
            </button>
          )}

          {/* Quick period jump chips when in 2 Minggu mode */}
          {timeScale === "TWO_WEEKS" && (
            <div className="inline-flex items-center gap-1 text-xs">
              <span className="text-[11px] text-muted-foreground">Lompat:</span>
              <button
                type="button"
                onClick={() => scrollToDay(1)}
                className="rounded border border-border bg-card px-2 py-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                Tgl 1–15
              </button>
              <button
                type="button"
                onClick={() => scrollToDay(16)}
                className="rounded border border-border bg-card px-2 py-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                Tgl 16–{daysInMonth}
              </button>
            </div>
          )}

          {selectedDate && (
            <button
              type="button"
              onClick={() => onSelectDate(null)}
              className="rounded border border-primary/50 bg-card px-2.5 py-1 text-xs font-medium text-primary shadow-none hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
            >
              Filter: {selectedDate} ×
            </button>
          )}
        </div>

        {/* Live Hovered / Selected Day Readout */}
        {activePoint && (
          <div
            data-testid="cashflow-hud-readout"
            className="flex flex-wrap items-center gap-2 font-mono text-xs tabular-nums tracking-tight"
          >
            <span className="rounded border border-border bg-card px-2 py-0.5 font-sans text-xs font-medium text-foreground">
              {activePoint.date}
              {activePoint.day === todayDay && (
                <span className="ml-1 text-[11px] text-primary">· Hari Ini</span>
              )}{" "}
              <span className="text-muted-foreground">
                ({activePoint.tx_count} tx)
              </span>
            </span>
            {chartMode === "DAILY_BARS" ? (
              <>
                <span className="text-emerald-500">
                  +{formatRupiah(activePoint.income)}
                </span>
                <span className="text-rose-500">
                  −{formatRupiah(activePoint.expense)}
                </span>
              </>
            ) : (
              <>
                <span className="text-rose-500">
                  Kumulatif Keluar: {formatRupiah(activePoint.cumulative_expense)}
                </span>
                {idealPaceOnActiveDay !== null && (
                  <span
                    className={
                      activePoint.cumulative_expense <= idealPaceOnActiveDay
                        ? "text-emerald-500"
                        : "text-amber-500"
                    }
                  >
                    Target: {formatRupiah(idealPaceOnActiveDay)}
                  </span>
                )}
              </>
            )}

            {/* Quick drilldown jump button on HUD */}
            {activePoint.tx_count > 0 && (
              <button
                type="button"
                onClick={() => handleScrollToTransactions(activePoint.date)}
                className="inline-flex items-center gap-1 rounded border border-primary/40 bg-primary/10 px-2 py-0.5 font-sans text-xs font-medium text-primary transition-all hover:bg-primary/20 active:scale-95"
              >
                <span>Rincian</span>
                <span>↓</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Interactive Chart Canvas with Sticky Y-Axis (Zero Letterbox Gaps) */}
      <div
        ref={scrollContainerRef}
        className="tabular-grid-cell relative overflow-x-auto p-0 scrollbar-thin select-none"
      >
        <div
          className="relative flex h-[190px] sm:h-[210px]"
          style={{ minWidth: `${plotSvgWidth + yAxisSvgWidth}px` }}
        >
          {/* Sticky Y-Axis Left Column: Always visible during horizontal scroll */}
          <div
            aria-hidden="true"
            className="sticky left-0 top-0 bottom-0 z-20 w-11 sm:w-12 shrink-0 bg-card/95 backdrop-blur-xs border-r border-border/60 pointer-events-none select-none"
          >
            <svg
              viewBox={`0 0 ${yAxisSvgWidth} ${svgHeight}`}
              preserveAspectRatio="none"
              className="w-full h-full"
            >
              {yTicks.map((tickVal, idx) => {
                const y = yForValue(tickVal, activeMax);
                return (
                  <g key={idx}>
                    <line
                      x1={yAxisSvgWidth - 5}
                      y1={y}
                      x2={yAxisSvgWidth}
                      y2={y}
                      className="stroke-border"
                      strokeWidth="1"
                    />
                    <text
                      x={yAxisSvgWidth - 7}
                      y={y + 3.5}
                      textAnchor="end"
                      className="fill-muted-foreground font-mono text-[9px] sm:text-[10px]"
                    >
                      {formatCompactRupiah(tickVal)}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>

          {/* Horizontally Scrollable Main Chart Area */}
          <div
            className="relative flex-1 h-full"
            style={{ minWidth: `${plotSvgWidth}px` }}
          >
            {/* Saran #1: Floating Mini-Tooltip Pill (Mobile Peek) anchored above active day */}
            {activePoint && (
              <div
                style={{
                  left: `${tooltipX}px`,
                  top: "6px",
                }}
                className="absolute z-30 -translate-x-1/2 pointer-events-auto flex items-center gap-1.5 rounded-full border border-border/90 bg-card/95 px-2.5 py-1 text-[11px] shadow-md backdrop-blur-md transition-all duration-150 animate-in fade-in"
              >
                <span className="font-mono font-semibold text-foreground whitespace-nowrap">
                  {activePoint.date.slice(8)}
                  {activePoint.day === todayDay && " · Hari Ini"}
                </span>
                <span className="text-muted-foreground">·</span>
                {chartMode === "DAILY_BARS" ? (
                  activePoint.expense > 0 ? (
                    <span className="font-mono font-bold text-rose-500 whitespace-nowrap">
                      −{formatCompactRupiah(activePoint.expense)}
                    </span>
                  ) : activePoint.income > 0 ? (
                    <span className="font-mono font-bold text-emerald-500 whitespace-nowrap">
                      +{formatCompactRupiah(activePoint.income)}
                    </span>
                  ) : (
                    <span className="font-mono text-muted-foreground whitespace-nowrap">
                      Rp 0
                    </span>
                  )
                ) : (
                  <span className="font-mono font-bold text-rose-500 whitespace-nowrap">
                    {formatCompactRupiah(activePoint.cumulative_expense)}
                  </span>
                )}

                {activePoint.tx_count > 0 ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleScrollToTransactions(activePoint.date);
                    }}
                    className="ml-0.5 inline-flex whitespace-nowrap items-center gap-0.5 rounded-full bg-primary px-2 py-0.5 font-mono text-[10px] font-semibold text-primary-foreground shadow-xs hover:opacity-90 active:scale-95 transition-all"
                  >
                    <span>{activePoint.tx_count} tx</span>
                    <span>↓</span>
                  </button>
                ) : (
                  <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                    (0 tx)
                  </span>
                )}
              </div>
            )}

            <svg
              viewBox={`0 0 ${plotSvgWidth} ${svgHeight}`}
              preserveAspectRatio="none"
              className="w-full h-full select-none"
              role="img"
              aria-label="Grafik Interaktif Arus Kas Bulanan"
              onMouseLeave={() => setHoveredDay(null)}
            >
              {/* Gradients for smooth curve fills */}
              <defs>
                <linearGradient id="netSurplusGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#0ea5e9" stopOpacity="0.28" />
                  <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0.0" />
                </linearGradient>
                <linearGradient id="cumExpenseGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#f43f5e" stopOpacity="0.25" />
                  <stop offset="100%" stopColor="#f43f5e" stopOpacity="0.0" />
                </linearGradient>
                <linearGradient id="cumIncomeGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity="0.20" />
                  <stop offset="100%" stopColor="#10b981" stopOpacity="0.0" />
                </linearGradient>
              </defs>

              {/* Horizontal Grid Lines */}
              {yTicks.map((tickVal, idx) => {
                const y = yForValue(tickVal, activeMax);
                return (
                  <line
                    key={idx}
                    x1={0}
                    y1={y}
                    x2={plotSvgWidth}
                    y2={y}
                    className="stroke-border"
                    strokeDasharray={idx === 0 ? undefined : "3 3"}
                    strokeWidth="1"
                  />
                );
              })}

              {chartMode === "DAILY_BARS" ? (
                <>
                  {/* Daily Bars */}
                  {dailySeries.map((pt) => {
                    const groupX = (pt.day - 1) * dayStep;
                    const isSelected = selectedDate === pt.date;
                    const isHovered = hoveredDay === pt.day;
                    const isToday = pt.day === todayDay;
                    const barW =
                      timeScale === "TWO_WEEKS"
                        ? Math.max(12, dayStep * 0.38)
                        : Math.max(3.5, dayStep * 0.36);

                    const incY = yForValue(pt.income, maxDailyValue);
                    const incH = baselineY - incY;

                    const expY = yForValue(pt.expense, maxDailyValue);
                    const expH = baselineY - expY;

                    // Date label visibility: in 2 Minggu mode, show every day!
                    const showDateLabel =
                      timeScale === "TWO_WEEKS"
                        ? true
                        : pt.day === 1 ||
                          pt.day % 5 === 0 ||
                          pt.day === daysInMonth ||
                          pt.day === todayDay ||
                          isSelected ||
                          isHovered;

                    return (
                      <g
                        key={pt.date}
                        className="cursor-pointer"
                        onMouseEnter={() => setHoveredDay(pt.day)}
                        onClick={() =>
                          onSelectDate(isSelected ? null : pt.date)
                        }
                      >
                        {/* Hover / Selection Column Highlight */}
                        <rect
                          x={groupX}
                          y={padTop}
                          width={dayStep}
                          height={plotHeight}
                          rx="2"
                          fill={
                            isSelected
                              ? "rgba(16, 185, 129, 0.22)"
                              : isHovered
                                ? "rgba(16, 185, 129, 0.10)"
                                : isToday
                                  ? "rgba(16, 185, 129, 0.04)"
                                  : "transparent"
                          }
                        />

                        {/* Income Bar */}
                        {showIncome && pt.income > 0 && (
                          <rect
                            x={groupX + dayStep * 0.10}
                            y={incY}
                            width={barW}
                            height={Math.max(2, incH)}
                            fill="#10b981"
                            rx="1.5"
                          />
                        )}

                        {/* Expense Bar */}
                        {showExpense && pt.expense > 0 && (
                          <rect
                            x={groupX + dayStep * 0.52}
                            y={expY}
                            width={barW}
                            height={Math.max(2, expH)}
                            fill="#f43f5e"
                            rx="1.5"
                          />
                        )}

                        {/* X-Axis Day Label */}
                        {showDateLabel && (
                          <text
                            x={groupX + dayStep / 2}
                            y={svgHeight - 6}
                            textAnchor="middle"
                            className={`font-mono text-[10px] select-none ${
                              isSelected || isHovered
                                ? "fill-primary font-bold"
                                : pt.day === todayDay
                                  ? "fill-primary font-semibold"
                                  : "fill-muted-foreground"
                            }`}
                          >
                            {String(pt.day).padStart(2, "0")}
                          </text>
                        )}
                      </g>
                    );
                  })}

                  {/* Smooth Daily Surplus Curve with Gradient Area Fill */}
                  {showNetLine && (
                    <>
                      <path
                        d={netSmoothArea}
                        fill="url(#netSurplusGrad)"
                        pointerEvents="none"
                      />
                      <path
                        d={netSmoothPath}
                        fill="none"
                        stroke="#0ea5e9"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        pointerEvents="none"
                      />

                      {/* Active / Focused Day Dot on the Curve */}
                      {activePoint && (
                        <g pointerEvents="none">
                          <circle
                            cx={(activePoint.day - 0.5) * dayStep}
                            cy={yForValue(
                              Math.max(0, activePoint.net),
                              maxDailyValue
                            )}
                            r="6"
                            fill="#0ea5e9"
                            opacity="0.25"
                          />
                          <circle
                            cx={(activePoint.day - 0.5) * dayStep}
                            cy={yForValue(
                              Math.max(0, activePoint.net),
                              maxDailyValue
                            )}
                            r="3.5"
                            fill="#0ea5e9"
                            stroke="var(--color-card)"
                            strokeWidth="1.5"
                          />
                        </g>
                      )}
                    </>
                  )}
                </>
              ) : (
                <>
                  {/* Ideal Budget Pace Diagonal Line & Ceiling */}
                  {totalBudgetLimit !== null && totalBudgetLimit > 0 && (
                    <>
                      <line
                        x1={0}
                        y1={yForValue(totalBudgetLimit, maxCumulativeValue)}
                        x2={plotSvgWidth}
                        y2={yForValue(totalBudgetLimit, maxCumulativeValue)}
                        stroke="#f59e0b"
                        strokeDasharray="6 4"
                        strokeWidth="1.5"
                      />
                      <line
                        x1={0}
                        y1={baselineY}
                        x2={plotUsableWidth}
                        y2={yForValue(totalBudgetLimit, maxCumulativeValue)}
                        stroke="#10b981"
                        strokeDasharray="4 4"
                        strokeWidth="1.5"
                      />
                    </>
                  )}

                  {/* Cumulative Income Smooth Curve */}
                  {showIncome && (
                    <>
                      <path
                        d={cumulativeIncomeSmoothArea}
                        fill="url(#cumIncomeGrad)"
                        pointerEvents="none"
                      />
                      <path
                        d={cumulativeIncomeSmoothPath}
                        fill="none"
                        stroke="#10b981"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        pointerEvents="none"
                      />
                    </>
                  )}

                  {/* Cumulative Expense Smooth Curve */}
                  {showExpense && (
                    <>
                      <path
                        d={cumulativeExpenseSmoothArea}
                        fill="url(#cumExpenseGrad)"
                        pointerEvents="none"
                      />
                      <path
                        d={cumulativeExpenseSmoothPath}
                        fill="none"
                        stroke="#f43f5e"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        pointerEvents="none"
                      />
                    </>
                  )}

                  {/* Interactive Day Columns & Dots */}
                  {dailySeries.map((pt) => {
                    const groupX = (pt.day - 1) * dayStep;
                    const centerX = (pt.day - 0.5) * dayStep;
                    const expY = yForValue(
                      pt.cumulative_expense,
                      maxCumulativeValue
                    );
                    const isSelected = selectedDate === pt.date;
                    const isHovered = hoveredDay === pt.day;
                    const isToday = pt.day === todayDay;

                    const showDateLabel =
                      timeScale === "TWO_WEEKS"
                        ? true
                        : pt.day === 1 ||
                          pt.day % 5 === 0 ||
                          pt.day === daysInMonth ||
                          pt.day === todayDay ||
                          isSelected ||
                          isHovered;

                    return (
                      <g
                        key={pt.date}
                        className="cursor-pointer"
                        onMouseEnter={() => setHoveredDay(pt.day)}
                        onClick={() =>
                          onSelectDate(isSelected ? null : pt.date)
                        }
                      >
                        <rect
                          x={groupX}
                          y={padTop}
                          width={dayStep}
                          height={plotHeight}
                          rx="2"
                          fill={
                            isSelected
                              ? "rgba(16, 185, 129, 0.22)"
                              : isHovered
                                ? "rgba(16, 185, 129, 0.10)"
                                : isToday
                                  ? "rgba(16, 185, 129, 0.04)"
                                  : "transparent"
                          }
                        />

                        {showExpense && (
                          <circle
                            cx={centerX}
                            cy={expY}
                            r={isSelected || isHovered ? 4.5 : 2.5}
                            fill="#f43f5e"
                            stroke="var(--color-card)"
                            strokeWidth={isSelected || isHovered ? 1.5 : 1}
                          />
                        )}

                        {showDateLabel && (
                          <text
                            x={centerX}
                            y={svgHeight - 6}
                            textAnchor="middle"
                            className={`font-mono text-[10px] select-none ${
                              isSelected || isHovered
                                ? "fill-primary font-bold"
                                : pt.day === todayDay
                                  ? "fill-primary font-semibold"
                                  : "fill-muted-foreground"
                            }`}
                          >
                            {String(pt.day).padStart(2, "0")}
                          </text>
                        )}
                      </g>
                    );
                  })}
                </>
              )}
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
};
