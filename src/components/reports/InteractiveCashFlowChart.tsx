import * as React from "react";
import type { DailyCashFlowPoint } from "../../lib/tauri-api";
import { formatRupiah } from "../../lib/utils";

export type CashFlowChartMode = "DAILY_BARS" | "CUMULATIVE_BURN";

export interface InteractiveCashFlowChartProps {
  dailySeries: DailyCashFlowPoint[];
  daysInMonth: number;
  elapsedDays: number;
  totalBudgetLimit: number | null;
  selectedDate: string | null;
  onSelectDate: (date: string | null) => void;
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
  const [showIncome, setShowIncome] = React.useState(true);
  const [showExpense, setShowExpense] = React.useState(true);
  const [showNetLine, setShowNetLine] = React.useState(true);
  const [hoveredDay, setHoveredDay] = React.useState<number | null>(null);

  const activePoint = React.useMemo(() => {
    if (hoveredDay !== null) {
      return dailySeries.find((d) => d.day === hoveredDay) ?? null;
    }
    if (selectedDate !== null) {
      return dailySeries.find((d) => d.date === selectedDate) ?? null;
    }
    const fallbackIdx = Math.min(
      Math.max(0, elapsedDays - 1),
      dailySeries.length - 1
    );
    return dailySeries[fallbackIdx] ?? null;
  }, [dailySeries, hoveredDay, selectedDate, elapsedDays]);

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

  // SVG coordinate constants
  const svgWidth = 840;
  const svgHeight = 250;
  const padLeft = 56;
  const padRight = 20;
  const padTop = 20;
  const padBottom = 32;
  const plotWidth = svgWidth - padLeft - padRight;
  const plotHeight = svgHeight - padTop - padBottom;

  const dayStep = plotWidth / Math.max(1, daysInMonth);

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

  // Build SVG polyline for net daily cashflow or cumulative burn
  const cumulativeExpensePoints = React.useMemo(() => {
    return dailySeries
      .map((pt) => {
        const x = padLeft + (pt.day - 0.5) * dayStep;
        const y = yForValue(pt.cumulative_expense, maxCumulativeValue);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  }, [dailySeries, dayStep, maxCumulativeValue]);

  const cumulativeIncomePoints = React.useMemo(() => {
    return dailySeries
      .map((pt) => {
        const x = padLeft + (pt.day - 0.5) * dayStep;
        const y = yForValue(pt.cumulative_income, maxCumulativeValue);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  }, [dailySeries, dayStep, maxCumulativeValue]);

  const netLinePoints = React.useMemo(() => {
    return dailySeries
      .map((pt) => {
        const x = padLeft + (pt.day - 0.5) * dayStep;
        const val = Math.max(0, pt.net);
        const y = yForValue(val, maxDailyValue);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");
  }, [dailySeries, dayStep, maxDailyValue]);

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

  return (
    <div
      data-testid="interactive-cashflow-chart"
      className="tabular-grid-container grid grid-cols-1"
    >
      {/* Header & Interactive Controls */}
      <div className="tabular-grid-cell flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            Grafik Interaktif Arus Kas & Kurva Laju Pengeluaran
          </h2>
          <p className="text-xs text-muted-foreground">
            Arahkan kursor untuk inspeksi presisi atau{" "}
            <span className="font-semibold text-foreground">
              klik batang tanggal
            </span>{" "}
            untuk memfilter daftar transaksi di bawah.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setChartMode("DAILY_BARS")}
            className={`rounded border px-2.5 py-1 font-mono text-xs font-medium shadow-none focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary ${
              chartMode === "DAILY_BARS"
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            Arus Harian (Bar)
          </button>
          <button
            type="button"
            onClick={() => setChartMode("CUMULATIVE_BURN")}
            className={`rounded border px-2.5 py-1 font-mono text-xs font-medium shadow-none focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary ${
              chartMode === "CUMULATIVE_BURN"
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            Akumulasi & Laju Anggaran
          </button>
        </div>
      </div>

      {/* Series Toggle Bar & Live HUD Inspector */}
      <div className="tabular-grid-cell flex flex-wrap items-center justify-between gap-3 bg-background/50 px-4 py-2.5 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setShowIncome((v) => !v)}
            className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 font-mono text-[11px] shadow-none focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary ${
              showIncome
                ? "border-emerald-500/50 bg-card text-emerald-500"
                : "border-border bg-background text-muted-foreground opacity-60"
            }`}
          >
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
            Pemasukan
          </button>

          <button
            type="button"
            onClick={() => setShowExpense((v) => !v)}
            className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 font-mono text-[11px] shadow-none focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary ${
              showExpense
                ? "border-rose-500/50 bg-card text-rose-500"
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
              className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 font-mono text-[11px] shadow-none focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary ${
                showNetLine
                  ? "border-sky-500/50 bg-card text-sky-500"
                  : "border-border bg-background text-muted-foreground opacity-60"
              }`}
            >
              <span className="inline-block h-2 w-2 rounded-full bg-sky-500" />
              Garis Surplus Harian
            </button>
          )}

          {selectedDate && (
            <button
              type="button"
              onClick={() => onSelectDate(null)}
              className="rounded border border-primary/50 bg-card px-2 py-0.5 font-mono text-[11px] font-semibold text-primary shadow-none hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
            >
              Filter Tanggal: {selectedDate} (Reset ×)
            </button>
          )}
        </div>

        {/* Live Hovered / Selected Day Readout */}
        {activePoint && (
          <div
            data-testid="cashflow-hud-readout"
            className="flex flex-wrap items-center gap-3 font-mono text-xs tabular-nums tracking-tight"
          >
            <span className="rounded border border-border bg-card px-2 py-0.5 font-semibold text-foreground">
              {activePoint.date} ({activePoint.tx_count} tx)
            </span>
            {chartMode === "DAILY_BARS" ? (
              <>
                <span className="text-emerald-500">
                  +{formatRupiah(activePoint.income)}
                </span>
                <span className="text-rose-500">
                  −{formatRupiah(activePoint.expense)}
                </span>
                <span
                  className={
                    activePoint.net >= 0
                      ? "font-semibold text-sky-500"
                      : "font-semibold text-amber-500"
                  }
                >
                  Net: {formatRupiah(activePoint.net)}
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
                    Target Ideal Hari-{activePoint.day}:{" "}
                    {formatRupiah(idealPaceOnActiveDay)}
                  </span>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Interactive SVG Canvas */}
      <div className="tabular-grid-cell overflow-x-auto p-4">
        <svg
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          className="h-64 w-full min-w-[640px] select-none"
          role="img"
          aria-label="Grafik Interaktif Arus Kas Bulanan"
          onMouseLeave={() => setHoveredDay(null)}
        >
          {/* Horizontal Grid Lines & Y-Axis Labels */}
          {yTicks.map((tickVal, idx) => {
            const y = yForValue(tickVal, activeMax);
            return (
              <g key={idx}>
                <line
                  x1={padLeft}
                  y1={y}
                  x2={svgWidth - padRight}
                  y2={y}
                  stroke="hsl(var(--border))"
                  strokeDasharray={idx === 0 ? undefined : "3 3"}
                  strokeWidth="1"
                />
                <text
                  x={padLeft - 8}
                  y={y + 4}
                  textAnchor="end"
                  className="fill-muted-foreground font-mono text-[10px]"
                >
                  {formatCompactRupiah(tickVal)}
                </text>
              </g>
            );
          })}

          {chartMode === "DAILY_BARS" ? (
            <>
              {/* Daily Bars */}
              {dailySeries.map((pt) => {
                const groupX = padLeft + (pt.day - 1) * dayStep;
                const isSelected = selectedDate === pt.date;
                const isHovered = hoveredDay === pt.day;
                const barW = Math.max(3, dayStep * 0.36);

                const incY = yForValue(pt.income, maxDailyValue);
                const incH = padTop + plotHeight - incY;

                const expY = yForValue(pt.expense, maxDailyValue);
                const expH = padTop + plotHeight - expY;

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
                      fill={
                        isSelected
                          ? "hsl(var(--primary) / 0.16)"
                          : isHovered
                            ? "hsl(var(--muted) / 0.65)"
                            : "transparent"
                      }
                    />

                    {/* Income Bar */}
                    {showIncome && pt.income > 0 && (
                      <rect
                        x={groupX + dayStep * 0.12}
                        y={incY}
                        width={barW}
                        height={Math.max(2, incH)}
                        fill="#10b981"
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
                      />
                    )}

                    {/* X-Axis Day Label */}
                    {(pt.day === 1 ||
                      pt.day % 5 === 0 ||
                      pt.day === daysInMonth ||
                      isSelected ||
                      isHovered) && (
                      <text
                        x={groupX + dayStep / 2}
                        y={svgHeight - 10}
                        textAnchor="middle"
                        className={`font-mono text-[10px] ${
                          isSelected || isHovered
                            ? "fill-primary font-bold"
                            : "fill-muted-foreground"
                        }`}
                      >
                        {String(pt.day).padStart(2, "0")}
                      </text>
                    )}
                  </g>
                );
              })}

              {/* Optional Positive Net Line */}
              {showNetLine && (
                <polyline
                  fill="none"
                  stroke="#0ea5e9"
                  strokeWidth="1.75"
                  points={netLinePoints}
                  pointerEvents="none"
                />
              )}
            </>
          ) : (
            <>
              {/* Ideal Budget Pace Diagonal Line & Budget Ceiling */}
              {totalBudgetLimit !== null && totalBudgetLimit > 0 && (
                <>
                  <line
                    x1={padLeft}
                    y1={yForValue(totalBudgetLimit, maxCumulativeValue)}
                    x2={svgWidth - padRight}
                    y2={yForValue(totalBudgetLimit, maxCumulativeValue)}
                    stroke="#f59e0b"
                    strokeDasharray="6 4"
                    strokeWidth="1.5"
                  />
                  <line
                    x1={padLeft}
                    y1={padTop + plotHeight}
                    x2={svgWidth - padRight}
                    y2={yForValue(totalBudgetLimit, maxCumulativeValue)}
                    stroke="#10b981"
                    strokeDasharray="4 4"
                    strokeWidth="1.5"
                  />
                </>
              )}

              {/* Cumulative Income Curve */}
              {showIncome && (
                <polyline
                  fill="none"
                  stroke="#10b981"
                  strokeWidth="2"
                  points={cumulativeIncomePoints}
                  pointerEvents="none"
                />
              )}

              {/* Cumulative Expense Curve */}
              {showExpense && (
                <polyline
                  fill="none"
                  stroke="#f43f5e"
                  strokeWidth="2.5"
                  points={cumulativeExpensePoints}
                  pointerEvents="none"
                />
              )}

              {/* Interactive Day Columns & Dots */}
              {dailySeries.map((pt) => {
                const groupX = padLeft + (pt.day - 1) * dayStep;
                const centerX = padLeft + (pt.day - 0.5) * dayStep;
                const expY = yForValue(
                  pt.cumulative_expense,
                  maxCumulativeValue
                );
                const isSelected = selectedDate === pt.date;
                const isHovered = hoveredDay === pt.day;

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
                      fill={
                        isSelected
                          ? "hsl(var(--primary) / 0.16)"
                          : isHovered
                            ? "hsl(var(--muted) / 0.65)"
                            : "transparent"
                      }
                    />
                    {showExpense && (
                      <circle
                        cx={centerX}
                        cy={expY}
                        r={isSelected || isHovered ? 4.5 : 2.5}
                        fill="#f43f5e"
                      />
                    )}
                    {(pt.day === 1 ||
                      pt.day % 5 === 0 ||
                      pt.day === daysInMonth ||
                      isSelected ||
                      isHovered) && (
                      <text
                        x={centerX}
                        y={svgHeight - 10}
                        textAnchor="middle"
                        className={`font-mono text-[10px] ${
                          isSelected || isHovered
                            ? "fill-primary font-bold"
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
  );
};
