import * as React from "react";
import {
  AlertTriangle,
  Check,
  KeyRound,
  Loader2,
  RefreshCw,
  Sparkles,
  Target,
  TrendingUp,
} from "lucide-react";
import { useAiConfig } from "../../hooks/ai";
import { generateMonthlyReportInsight } from "../../lib/ai-provider";
import type {
  BudgetProgressItem,
  CategoryView,
  MonthlyReportResponse,
  UpsertBudgetInput,
} from "../../lib/tauri-api";
import { pushToast } from "../../lib/toast";
import { formatMonthLabel, formatRupiah } from "../../lib/utils";
import {
  toUpsertBudgetInputFromDraft,
  useAiStore,
  type ProposedBudgetDraft,
} from "../../stores/ai-store";

export interface AiReportInsightCardProps {
  bookId: string;
  month: string;
  report: MonthlyReportResponse | undefined;
  budgets: BudgetProgressItem[];
  categories: CategoryView[];
  isBusinessBook?: boolean;
  onApplyBudget: (input: UpsertBudgetInput) => Promise<unknown>;
}

export const AiReportInsightCard: React.FC<AiReportInsightCardProps> = ({
  bookId,
  month,
  report,
  budgets,
  categories,
  isBusinessBook = false,
  onApplyBudget,
}) => {
  const { activeConfig, ensureConfigured, openByokSettings, openCopilot } =
    useAiConfig();
  const insight = useAiStore(
    (s) => s.reportInsightsByKey[`${bookId}:${month}`]
  );
  const setReportInsight = useAiStore((s) => s.setReportInsight);
  const markInsightBudgetApplied = useAiStore(
    (s) => s.markInsightBudgetApplied
  );

  const [isLoading, setIsLoading] = React.useState(false);
  const [applyingDraftId, setApplyingDraftId] = React.useState<string | null>(
    null
  );

  const handleGenerate = async () => {
    if (!ensureConfigured()) {
      return;
    }

    if (!report) {
      pushToast("Data laporan belum siap", { variant: "warning" });
      return;
    }

    setIsLoading(true);
    try {
      const result = await generateMonthlyReportInsight({
        config: activeConfig,
        report,
        budgets,
        categories,
        isBusinessBook,
      });
      setReportInsight(bookId, month, result);
      pushToast(`Analisis AI (${formatMonthLabel(month)}) selesai`, {
        variant: "success",
      });
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Gagal menghasilkan analisis AI";
      pushToast("Analisis AI gagal", {
        description: msg,
        variant: "error",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleApplyRecommendation = async (rec: ProposedBudgetDraft) => {
    if (rec.applied || applyingDraftId) return;
    setApplyingDraftId(rec.id);
    try {
      await onApplyBudget(toUpsertBudgetInputFromDraft(rec));
      markInsightBudgetApplied(bookId, month, rec.id);
      pushToast(`Anggaran "${rec.category_name}" berhasil diterapkan`, {
        description: `Batas bulanan diatur ke ${formatRupiah(rec.amount_limit)}.`,
        variant: "success",
      });
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Gagal menerapkan anggaran";
      pushToast("Gagal menerapkan anggaran", {
        description: msg,
        variant: "error",
      });
    } finally {
      setApplyingDraftId(null);
    }
  };

  const healthBadgeStyle = React.useMemo(() => {
    if (!insight) return "";
    if (insight.healthScore >= 80) {
      return "border-emerald-500/35 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";
    }
    if (insight.healthScore >= 60) {
      return "border-sky-500/35 bg-sky-500/10 text-sky-600 dark:text-sky-400";
    }
    if (insight.healthScore >= 40) {
      return "border-amber-500/35 bg-amber-500/10 text-amber-600 dark:text-amber-400";
    }
    return "border-rose-500/35 bg-rose-500/10 text-rose-600 dark:text-rose-400";
  }, [insight]);

  return (
    <div
      data-testid="ai-report-insight-card"
      className="glass-card overflow-hidden border-primary/30"
    >
      {/* Card Header */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-border/70 px-4 py-3.5 sm:px-5">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-primary/35 bg-primary/10 text-primary">
            <Sparkles className="h-4 w-4" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <h2 className="text-xs font-bold text-foreground sm:text-sm">
                AI Financial Advisor &amp; Insight Anggaran
              </h2>
              <span className="rounded-full border border-border bg-black/[0.04] px-2 py-0.5 font-mono text-[10px] font-medium text-muted-foreground dark:bg-white/[0.06]">
                {activeConfig.isConfigured
                  ? `${activeConfig.providerLabel} · ${activeConfig.model}`
                  : "BYOK"}
              </span>
            </div>
            <p className="truncate text-[11px] text-muted-foreground">
              Evaluasi arus kas, deteksi anomali kategori, dan rekomendasi
              anggaran {formatMonthLabel(month)}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {!activeConfig.isConfigured ? (
            <button
              type="button"
              data-testid="ai-insight-setup-key-btn"
              onClick={openByokSettings}
              className="nav-touch-item inline-flex h-8 items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/15 px-3 text-xs font-semibold text-amber-600 dark:text-amber-300 hover:bg-amber-500/25"
            >
              <KeyRound className="h-3.5 w-3.5" />
              <span>Atur API Key</span>
            </button>
          ) : (
            <button
              type="button"
              data-testid="ai-insight-generate-btn"
              disabled={isLoading || !report}
              onClick={() => void handleGenerate()}
              className="nav-touch-item inline-flex h-8 items-center gap-1.5 rounded-full bg-cta-surface px-3.5 text-xs font-bold text-cta-foreground hover:opacity-90 disabled:opacity-50"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>Menganalisis...</span>
                </>
              ) : insight ? (
                <>
                  <RefreshCw className="h-3.5 w-3.5" />
                  <span>Analisis Ulang</span>
                </>
              ) : (
                <>
                  <Sparkles className="h-3.5 w-3.5" />
                  <span>Analisis dengan AI</span>
                </>
              )}
            </button>
          )}
        </div>
      </div>

      {/* Card Body */}
      {insight ? (
        <div className="p-4 sm:p-5 space-y-4">
          {/* Executive Summary + Health Score */}
          <div className="flex flex-col gap-3 rounded-2xl border border-border/80 bg-black/[0.02] p-3.5 dark:bg-white/[0.03] sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Ringkasan Eksekutif
                </span>
                <span
                  className={`rounded-full border px-2.5 py-0.5 font-mono text-[10px] font-bold ${healthBadgeStyle}`}
                >
                  Skor {insight.healthScore}/100 · {insight.healthLabel}
                </span>
              </div>
              <p className="text-xs leading-relaxed text-foreground sm:text-[13px]">
                {insight.executiveSummary}
              </p>
            </div>
          </div>

          {/* Highlights Grid */}
          {insight.highlights.length > 0 && (
            <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
              {insight.highlights.map((h, idx) => {
                const isWarn =
                  h.severity === "warning" || h.severity === "critical";
                const isPos = h.severity === "positive";
                return (
                  <div
                    key={idx}
                    className={`rounded-2xl border p-3 text-xs space-y-1 ${
                      isWarn
                        ? "border-amber-500/30 bg-amber-500/[0.06]"
                        : isPos
                          ? "border-emerald-500/30 bg-emerald-500/[0.06]"
                          : "border-border/70 bg-black/[0.02] dark:bg-white/[0.03]"
                    }`}
                  >
                    <div className="flex items-center gap-1.5 font-bold text-foreground">
                      {isWarn ? (
                        <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                      ) : (
                        <TrendingUp className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                      )}
                      <span>{h.title}</span>
                    </div>
                    <p className="text-[11px] leading-relaxed text-muted-foreground">
                      {h.detail}
                    </p>
                  </div>
                );
              })}
            </div>
          )}

          {/* Actionable Budget Recommendations */}
          {insight.budgetRecommendations.length > 0 && (
            <div className="space-y-2 pt-1">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  <Target className="h-3.5 w-3.5 text-primary" />
                  <span>Rekomendasi Target Anggaran (1-Klik Terapkan)</span>
                </span>
                <button
                  type="button"
                  onClick={openCopilot}
                  className="text-[11px] font-semibold text-primary hover:underline"
                >
                  Diskusikan di Co-Pilot →
                </button>
              </div>

              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {insight.budgetRecommendations.map((rec) => (
                  <div
                    key={rec.id}
                    className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-black/[0.02] px-3.5 py-2.5 dark:bg-white/[0.04]"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-xs font-bold text-foreground">
                          {rec.category_name}
                        </span>
                        <span className="font-mono text-xs font-semibold text-primary shrink-0">
                          {formatRupiah(rec.amount_limit)}
                        </span>
                      </div>
                      {rec.reason && (
                        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                          {rec.reason}
                        </p>
                      )}
                    </div>

                    <button
                      type="button"
                      disabled={rec.applied || applyingDraftId === rec.id}
                      onClick={() => void handleApplyRecommendation(rec)}
                      className={`nav-touch-item shrink-0 inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-[11px] font-bold transition-colors ${
                        rec.applied
                          ? "border border-emerald-500/40 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                          : "bg-cta-surface text-cta-foreground hover:opacity-90"
                      }`}
                    >
                      {rec.applied ? (
                        <>
                          <Check className="h-3 w-3" />
                          <span>Diterapkan</span>
                        </>
                      ) : applyingDraftId === rec.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <span>Terapkan</span>
                      )}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3 text-xs text-muted-foreground sm:px-5">
          <span>
            Dapatkan evaluasi kesehatan arus kas, deteksi kategori yang melonjak,
            serta rekomendasi batas anggaran otomatis menggunakan kunci API Anda.
          </span>
          <button
            type="button"
            onClick={openCopilot}
            className="shrink-0 font-semibold text-primary hover:underline text-left sm:text-right"
          >
            Tanya Co-Pilot Chat →
          </button>
        </div>
      )}
    </div>
  );
};
