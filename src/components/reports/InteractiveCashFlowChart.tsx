import * as React from "react";
import { TrendingDown, TrendingUp, X } from "lucide-react";
import type { DailyCashFlowPoint } from "../../lib/tauri-api";
import { formatRupiah } from "../../lib/utils";
import { formatDateReadable } from "../../lib/date";

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

const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? React.useLayoutEffect : React.useEffect;

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
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    let cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
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

/**
 * Computes a clean 4-interval upper bound so Y-axis ticks stay legible
 * (e.g. 0, 2,5jt, 5jt, 7,5jt, 10jt) without multi-decimal clutter.
 */
function getNiceMaxValue(rawMax: number): number {
  const safeMax = Math.max(100_000, rawMax);
  const stepTarget = safeMax / 4;
  const magnitude = Math.pow(10, Math.floor(Math.log10(stepTarget)));
  const residual = stepTarget / magnitude;

  let multiplier = 10;
  if (residual <= 1) multiplier = 1;
  else if (residual <= 1.5) multiplier = 1.5;
  else if (residual <= 2) multiplier = 2;
  else if (residual <= 2.5) multiplier = 2.5;
  else if (residual <= 3) multiplier = 3;
  else if (residual <= 5) multiplier = 5;

  return Math.round(multiplier * magnitude * 4);
}

function formatAxisCompactRupiah(val: number): string {
  const abs = Math.abs(val);
  if (abs === 0) return "0";
  if (abs >= 1_000_000_000) {
    const num = new Intl.NumberFormat("id-ID", {
      maximumFractionDigits: 1,
    }).format(abs / 1_000_000_000);
    return `${num}M`;
  }
  if (abs >= 1_000_000) {
    const num = new Intl.NumberFormat("id-ID", {
      maximumFractionDigits: 1,
    }).format(abs / 1_000_000);
    return `${num}jt`;
  }
  if (abs >= 1_000) {
    return `${Math.round(abs / 1_000)}rb`;
  }
  return String(abs);
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
  const [activePeriodHalf, setActivePeriodHalf] = React.useState<
    "FIRST" | "SECOND"
  >("FIRST");

  const plotContainerRef = React.useRef<HTMLDivElement>(null);

  const [isDesktopViewport, setIsDesktopViewport] = React.useState<boolean>(
    () => (typeof window !== "undefined" ? window.innerWidth >= 640 : true)
  );
  const [plotViewportWidth, setPlotViewportWidth] = React.useState<number>(
    () => (typeof window !== "undefined" && window.innerWidth < 640 ? 280 : 640)
  );

  // Measure plot viewport width & responsive breakpoint for exact 1:1 SVG pixel geometry
  useIsomorphicLayoutEffect(() => {
    const updateMeasurements = () => {
      if (typeof window !== "undefined") {
        setIsDesktopViewport(window.innerWidth >= 640);
      }
      const el = plotContainerRef.current;
      if (el && el.clientWidth > 0) {
        setPlotViewportWidth(el.clientWidth);
      }
    };

    updateMeasurements();

    const el = plotContainerRef.current;
    let observer: ResizeObserver | null = null;
    if (el && typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver((entries) => {
        const width = entries[0]?.contentRect.width ?? el.clientWidth;
        if (width > 0) {
          setPlotViewportWidth(Math.round(width));
        }
        if (typeof window !== "undefined") {
          setIsDesktopViewport(window.innerWidth >= 640);
        }
      });
      observer.observe(el);
    }

    window.addEventListener("resize", updateMeasurements);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", updateMeasurements);
    };
  }, []);

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

  const selectedPoint = React.useMemo(() => {
    if (!selectedDate) return null;
    return dailySeries.find((d) => d.date === selectedDate) ?? null;
  }, [dailySeries, selectedDate]);

  const hoveredPoint = React.useMemo(() => {
    if (hoveredDay === null) return null;
    return dailySeries.find((d) => d.day === hoveredDay) ?? null;
  }, [dailySeries, hoveredDay]);

  const fallbackPoint = React.useMemo(() => {
    if (dailySeries.length === 0) return null;
    const todayPt = dailySeries.find((d) => d.date === todayStr);
    if (todayPt) return todayPt;
    const fallbackIdx = Math.min(
      Math.max(0, elapsedDays - 1),
      dailySeries.length - 1
    );
    return dailySeries[fallbackIdx] ?? dailySeries[0] ?? null;
  }, [dailySeries, todayStr, elapsedDays]);

  const isPreviewingOtherDay =
    hoveredDay !== null && hoveredDay !== selectedPoint?.day;
  const hudPoint = isPreviewingOtherDay
    ? (hoveredPoint ?? fallbackPoint)
    : (selectedPoint ?? fallbackPoint);
  const isLockedSelection = selectedPoint !== null && !isPreviewingOtherDay;
  const activeDotDay = hudPoint?.day ?? null;

  const initialFocusDay = React.useMemo(() => {
    if (selectedPoint) return selectedPoint.day;
    if (todayDay !== null) return todayDay;
    if (elapsedDays > 0 && elapsedDays <= daysInMonth) return elapsedDays;
    return 1;
  }, [selectedPoint, todayDay, elapsedDays, daysInMonth]);

  const rawMaxDailyValue = React.useMemo(() => {
    let maxVal = 100_000;
    for (const pt of dailySeries) {
      if (showIncome && pt.income > maxVal) maxVal = pt.income;
      if (showExpense && pt.expense > maxVal) maxVal = pt.expense;
      if (showNetLine && Math.abs(pt.net) > maxVal) maxVal = Math.abs(pt.net);
    }
    return maxVal;
  }, [dailySeries, showIncome, showExpense, showNetLine]);

  const rawMaxCumulativeValue = React.useMemo(() => {
    let maxVal = totalBudgetLimit ?? 100_000;
    for (const pt of dailySeries) {
      if (showExpense && pt.cumulative_expense > maxVal) {
        maxVal = pt.cumulative_expense;
      }
      if (showIncome && pt.cumulative_income > maxVal) {
        maxVal = pt.cumulative_income;
      }
    }
    return Math.max(maxVal, 100_000);
  }, [dailySeries, totalBudgetLimit, showIncome, showExpense]);

  const activeMax = React.useMemo(() => {
    const raw =
      chartMode === "DAILY_BARS" ? rawMaxDailyValue : rawMaxCumulativeValue;
    return getNiceMaxValue(raw);
  }, [chartMode, rawMaxDailyValue, rawMaxCumulativeValue]);

  const yTicks = React.useMemo(
    () => [0, 0.25, 0.5, 0.75, 1].map((t) => Math.round(activeMax * t)),
    [activeMax]
  );

  // Coordinate constants matched 1:1 with CSS dimensions
  const svgHeight = isDesktopViewport ? 216 : 200;
  const yAxisSvgWidth = isDesktopViewport ? 48 : 44;
  const padTop = 16;
  const padBottom = 24;
  const padLeft = 8;
  const padRight = 8;
  const baselineY = svgHeight - padBottom;
  const plotHeight = baselineY - padTop;

  // Dynamic plot width: FULL_MONTH fits viewport width; TWO_WEEKS zooms for smooth scrolling
  const dayStep = React.useMemo(() => {
    const safeDays = Math.max(1, daysInMonth);
    const innerViewport = Math.max(180, plotViewportWidth - padLeft - padRight);
    if (timeScale === "TWO_WEEKS") {
      return Math.max(36, Math.floor(innerViewport / 14));
    }
    return innerViewport / safeDays;
  }, [timeScale, daysInMonth, plotViewportWidth]);

  const plotSvgWidth = React.useMemo(() => {
    if (timeScale === "TWO_WEEKS") {
      return Math.max(
        plotViewportWidth,
        Math.round(daysInMonth * dayStep + padLeft + padRight)
      );
    }
    return Math.max(200, plotViewportWidth);
  }, [timeScale, plotViewportWidth, daysInMonth, dayStep]);

  const plotUsableWidth = Math.max(1, plotSvgWidth - padLeft - padRight);

  const dayCenterX = React.useCallback(
    (day: number) => padLeft + (day - 0.5) * dayStep,
    [dayStep]
  );

  const yForValue = React.useCallback(
    (val: number, maxVal: number) => {
      const ratio = Math.max(0, Math.min(1, val / Math.max(1, maxVal)));
      return padTop + plotHeight - ratio * plotHeight;
    },
    [padTop, plotHeight]
  );

  // Smooth scroll helper for TWO_WEEKS mode
  const scrollToDay = React.useCallback(
    (day: number, smooth = true) => {
      const container = plotContainerRef.current;
      if (!container) return;
      const centerX = dayCenterX(day);
      const maxScroll = Math.max(0, plotSvgWidth - container.clientWidth);
      const targetScrollLeft = Math.max(
        0,
        Math.min(maxScroll, centerX - container.clientWidth / 2)
      );

      setActivePeriodHalf(day <= 15 ? "FIRST" : "SECOND");

      if (typeof container.scrollTo === "function") {
        container.scrollTo({
          left: targetScrollLeft,
          behavior: smooth ? "smooth" : "auto",
        });
      } else {
        container.scrollLeft = targetScrollLeft;
      }
    },
    [dayCenterX, plotSvgWidth]
  );

  const prevTimeScaleRef = React.useRef<TimeScaleMode>(timeScale);

  // Position scroll view only when switching between FULL_MONTH and TWO_WEEKS
  React.useEffect(() => {
    const prevScale = prevTimeScaleRef.current;
    prevTimeScaleRef.current = timeScale;

    if (timeScale !== "TWO_WEEKS") {
      const container = plotContainerRef.current;
      if (container) {
        container.scrollLeft = 0;
      }
      return;
    }

    if (prevScale !== "TWO_WEEKS") {
      const timer = setTimeout(() => {
        scrollToDay(initialFocusDay, false);
      }, 20);
      return () => clearTimeout(timer);
    }
  }, [timeScale, initialFocusDay, scrollToDay]);

  const handleScrollSync = React.useCallback(() => {
    if (timeScale !== "TWO_WEEKS") return;
    const container = plotContainerRef.current;
    if (!container) return;
    const centerViewportX = container.scrollLeft + container.clientWidth / 2;
    const approxDay = (centerViewportX - padLeft) / Math.max(1, dayStep) + 0.5;
    setActivePeriodHalf(approxDay <= 15.5 ? "FIRST" : "SECOND");
  }, [timeScale, dayStep]);

  const handleScrollToTransactions = (dateStr: string) => {
    onSelectDate(dateStr);
    const el = document.getElementById("drilldown-transactions-section");
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  // Collision-free X-axis label set for FULL_MONTH mode
  const visibleLabelDays = React.useMemo(() => {
    if (timeScale === "TWO_WEEKS") {
      return new Set(dailySeries.map((pt) => pt.day));
    }

    const candidates: number[] = [];
    const pushUnique = (day: number | null) => {
      if (
        day !== null &&
        day >= 1 &&
        day <= daysInMonth &&
        !candidates.includes(day)
      ) {
        candidates.push(day);
      }
    };

    pushUnique(hoveredDay);
    pushUnique(selectedPoint?.day ?? null);
    pushUnique(todayDay);
    pushUnique(1);
    pushUnique(daysInMonth);
    for (const d of [5, 10, 15, 20, 25]) {
      if (d < daysInMonth) pushUnique(d);
    }

    const accepted = new Set<number>();
    const acceptedXs: number[] = [];
    const minSpacingPx = 20;

    for (const day of candidates) {
      const cx = dayCenterX(day);
      if (acceptedXs.every((existingX) => Math.abs(existingX - cx) >= minSpacingPx)) {
        accepted.add(day);
        acceptedXs.push(cx);
      }
    }

    return accepted;
  }, [
    timeScale,
    dailySeries,
    daysInMonth,
    hoveredDay,
    selectedPoint,
    todayDay,
    dayCenterX,
  ]);

  // Smooth Bézier Spline Curves
  const netCurvePoints = React.useMemo(() => {
    return dailySeries.map((pt) => ({
      x: dayCenterX(pt.day),
      y: yForValue(Math.max(0, pt.net), activeMax),
    }));
  }, [dailySeries, dayCenterX, yForValue, activeMax]);

  const netSmoothPath = React.useMemo(
    () => getSmoothLinePath(netCurvePoints, padTop, baselineY),
    [netCurvePoints, padTop, baselineY]
  );

  const netSmoothArea = React.useMemo(
    () => getSmoothAreaPath(netCurvePoints, baselineY, padTop, baselineY),
    [netCurvePoints, baselineY, padTop]
  );

  const cumulativeExpensePoints = React.useMemo(() => {
    return dailySeries.map((pt) => ({
      x: dayCenterX(pt.day),
      y: yForValue(pt.cumulative_expense, activeMax),
    }));
  }, [dailySeries, dayCenterX, yForValue, activeMax]);

  const cumulativeExpenseSmoothPath = React.useMemo(
    () => getSmoothLinePath(cumulativeExpensePoints, padTop, baselineY),
    [cumulativeExpensePoints, padTop, baselineY]
  );

  const cumulativeExpenseSmoothArea = React.useMemo(
    () =>
      getSmoothAreaPath(
        cumulativeExpensePoints,
        baselineY,
        padTop,
        baselineY
      ),
    [cumulativeExpensePoints, baselineY, padTop]
  );

  const cumulativeIncomePoints = React.useMemo(() => {
    return dailySeries.map((pt) => ({
      x: dayCenterX(pt.day),
      y: yForValue(pt.cumulative_income, activeMax),
    }));
  }, [dailySeries, dayCenterX, yForValue, activeMax]);

  const cumulativeIncomeSmoothPath = React.useMemo(
    () => getSmoothLinePath(cumulativeIncomePoints, padTop, baselineY),
    [cumulativeIncomePoints, padTop, baselineY]
  );

  const cumulativeIncomeSmoothArea = React.useMemo(
    () =>
      getSmoothAreaPath(
        cumulativeIncomePoints,
        baselineY,
        padTop,
        baselineY
      ),
    [cumulativeIncomePoints, baselineY, padTop]
  );

  const idealPaceOnHudDay = React.useMemo(() => {
    if (!hudPoint || !totalBudgetLimit || totalBudgetLimit <= 0) {
      return null;
    }
    return Math.round((totalBudgetLimit * hudPoint.day) / Math.max(1, daysInMonth));
  }, [hudPoint, totalBudgetLimit, daysInMonth]);

  // Bar dimensions based on active series toggles & slot width
  const bothBarsEnabled = showIncome && showExpense;
  const pairGap = dayStep >= 16 ? 2 : 1;
  const barW = bothBarsEnabled
    ? Math.max(2, Math.min(14, (dayStep * 0.72 - pairGap) / 2))
    : Math.max(3, Math.min(18, dayStep * 0.52));

  return (
    <div
      data-testid="interactive-cashflow-chart"
      className="glass-card overflow-hidden"
    >
      {/* Header & Single-Row Compact Control Bar */}
      <div className="flex flex-col gap-3 border-b border-border/70 px-4 py-3.5 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-0.5">
          <h2 className="text-sm font-semibold tracking-tight text-foreground sm:text-base">
            Grafik Arus Kas Harian
          </h2>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Ketuk tanggal pada grafik untuk rincian transaksi.
          </p>
        </div>

        <div className="flex items-center justify-between gap-2 sm:justify-end">
          {/* Mode Toggle: Capsule Segmented Control */}
          <div className="inline-flex items-center rounded-full border border-border bg-muted/60 p-0.5">
            <button
              type="button"
              onClick={() => setChartMode("DAILY_BARS")}
              className={`nav-touch-item rounded-full px-2.5 py-1 text-xs transition-all sm:px-3 ${
                chartMode === "DAILY_BARS"
                  ? "bg-cta-surface text-cta-foreground font-semibold"
                  : "text-muted-foreground hover:text-foreground font-medium"
              }`}
            >
              Arus Harian
            </button>
            <button
              type="button"
              aria-label="Akumulasi & Laju Anggaran"
              title="Akumulasi & Laju Anggaran"
              onClick={() => setChartMode("CUMULATIVE_BURN")}
              className={`nav-touch-item rounded-full px-2.5 py-1 text-xs transition-all sm:px-3 ${
                chartMode === "CUMULATIVE_BURN"
                  ? "bg-cta-surface text-cta-foreground font-semibold"
                  : "text-muted-foreground hover:text-foreground font-medium"
              }`}
            >
              Akumulasi
            </button>
          </div>

          {/* Time Scale Toggle: Capsule Segmented Control */}
          <div className="inline-flex shrink-0 items-center rounded-full border border-border bg-muted/60 p-0.5">
            <button
              type="button"
              aria-label="Skala 1 Bulan"
              onClick={() => setTimeScale("FULL_MONTH")}
              className={`nav-touch-item rounded-full px-2.5 py-1 text-xs transition-all sm:px-3 ${
                timeScale === "FULL_MONTH"
                  ? "bg-cta-surface text-cta-foreground font-semibold"
                  : "text-muted-foreground hover:text-foreground font-medium"
              }`}
            >
              <span className="sm:hidden">1 Bln</span>
              <span className="hidden sm:inline">1 Bulan</span>
            </button>
            <button
              type="button"
              aria-label="Skala 2 Minggu"
              onClick={() => setTimeScale("TWO_WEEKS")}
              className={`nav-touch-item rounded-full px-2.5 py-1 text-xs transition-all sm:px-3 ${
                timeScale === "TWO_WEEKS"
                  ? "bg-cta-surface text-cta-foreground font-semibold"
                  : "text-muted-foreground hover:text-foreground font-medium"
              }`}
            >
              <span className="sm:hidden">2 Mgg</span>
              <span className="hidden sm:inline">2 Minggu</span>
            </button>
          </div>
        </div>
      </div>

      {/* Series Filter Row + Unified HUD Strip */}
      <div className="flex flex-col gap-2.5 border-b border-border/70 bg-black/[0.02] px-4 py-3 dark:bg-white/[0.02] sm:px-5">
        {/* Single-row Series Toggle Bar */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-nowrap items-center gap-1.5 overflow-x-auto no-scrollbar sm:flex-wrap">
            <button
              type="button"
              aria-pressed={showIncome}
              onClick={() => setShowIncome((v) => !v)}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium whitespace-nowrap transition-colors ${
                showIncome
                  ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-600 dark:text-emerald-300"
                  : "border-border bg-black/[0.03] text-muted-foreground opacity-60 dark:bg-white/[0.04]"
              }`}
            >
              <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400" />
              <span>Pemasukan</span>
            </button>

            <button
              type="button"
              aria-pressed={showExpense}
              onClick={() => setShowExpense((v) => !v)}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium whitespace-nowrap transition-colors ${
                showExpense
                  ? "border-rose-500/40 bg-rose-500/15 text-rose-500 dark:text-rose-300"
                  : "border-border bg-black/[0.03] text-muted-foreground opacity-60 dark:bg-white/[0.04]"
              }`}
            >
              <span className="h-2 w-2 shrink-0 rounded-full bg-rose-400" />
              <span>Pengeluaran</span>
            </button>

            {chartMode === "DAILY_BARS" && (
              <button
                type="button"
                aria-pressed={showNetLine}
                onClick={() => setShowNetLine((v) => !v)}
                className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium whitespace-nowrap transition-colors ${
                  showNetLine
                    ? "border-sky-500/40 bg-sky-500/15 text-sky-600 dark:text-sky-300"
                    : "border-border bg-black/[0.03] text-muted-foreground opacity-60 dark:bg-white/[0.04]"
                }`}
              >
                <span className="h-2 w-2 shrink-0 rounded-full bg-sky-400" />
                <span>Surplus</span>
              </button>
            )}
          </div>

          {chartMode === "CUMULATIVE_BURN" &&
            totalBudgetLimit !== null &&
            totalBudgetLimit > 0 && (
              <div className="hidden shrink-0 items-center gap-2.5 text-[11px] text-muted-foreground sm:flex">
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block h-0.5 w-3 border-t-2 border-dashed border-amber-500" />
                  <span>Batas</span>
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block h-0.5 w-3 border-t-2 border-dashed border-emerald-400" />
                  <span>Laju Ideal</span>
                </span>
              </div>
            )}
        </div>

        {/* Single Unified Compact HUD Readout Bar (Zero Overlap with Chart) */}
        {hudPoint && (
          <div
            data-testid="cashflow-hud-readout"
            className={`rounded-xl border px-3 py-2 text-xs transition-colors ${
              isLockedSelection
                ? "border-primary/30 bg-primary/[0.06]"
                : "border-border/70 bg-muted/40"
            }`}
          >
            {/* Row 1: Date + Tx Count + Drilldown/Clear Actions */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                <span className="truncate font-semibold text-foreground">
                  {formatDateReadable(hudPoint.date, {
                    withDayName: true,
                    relativePrefix: false,
                  })}
                </span>
                {hudPoint.day === todayDay && (
                  <span className="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">
                    Hari Ini
                  </span>
                )}
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  · {hudPoint.tx_count} transaksi
                </span>
              </div>

              {isLockedSelection ? (
                <div className="flex shrink-0 items-center gap-1.5">
                  {hudPoint.tx_count > 0 && (
                    <button
                      type="button"
                      onClick={() => handleScrollToTransactions(hudPoint.date)}
                      className="inline-flex items-center gap-1 rounded-full bg-cta-surface px-2.5 py-0.5 text-[11px] font-semibold text-cta-foreground transition-opacity hover:opacity-90 active:scale-95"
                    >
                      <span>Rincian</span>
                      <span aria-hidden="true">↓</span>
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label="Hapus filter tanggal"
                    title="Hapus filter tanggal"
                    onClick={() => onSelectDate(null)}
                    className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              ) : (
                <span className="hidden shrink-0 text-[11px] text-muted-foreground sm:inline">
                  Ketuk tanggal untuk filter
                </span>
              )}
            </div>

            {/* Row 2: Full-width Monospace Monetary Readout */}
            <div className="mt-1 flex flex-wrap items-center gap-x-3.5 gap-y-0.5 font-mono text-xs tabular-nums tracking-tight">
              {chartMode === "DAILY_BARS" ? (
                <>
                  <span className="inline-flex items-center gap-1 font-semibold text-emerald-600 dark:text-emerald-400">
                    <TrendingUp
                      className="h-3 w-3 shrink-0"
                      aria-hidden="true"
                    />
                    <span>
                      {hudPoint.income > 0
                        ? `+${formatRupiah(hudPoint.income)}`
                        : "Rp 0"}
                    </span>
                  </span>
                  <span className="inline-flex items-center gap-1 font-semibold text-rose-600 dark:text-rose-400">
                    <TrendingDown
                      className="h-3 w-3 shrink-0"
                      aria-hidden="true"
                    />
                    <span>
                      {hudPoint.expense > 0
                        ? `−${formatRupiah(hudPoint.expense)}`
                        : "Rp 0"}
                    </span>
                  </span>
                </>
              ) : (
                <>
                  <span className="inline-flex items-center gap-1 font-semibold text-rose-600 dark:text-rose-400">
                    <TrendingDown
                      className="h-3 w-3 shrink-0"
                      aria-hidden="true"
                    />
                    <span>
                      Kumulatif Keluar:{" "}
                      {formatRupiah(hudPoint.cumulative_expense)}
                    </span>
                  </span>
                  {idealPaceOnHudDay !== null && (
                    <span
                      className={`font-sans text-[11px] font-medium ${
                        hudPoint.cumulative_expense <= idealPaceOnHudDay
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-amber-600 dark:text-amber-400"
                      }`}
                    >
                      (Target: {formatRupiah(idealPaceOnHudDay)})
                    </span>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Chart Canvas: Non-Scrolling Fixed Y-Axis + Responsive Plot Viewport */}
      {dailySeries.length === 0 ? (
        <div className="flex h-[200px] items-center justify-center p-6 text-center text-xs text-muted-foreground sm:h-[216px]">
          Belum ada data arus kas pada bulan ini.
        </div>
      ) : (
        <div className="flex h-[200px] select-none sm:h-[216px]">
          {/* Non-Scrolling Y-Axis Column (inherits glass-card surface cleanly) */}
          <div
            aria-hidden="true"
            className="w-11 shrink-0 border-r border-border/70 sm:w-12"
          >
            <svg
              width={yAxisSvgWidth}
              height={svgHeight}
              viewBox={`0 0 ${yAxisSvgWidth} ${svgHeight}`}
              className="block h-full w-full"
            >
              {yTicks.map((tickVal, idx) => {
                const y = yForValue(tickVal, activeMax);
                return (
                  <g key={idx}>
                    <line
                      x1={yAxisSvgWidth - 4}
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
                      {formatAxisCompactRupiah(tickVal)}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>

          {/* Plot Viewport: Fit-to-Width in FULL_MONTH, Scrollable in TWO_WEEKS */}
          <div
            ref={plotContainerRef}
            onScroll={handleScrollSync}
            className={`relative min-w-0 flex-1 ${
              timeScale === "TWO_WEEKS"
                ? "overflow-x-auto scrollbar-thin"
                : "overflow-x-hidden"
            }`}
          >
            <div style={{ width: `${plotSvgWidth}px`, height: `${svgHeight}px` }}>
              <svg
                width={plotSvgWidth}
                height={svgHeight}
                viewBox={`0 0 ${plotSvgWidth} ${svgHeight}`}
                className="block select-none"
                role="img"
                aria-label="Grafik Interaktif Arus Kas Bulanan"
                onMouseLeave={() => setHoveredDay(null)}
              >
                {/* Gradients for smooth curve fills */}
                <defs>
                  <linearGradient
                    id="netSurplusGrad"
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.28" />
                    <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.0" />
                  </linearGradient>
                  <linearGradient
                    id="cumExpenseGrad"
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop offset="0%" stopColor="#fb7185" stopOpacity="0.26" />
                    <stop offset="100%" stopColor="#fb7185" stopOpacity="0.0" />
                  </linearGradient>
                  <linearGradient
                    id="cumIncomeGrad"
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop offset="0%" stopColor="#34d399" stopOpacity="0.22" />
                    <stop offset="100%" stopColor="#34d399" stopOpacity="0.0" />
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
                      strokeOpacity={idx === 0 ? 1 : 0.7}
                      strokeWidth="1"
                    />
                  );
                })}

                {chartMode === "DAILY_BARS" ? (
                  <>
                    {/* Daily Bars */}
                    {dailySeries.map((pt) => {
                      const groupX = padLeft + (pt.day - 1) * dayStep;
                      const cx = dayCenterX(pt.day);
                      const isSelected = selectedDate === pt.date;
                      const isHovered = hoveredDay === pt.day;
                      const isToday = pt.day === todayDay;
                      const isDimmed =
                        selectedDate !== null && !isSelected && !isHovered;

                      const incX = bothBarsEnabled
                        ? cx - pairGap / 2 - barW
                        : cx - barW / 2;
                      const expX = bothBarsEnabled
                        ? cx + pairGap / 2
                        : cx - barW / 2;

                      const rawIncY = yForValue(pt.income, activeMax);
                      const incH = Math.max(3, baselineY - rawIncY);
                      const incY = Math.min(rawIncY, baselineY - 3);

                      const rawExpY = yForValue(pt.expense, activeMax);
                      const expH = Math.max(3, baselineY - rawExpY);
                      const expY = Math.min(rawExpY, baselineY - 3);

                      const showDateLabel = visibleLabelDays.has(pt.day);

                      return (
                        <g
                          key={pt.date}
                          data-testid={`cashflow-day-group-${pt.day}`}
                          role="button"
                          tabIndex={0}
                          aria-label={`${formatDateReadable(pt.date, {
                            withDayName: true,
                            relativePrefix: false,
                          })}: Pemasukan ${formatRupiah(pt.income)}, Pengeluaran ${formatRupiah(pt.expense)}`}
                          className="cursor-pointer outline-none"
                          onMouseEnter={() => setHoveredDay(pt.day)}
                          onFocus={() => setHoveredDay(pt.day)}
                          onBlur={() => setHoveredDay(null)}
                          onClick={() =>
                            onSelectDate(isSelected ? null : pt.date)
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              onSelectDate(isSelected ? null : pt.date);
                            }
                          }}
                        >
                          {/* Full-height Tap & Hover Column */}
                          <rect
                            x={groupX}
                            y={padTop}
                            width={Math.max(1, dayStep)}
                            height={plotHeight}
                            rx="3"
                            fill={
                              isSelected
                                ? "rgba(161, 161, 170, 0.18)"
                                : isHovered
                                  ? "rgba(161, 161, 170, 0.1)"
                                  : isToday
                                    ? "rgba(161, 161, 170, 0.05)"
                                    : "transparent"
                            }
                          />

                          {/* Income Bar */}
                          {showIncome && pt.income > 0 && (
                            <rect
                              x={incX}
                              y={incY}
                              width={barW}
                              height={incH}
                              fill="#34d399"
                              rx={barW >= 5 ? "2" : "1"}
                              opacity={isDimmed ? 0.35 : 1}
                              className="transition-opacity duration-150"
                            />
                          )}

                          {/* Expense Bar */}
                          {showExpense && pt.expense > 0 && (
                            <rect
                              x={expX}
                              y={expY}
                              width={barW}
                              height={expH}
                              fill="#fb7185"
                              rx={barW >= 5 ? "2" : "1"}
                              opacity={isDimmed ? 0.35 : 1}
                              className="transition-opacity duration-150"
                            />
                          )}

                          {/* X-Axis Day Label */}
                          {showDateLabel && (
                            <text
                              x={cx}
                              y={svgHeight - 7}
                              textAnchor="middle"
                              className={`font-mono text-[10px] select-none ${
                                isSelected || isHovered
                                  ? "fill-foreground font-bold"
                                  : isToday
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
                          stroke="#38bdf8"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          pointerEvents="none"
                        />

                        {hudPoint && (
                          <g pointerEvents="none">
                            <circle
                              cx={dayCenterX(hudPoint.day)}
                              cy={yForValue(
                                Math.max(0, hudPoint.net),
                                activeMax
                              )}
                              r="6"
                              fill="#38bdf8"
                              opacity="0.25"
                            />
                            <circle
                              cx={dayCenterX(hudPoint.day)}
                              cy={yForValue(
                                Math.max(0, hudPoint.net),
                                activeMax
                              )}
                              r="3.5"
                              fill="#38bdf8"
                              stroke="var(--color-floating-surface)"
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
                          x1={padLeft}
                          y1={yForValue(totalBudgetLimit, activeMax)}
                          x2={padLeft + plotUsableWidth}
                          y2={yForValue(totalBudgetLimit, activeMax)}
                          stroke="#f59e0b"
                          strokeDasharray="6 4"
                          strokeWidth="1.5"
                        />
                        <line
                          x1={padLeft}
                          y1={baselineY}
                          x2={padLeft + plotUsableWidth}
                          y2={yForValue(totalBudgetLimit, activeMax)}
                          stroke="#34d399"
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
                          stroke="#34d399"
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
                          stroke="#fb7185"
                          strokeWidth="2.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          pointerEvents="none"
                        />
                      </>
                    )}

                    {/* Interactive Day Columns & Dots */}
                    {dailySeries.map((pt) => {
                      const groupX = padLeft + (pt.day - 1) * dayStep;
                      const cx = dayCenterX(pt.day);
                      const expY = yForValue(pt.cumulative_expense, activeMax);
                      const incY = yForValue(pt.cumulative_income, activeMax);
                      const isSelected = selectedDate === pt.date;
                      const isHovered = hoveredDay === pt.day;
                      const isFocusedDot = pt.day === activeDotDay;
                      const isToday = pt.day === todayDay;
                      const showDateLabel = visibleLabelDays.has(pt.day);

                      return (
                        <g
                          key={pt.date}
                          data-testid={`cashflow-day-group-${pt.day}`}
                          role="button"
                          tabIndex={0}
                          aria-label={`${formatDateReadable(pt.date, {
                            withDayName: true,
                            relativePrefix: false,
                          })}: Kumulatif Keluar ${formatRupiah(pt.cumulative_expense)}`}
                          className="cursor-pointer outline-none"
                          onMouseEnter={() => setHoveredDay(pt.day)}
                          onFocus={() => setHoveredDay(pt.day)}
                          onBlur={() => setHoveredDay(null)}
                          onClick={() =>
                            onSelectDate(isSelected ? null : pt.date)
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              onSelectDate(isSelected ? null : pt.date);
                            }
                          }}
                        >
                          <rect
                            x={groupX}
                            y={padTop}
                            width={Math.max(1, dayStep)}
                            height={plotHeight}
                            rx="3"
                            fill={
                              isSelected
                                ? "rgba(161, 161, 170, 0.18)"
                                : isHovered
                                  ? "rgba(161, 161, 170, 0.1)"
                                  : isToday
                                    ? "rgba(161, 161, 170, 0.05)"
                                    : "transparent"
                            }
                          />

                          {showExpense && (
                            <>
                              {isFocusedDot && (
                                <circle
                                  cx={cx}
                                  cy={expY}
                                  r="7"
                                  fill="#fb7185"
                                  opacity="0.22"
                                />
                              )}
                              <circle
                                cx={cx}
                                cy={expY}
                                r={isFocusedDot ? 4 : timeScale === "TWO_WEEKS" ? 2.5 : 1.6}
                                fill="#fb7185"
                                stroke="var(--color-floating-surface)"
                                strokeWidth={isFocusedDot ? 1.5 : 0.75}
                              />
                            </>
                          )}

                          {!showExpense && showIncome && isFocusedDot && (
                            <>
                              <circle
                                cx={cx}
                                cy={incY}
                                r="7"
                                fill="#34d399"
                                opacity="0.22"
                              />
                              <circle
                                cx={cx}
                                cy={incY}
                                r="4"
                                fill="#34d399"
                                stroke="var(--color-floating-surface)"
                                strokeWidth="1.5"
                              />
                            </>
                          )}

                          {showDateLabel && (
                            <text
                              x={cx}
                              y={svgHeight - 7}
                              textAnchor="middle"
                              className={`font-mono text-[10px] select-none ${
                                isSelected || isHovered
                                  ? "fill-foreground font-bold"
                                  : isToday
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
      )}

      {/* Slim Pan Bar shown ONLY when in 2 Minggu zoomed mode */}
      {timeScale === "TWO_WEEKS" && dailySeries.length > 0 && (
        <div
          data-testid="cashflow-pan-footer"
          className="flex items-center justify-between gap-2 border-t border-border/60 bg-black/[0.02] px-4 py-2 text-[11px] dark:bg-white/[0.02] sm:px-5"
        >
          <span className="text-muted-foreground">
            Geser grafik atau lompat periode:
          </span>
          <div className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/60 p-0.5">
            <button
              type="button"
              onClick={() => scrollToDay(8)}
              className={`rounded-full px-2.5 py-0.5 text-[11px] transition-colors ${
                activePeriodHalf === "FIRST"
                  ? "bg-cta-surface text-cta-foreground font-semibold"
                  : "text-muted-foreground hover:text-foreground font-medium"
              }`}
            >
              Tgl 1–15
            </button>
            <button
              type="button"
              onClick={() => scrollToDay(Math.round((16 + daysInMonth) / 2))}
              className={`rounded-full px-2.5 py-0.5 text-[11px] transition-colors ${
                activePeriodHalf === "SECOND"
                  ? "bg-cta-surface text-cta-foreground font-semibold"
                  : "text-muted-foreground hover:text-foreground font-medium"
              }`}
            >
              Tgl 16–{daysInMonth}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
