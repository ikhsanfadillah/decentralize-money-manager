import { beforeEach, describe, expect, it } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  createDefaultByokConfig,
  formatAiSdkError,
  normalizeBaseUrl,
  normalizeGeminiModelId,
  parseSmartTransactionItemsFromJson,
  resolveActiveAiConfig,
  resolveFallbackModelForError,
  resolveHealthScoreAndLabel,
  toAddTransactionInputFromDraft,
  toUpsertBudgetInputFromDraft,
} from "../index";
import { useAiConfig } from "../../../hooks/ai";
import { useAiStore } from "../../../stores/ai-store";

describe("Modular AI Library (src/lib/ai/* & src/hooks/ai/*)", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useAiStore.setState({
      byok: createDefaultByokConfig(),
      isCopilotOpen: false,
      isByokSettingsDrawerOpen: false,
    });
  });

  it("normalizes base URLs, Gemini model IDs, and resolves fallback models only for Gemini", () => {
    expect(normalizeBaseUrl("https://api.openai.com/v1///")).toBe(
      "https://api.openai.com/v1"
    );
    expect(normalizeGeminiModelId("models/gemini-3.8-flash")).toBe(
      "gemini-3.8-flash"
    );

    const geminiConfig = resolveActiveAiConfig({
      ...createDefaultByokConfig(),
      activeProvider: "gemini",
    });
    expect(
      resolveFallbackModelForError(
        { ...geminiConfig, model: "gemini-2.5-flash" },
        "Please update your code to use models/gemini-3.8-flash for the latest features."
      )
    ).toBe("gemini-3.8-flash");

    // Non-Gemini provider should not trigger Gemini model replacement
    const openaiConfig = resolveActiveAiConfig({
      ...createDefaultByokConfig(),
      activeProvider: "openai",
    });
    expect(
      resolveFallbackModelForError(
        openaiConfig,
        "Please update your code to use models/gemini-3.8-flash"
      )
    ).toBeNull();
  });

  it("formats AI SDK errors with status codes (401, 429) and nested JSON error bodies", () => {
    const authErr = formatAiSdkError(
      {
        statusCode: 401,
        responseBody: JSON.stringify({
          error: { message: "Invalid API key provided" },
        }),
      },
      "OpenAI"
    );
    expect(authErr.message).toContain("Kunci API OpenAI tidak valid");
    expect(authErr.message).toContain("Invalid API key provided");

    const rateLimitErr = formatAiSdkError(
      {
        statusCode: 429,
        message: "Quota exceeded",
      },
      "Gemini"
    );
    expect(rateLimitErr.message).toContain(
      "Batas kuota / rate limit Gemini tercapai (429)"
    );
  });

  it("normalizes health scores, labels, and transaction array payloads in schemas", () => {
    expect(resolveHealthScoreAndLabel(92, "Invalid Label")).toEqual({
      healthScore: 92,
      healthLabel: "Sangat Sehat",
    });
    expect(resolveHealthScoreAndLabel(50, "Perlu Perhatian")).toEqual({
      healthScore: 50,
      healthLabel: "Perlu Perhatian",
    });
    expect(resolveHealthScoreAndLabel(-15, undefined)).toEqual({
      healthScore: 0,
      healthLabel: "Kritis",
    });

    expect(
      parseSmartTransactionItemsFromJson({
        transactions: [{ amount: 25000, tx_type: "EXPENSE" }, null],
      })
    ).toEqual([{ amount: 25000, tx_type: "EXPENSE" }]);

    expect(
      parseSmartTransactionItemsFromJson([{ amount: 50000, tx_type: "INCOME" }])
    ).toEqual([{ amount: 50000, tx_type: "INCOME" }]);
  });

  it("maps proposed transaction and budget drafts into Tauri API inputs and detects local Ollama endpoints", () => {
    const expenseInput = toAddTransactionInputFromDraft({
      id: "draft-1",
      tx_type: "EXPENSE",
      account_id: "acc-1",
      account_name: "Kas",
      category_id: "cat-1",
      amount: 45000,
      tx_date: "2026-11-11",
      note: "  Kopi susu  ",
    });
    expect(expenseInput.amount).toBe(-45000);
    expect(expenseInput.note).toBe("Kopi susu");

    const budgetInput = toUpsertBudgetInputFromDraft({
      id: "budget-1",
      category_id: "cat-1",
      category_name: "Makanan",
      amount_limit: 1500000,
      alert_threshold_pct: 85,
    });
    expect(budgetInput).toEqual({
      category_id: "cat-1",
      period: "MONTHLY",
      amount_limit: 1500000,
      alert_threshold_pct: 85,
    });

    // Localhost endpoint under openrouter preset is considered configured even without an API key
    const defaults = createDefaultByokConfig();
    defaults.activeProvider = "openrouter";
    defaults.providers.openrouter.baseUrl = "http://localhost:11434/v1";
    defaults.providers.openrouter.apiKey = "";
    expect(resolveActiveAiConfig(defaults).isConfigured).toBe(true);
  });

  it("useAiConfig opens BYOK drawer when unconfigured and succeeds when configured", () => {
    const { result } = renderHook(() => useAiConfig());
    expect(result.current.activeConfig.isConfigured).toBe(false);

    let ok = false;
    act(() => {
      ok = result.current.ensureConfigured();
    });
    expect(ok).toBe(false);
    expect(useAiStore.getState().isByokSettingsDrawerOpen).toBe(true);

    act(() => {
      useAiStore.getState().setByokSettingsDrawerOpen(false);
      useAiStore
        .getState()
        .updateProviderConfig("gemini", { apiKey: "AIzaSyTestKey" });
    });

    expect(result.current.activeConfig.isConfigured).toBe(true);
    act(() => {
      ok = result.current.ensureConfigured();
    });
    expect(ok).toBe(true);
    expect(useAiStore.getState().isByokSettingsDrawerOpen).toBe(false);
  });
});

