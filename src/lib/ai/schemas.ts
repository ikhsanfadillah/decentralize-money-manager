import { z } from "zod";
import type { FinancialHealthLabel, InsightHighlightSeverity } from "./types";

/**
 * Extracts a parsed JSON value from raw LLM text, supporting plain JSON,
 * fenced ```json blocks, or embedded `{ ... }` / `[ ... ]` substrings.
 */
export function extractJsonFromLlmText(rawText: string): unknown {
  const trimmed = rawText.trim();
  if (!trimmed) {
    throw new Error("Respons AI kosong.");
  }

  // 1. Try direct JSON parse
  try {
    return JSON.parse(trimmed);
  } catch {
    // continue
  }

  // 2. Try fenced ```json ... ``` block
  const fencedMatch = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fencedMatch?.[1]) {
    try {
      return JSON.parse(fencedMatch[1].trim());
    } catch {
      // continue
    }
  }

  // 3. Try first { ... } or [ ... ] substring
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
    } catch {
      // continue
    }
  }

  throw new Error("Format respons AI tidak berupa JSON yang valid.");
}

export const SmartTransactionItemSchema = z.object({
  tx_type: z.unknown().optional(),
  amount: z.unknown().optional(),
  account_name: z.unknown().optional(),
  to_account_name: z.unknown().optional(),
  category_name: z.unknown().optional(),
  tx_date: z.unknown().optional(),
  note: z.unknown().optional(),
});

export type RawSmartTransactionItem = z.infer<typeof SmartTransactionItemSchema>;

export function parseSmartTransactionItemsFromJson(
  parsed: unknown
): Record<string, unknown>[] {
  if (Array.isArray(parsed)) {
    return parsed.filter(
      (item): item is Record<string, unknown> =>
        typeof item === "object" && item !== null
    );
  }
  if (typeof parsed === "object" && parsed !== null) {
    const record = parsed as Record<string, unknown>;
    if (Array.isArray(record.transactions)) {
      return record.transactions.filter(
        (item): item is Record<string, unknown> =>
          typeof item === "object" && item !== null
      );
    }
  }
  return [];
}

export const VALID_HEALTH_LABELS: readonly FinancialHealthLabel[] = [
  "Sangat Sehat",
  "Sehat",
  "Perlu Perhatian",
  "Kritis",
] as const;

export const VALID_HIGHLIGHT_SEVERITIES: readonly InsightHighlightSeverity[] = [
  "positive",
  "warning",
  "critical",
  "neutral",
] as const;

export function resolveHealthScoreAndLabel(
  rawScoreInput: unknown,
  rawLabelInput: unknown
): { healthScore: number; healthLabel: FinancialHealthLabel } {
  const rawScore = Number(rawScoreInput ?? 75);
  const healthScore = Number.isFinite(rawScore)
    ? Math.max(0, Math.min(100, Math.round(rawScore)))
    : 75;

  const healthLabel: FinancialHealthLabel = VALID_HEALTH_LABELS.includes(
    rawLabelInput as FinancialHealthLabel
  )
    ? (rawLabelInput as FinancialHealthLabel)
    : healthScore >= 80
      ? "Sangat Sehat"
      : healthScore >= 65
        ? "Sehat"
        : healthScore >= 45
          ? "Perlu Perhatian"
          : "Kritis";

  return { healthScore, healthLabel };
}

