import type {
  BudgetProgressItem,
  CategoryView,
  MonthlyReportResponse,
} from "../../tauri-api";
import { callSinglePromptLlm } from "../client";
import { matchCategoryByName } from "../matchers";
import { buildMonthlyReportInsightSystemPrompt } from "../prompts";
import {
  extractJsonFromLlmText,
  resolveHealthScoreAndLabel,
  VALID_HIGHLIGHT_SEVERITIES,
} from "../schemas";
import type {
  ActiveAiConnectionConfig,
  AiReportInsightData,
  InsightHighlightSeverity,
  ModelFallbackHandler,
  ProposedBudgetDraft,
} from "../types";

/**
 * Generates structured financial insights & actionable budget recommendations for MonthlyReportPage & BudgetsPage.
 */
export async function generateMonthlyReportInsight(options: {
  config: ActiveAiConnectionConfig;
  report: MonthlyReportResponse;
  budgets: BudgetProgressItem[];
  categories: CategoryView[];
  isBusinessBook?: boolean;
  onModelFallback?: ModelFallbackHandler;
}): Promise<AiReportInsightData> {
  const {
    config,
    report,
    budgets,
    categories,
    isBusinessBook = false,
    onModelFallback,
  } = options;

  const compactPayload = {
    month: report.month,
    prev_month: report.prev_month,
    book_type: isBusinessBook ? "BUSINESS" : "PERSONAL",
    operational_income: report.operational_income,
    operational_expense: report.operational_expense,
    operational_net: report.operational_net,
    prev_operational_income: report.prev_operational_income,
    prev_operational_expense: report.prev_operational_expense,
    savings_rate_pct: Number((report.savings_rate_bps / 100).toFixed(2)),
    daily_burn_rate: report.daily_burn_rate,
    projected_month_expense: report.projected_month_expense,
    total_budget_limit: report.total_budget_limit,
    no_spend_days: report.no_spend_days,
    elapsed_days: report.elapsed_days,
    days_in_month: report.days_in_month,
    capital_injection: report.capital_injection,
    capital_withdrawal: report.capital_withdrawal,
    categories: report.category_breakdown.slice(0, 10).map((c) => ({
      name: c.category_name,
      kind: c.kind,
      current: c.current_amount,
      prev: c.prev_amount,
      delta: c.delta_amount,
      delta_pct: c.delta_pct,
      share_pct: Number((c.share_bps / 100).toFixed(1)),
    })),
    budgets: budgets.map((b) => ({
      category_name:
        b.category_id === null ? "Total Pengeluaran" : b.category_name,
      limit: b.amount_limit,
      spent: b.spent,
      pct: b.pct,
      status: b.status,
    })),
    device_contributions: report.device_contributions.map((d) => ({
      device_name: d.device_name || d.device_id.slice(0, 8),
      tx_count: d.tx_count,
      total_expense: d.total_expense,
      share_pct: Number((d.share_bps / 100).toFixed(1)),
    })),
  };

  const systemPrompt = buildMonthlyReportInsightSystemPrompt();

  const rawText = await callSinglePromptLlm({
    config,
    systemPrompt,
    userPrompt: `Data Laporan Bulanan:\n${JSON.stringify(compactPayload)}`,
    onModelFallback,
  });

  const parsed = extractJsonFromLlmText(rawText) as Record<string, unknown>;
  const { healthScore, healthLabel } = resolveHealthScoreAndLabel(
    parsed.healthScore,
    parsed.healthLabel
  );

  const rawHighlights = Array.isArray(parsed.highlights)
    ? parsed.highlights
    : [];
  const highlights = rawHighlights.slice(0, 4).map((h) => {
    const item = h as Record<string, unknown>;
    const sev = String(item.severity ?? "neutral");
    return {
      title: String(item.title ?? "Sorotan Keuangan"),
      detail: String(item.detail ?? ""),
      severity: (VALID_HIGHLIGHT_SEVERITIES.includes(
        sev as InsightHighlightSeverity
      )
        ? sev
        : "neutral") as InsightHighlightSeverity,
    };
  });

  const rawRecs = Array.isArray(parsed.budgetRecommendations)
    ? parsed.budgetRecommendations
    : [];
  const budgetRecommendations: ProposedBudgetDraft[] = [];

  for (let i = 0; i < rawRecs.slice(0, 3).length; i++) {
    const r = rawRecs[i] as Record<string, unknown>;
    const amount_limit = Math.max(
      0,
      Math.abs(Math.trunc(Number(r.amount_limit ?? 0)))
    );
    if (amount_limit <= 0) continue;

    const rawCatName = String(r.category_name ?? "Total Pengeluaran").trim();
    const isTotal =
      rawCatName.toLowerCase().includes("total") ||
      rawCatName.toLowerCase().includes("semua");

    let category_id: string | null = null;
    let category_name = "Total Pengeluaran";

    if (!isTotal) {
      const match = matchCategoryByName(categories, "EXPENSE", rawCatName);
      if (match.matched) {
        category_id = match.matched.id;
        category_name = match.matched.name;
      } else {
        continue;
      }
    }

    budgetRecommendations.push({
      id: `insight-budget-${Date.now()}-${i}`,
      category_id,
      category_name,
      amount_limit,
      alert_threshold_pct: 80,
      reason: typeof r.reason === "string" ? r.reason : undefined,
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    providerLabel: config.providerLabel,
    model: config.model,
    executiveSummary:
      typeof parsed.executiveSummary === "string" &&
      parsed.executiveSummary.trim()
        ? parsed.executiveSummary.trim()
        : "Analisis laporan bulanan selesai disusun.",
    healthScore,
    healthLabel,
    highlights,
    budgetRecommendations,
  };
}

