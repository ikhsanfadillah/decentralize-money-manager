import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  executeCopilotToolCall,
  matchAccountByName,
  matchCategoryByName,
} from "../ai-agent-tools";
import {
  extractJsonFromLlmText,
  generateMonthlyReportInsight,
  parseDataUrlToImagePayload,
  parseSmartTransactionInput,
  runCopilotAgentTurn,
  testAiConnection,
} from "../ai-provider";
import {
  tauriApi,
  type AccountView,
  type BudgetProgressItem,
  type CategoryView,
  type MonthlyReportResponse,
} from "../tauri-api";
import type {
  ProposedBudgetDraft,
  ProposedTransactionDraft,
} from "../../stores/ai-store";
import {
  resolveActiveAiConfig,
  useAiStore,
} from "../../stores/ai-store";

const MOCK_ACCOUNTS: AccountView[] = [
  {
    id: "acc-cash",
    name: "Kas Tunai",
    account_type: "CASH",
    initial_balance: 500000,
    merged_into_id: null,
    root_id: "acc-cash",
    is_deleted: 0,
    updated_hlc: "2026-11-01T00:00:00Z",
  },
  {
    id: "acc-gopay",
    name: "Dompet GoPay",
    account_type: "EWALLET",
    initial_balance: 250000,
    merged_into_id: null,
    root_id: "acc-gopay",
    is_deleted: 0,
    updated_hlc: "2026-11-01T00:00:00Z",
  },
  {
    id: "acc-bca",
    name: "Bank BCA",
    account_type: "BANK",
    initial_balance: 10000000,
    merged_into_id: null,
    root_id: "acc-bca",
    is_deleted: 0,
    updated_hlc: "2026-11-01T00:00:00Z",
  },
];

const MOCK_CATEGORIES: CategoryView[] = [
  {
    id: "cat-food",
    name: "Makanan & Minuman",
    normalized_name: "makanandminuman",
    kind: "EXPENSE",
    merged_into_id: null,
    canonical_id: "cat-food",
    is_deleted: 0,
    updated_hlc: "2026-11-01T00:00:00Z",
  },
  {
    id: "cat-transport",
    name: "Transportasi",
    normalized_name: "transportasi",
    kind: "EXPENSE",
    merged_into_id: null,
    canonical_id: "cat-transport",
    is_deleted: 0,
    updated_hlc: "2026-11-01T00:00:00Z",
  },
  {
    id: "cat-salary",
    name: "Gaji Bulanan",
    normalized_name: "gajibulanan",
    kind: "INCOME",
    merged_into_id: null,
    canonical_id: "cat-salary",
    is_deleted: 0,
    updated_hlc: "2026-11-01T00:00:00Z",
  },
];

describe("AI Agent BYOK Store & Utilities", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useAiStore.setState({
      byok: {
        activeProvider: "gemini",
        providers: {
          gemini: {
            apiKey: "test-gemini-key",
            model: "gemini-2.5-flash",
            baseUrl: "https://generativelanguage.googleapis.com/v1beta",
          },
          openai: {
            apiKey: "sk-test-openai",
            model: "gpt-4o-mini",
            baseUrl: "https://api.openai.com/v1",
          },
          deepseek: {
            apiKey: "sk-test-deepseek",
            model: "deepseek-chat",
            baseUrl: "https://api.deepseek.com",
          },
          groq: {
            apiKey: "",
            model: "llama-3.3-70b-versatile",
            baseUrl: "https://api.groq.com/openai/v1",
          },
          openrouter: {
            apiKey: "",
            model: "google/gemini-2.5-flash",
            baseUrl: "https://openrouter.ai/api/v1",
          },
        },
      },
      chatByBook: {},
      reportInsightsByKey: {},
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("persists BYOK provider settings locally without leaking across providers", () => {
    const store = useAiStore.getState();
    store.setActiveProvider("openai");
    store.updateProviderConfig("openai", { model: "gpt-4o" });

    const updated = useAiStore.getState();
    const active = resolveActiveAiConfig(updated.byok);
    expect(active.provider).toBe("openai");
    expect(active.model).toBe("gpt-4o");
    expect(active.apiKey).toBe("sk-test-openai");
    expect(active.isConfigured).toBe(true);

    const rawStored = window.localStorage.getItem("dmm-ai-byok-config");
    expect(rawStored).toBeTruthy();
    expect(rawStored).toContain("sk-test-openai");

    // Switch to DeepSeek provider
    store.setActiveProvider("deepseek");
    store.updateProviderConfig("deepseek", { model: "deepseek-reasoner" });
    const deepseekActive = resolveActiveAiConfig(useAiStore.getState().byok);
    expect(deepseekActive.provider).toBe("deepseek");
    expect(deepseekActive.model).toBe("deepseek-reasoner");
    expect(deepseekActive.baseUrl).toBe("https://api.deepseek.com");
    expect(deepseekActive.apiKey).toBe("sk-test-deepseek");
    expect(deepseekActive.isConfigured).toBe(true);
  });

  it("matches accounts and categories fuzzily and suggests new category when unmatched", () => {
    expect(matchAccountByName(MOCK_ACCOUNTS, "gopay")?.id).toBe("acc-gopay");
    expect(matchAccountByName(MOCK_ACCOUNTS, "BCA")?.id).toBe("acc-bca");
    expect(matchAccountByName(MOCK_ACCOUNTS, "tunai")?.id).toBe("acc-cash");

    const existingCat = matchCategoryByName(
      MOCK_CATEGORIES,
      "EXPENSE",
      "Makanan"
    );
    expect(existingCat.matched?.id).toBe("cat-food");
    expect(existingCat.suggestedNewName).toBeNull();

    const newCat = matchCategoryByName(
      MOCK_CATEGORIES,
      "EXPENSE",
      "Langganan Streaming"
    );
    expect(newCat.matched?.id).toBe("cat-food"); // fallback
    expect(newCat.suggestedNewName).toBe("Langganan Streaming");
  });

  it("extracts JSON from plain or fenced LLM outputs and parses data URLs", () => {
    const fenced = 'Berikut hasilnya:\n```json\n{"ok":true,"count":2}\n```';
    expect(extractJsonFromLlmText(fenced)).toEqual({ ok: true, count: 2 });

    const img = parseDataUrlToImagePayload(
      "data:image/jpeg;base64,/9j/4AAQSkZJRg=="
    );
    expect(img).toEqual({
      mimeType: "image/jpeg",
      base64Data: "/9j/4AAQSkZJRg==",
      dataUrl: "data:image/jpeg;base64,/9j/4AAQSkZJRg==",
    });
  });

  it("parses smart transaction input via Gemini adapter", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      transactions: [
                        {
                          tx_type: "EXPENSE",
                          amount: 45000,
                          account_name: "GoPay",
                          category_name: "Makanan & Minuman",
                          tx_date: "2026-11-10",
                          note: "Makan siang nasi padang",
                        },
                      ],
                    }),
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 }
      )
    );

    const config = resolveActiveAiConfig(useAiStore.getState().byok);
    const drafts = await parseSmartTransactionInput({
      config,
      prompt: "Makan siang nasi padang 45rb pakai GoPay",
      accounts: MOCK_ACCOUNTS,
      categories: MOCK_CATEGORIES,
      todayDate: "2026-11-10",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({
      tx_type: "EXPENSE",
      amount: 45000,
      account_id: "acc-gopay",
      category_id: "cat-food",
      tx_date: "2026-11-10",
      note: "Makan siang nasi padang",
    });
  });

  it("generates monthly report insight via OpenAI-compatible adapter", async () => {
    useAiStore.getState().setActiveProvider("openai");
    const config = resolveActiveAiConfig(useAiStore.getState().byok);

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: "chatcmpl-test-123",
          object: "chat.completion",
          created: 1730000000,
          model: "gpt-4o-mini",
          choices: [
            {
              index: 0,
              finish_reason: "stop",
              message: {
                role: "assistant",
                content: JSON.stringify({
                  executiveSummary:
                    "Arus kas bulan ini surplus Rp 3.500.000 dengan rasio tabungan 50%.",
                  healthScore: 88,
                  healthLabel: "Sangat Sehat",
                  highlights: [
                    {
                      title: "Rasio Tabungan Tinggi",
                      detail: "Rasio simpan mencapai 50% dari pemasukan.",
                      severity: "positive",
                    },
                  ],
                  budgetRecommendations: [
                    {
                      category_name: "Makanan & Minuman",
                      amount_limit: 1500000,
                      alert_threshold_pct: 80,
                      reason: "Menjaga pengeluaran makan harian tetap terkendali.",
                    },
                  ],
                }),
              },
            },
          ],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 80,
            total_tokens: 180,
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }
      )
    );

    const mockReport: MonthlyReportResponse = {
      month: "2026-11",
      prev_month: "2026-10",
      days_in_month: 30,
      elapsed_days: 10,
      no_spend_days: 3,
      tx_count: 12,
      operational_income: 7000000,
      operational_expense: 3500000,
      operational_net: 3500000,
      prev_operational_income: 6500000,
      prev_operational_expense: 3200000,
      capital_injection: 0,
      capital_withdrawal: 0,
      savings_rate_bps: 5000,
      daily_burn_rate: 350000,
      projected_month_expense: 5000000,
      total_budget_limit: 5500000,
      daily_series: [],
      category_breakdown: [],
      account_reconciliation: [],
      device_contributions: [],
      top_expenses: [],
    };
    const mockBudgets: BudgetProgressItem[] = [];

    const insight = await generateMonthlyReportInsight({
      config,
      report: mockReport,
      budgets: mockBudgets,
      categories: MOCK_CATEGORIES,
    });

    expect(insight.healthScore).toBe(88);
    expect(insight.healthLabel).toBe("Sangat Sehat");
    expect(insight.highlights).toHaveLength(1);
    expect(insight.budgetRecommendations).toHaveLength(1);
    expect(insight.budgetRecommendations[0].category_id).toBe("cat-food");
    expect(insight.budgetRecommendations[0].amount_limit).toBe(1500000);
  });

  it("tests connection and runs Co-Pilot turn with Gemini response", async () => {
    const config = resolveActiveAiConfig(useAiStore.getState().byok);

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [{ text: "Koneksi AI siap digunakan." }],
                },
              },
            ],
          }),
          { status: 200 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  role: "model",
                  parts: [
                    {
                      text: "Pengeluaran Anda bulan ini masih aman di dalam batas anggaran.",
                    },
                  ],
                },
              },
            ],
          }),
          { status: 200 }
        )
      );

    const connRes = await testAiConnection(config);
    expect(connRes.ok).toBe(true);
    expect(connRes.reply).toContain("Koneksi AI siap");

    const turnRes = await runCopilotAgentTurn({
      config,
      bookId: "00000000-0000-7000-8000-000000000099",
      bookName: "Buku Pribadi",
      history: [],
      userMessage: "Bagaimana kondisi pengeluaranku?",
    });

    expect(turnRes.replyText).toContain("Pengeluaran Anda bulan ini masih aman");
  });

  it("auto-switches and retries when Gemini suggests a replacement model on deprecation error", async () => {
    const config = resolveActiveAiConfig(useAiStore.getState().byok);

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              message:
                "This model models/gemini-2.5-flash is no longer available to new users. Please update your code to use models/gemini-3.8-flash for the latest features and improvements.",
            },
          }),
          { status: 404 }
        )
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  role: "model",
                  parts: [{ text: "Berhasil beralih otomatis ke gemini-3.8-flash." }],
                },
              },
            ],
          }),
          { status: 200 }
        )
      );

    const turnRes = await runCopilotAgentTurn({
      config,
      bookId: "00000000-0000-7000-8000-000000000099",
      bookName: "Buku Pribadi",
      history: [],
      userMessage: "Halo",
    });

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(turnRes.replyText).toBe(
      "Berhasil beralih otomatis ke gemini-3.8-flash."
    );
    expect(useAiStore.getState().byok.providers.gemini.model).toBe(
      "gemini-3.8-flash"
    );
  });

  it("asks for clarification instead of proposing invalid transaction when account_name is missing/null", async () => {
    vi.spyOn(tauriApi, "listAccounts").mockResolvedValue(MOCK_ACCOUNTS);
    vi.spyOn(tauriApi, "listCategories").mockResolvedValue(MOCK_CATEGORIES);

    const ctx = {
      bookId: "test-book",
      collectedTransactions: [] as ProposedTransactionDraft[],
      collectedBudgets: [] as ProposedBudgetDraft[],
    };

    // User asks "catat pengeluaran 100 ribu sebagai food" -> model sends account_name: null
    const result = (await executeCopilotToolCall(
      "propose_transactions",
      {
        items: [
          {
            account_name: null,
            amount: 100000,
            category_name: "Food",
            note: "Food",
            tx_type: "EXPENSE",
            tx_date: "2026-11-10",
          },
        ],
      },
      ctx
    )) as { status: string; missing_field?: string; message?: string };

    expect(result.status).toBe("NEED_ACCOUNT_CLARIFICATION");
    expect(result.missing_field).toBe("account_name");
    expect(result.message).toContain("Pengguna belum menyebutkan rekening/dompet");
    expect(ctx.collectedTransactions.length).toBe(0);

    // After user provides account ("Kas Tunai")
    const successResult = (await executeCopilotToolCall(
      "propose_transactions",
      {
        items: [
          {
            account_name: "Kas Tunai",
            amount: 100000,
            category_name: "Food",
            note: "Food",
            tx_type: "EXPENSE",
            tx_date: "2026-11-10",
          },
        ],
      },
      ctx
    )) as { status: string; proposed_count?: number };

    expect(successResult.status).toBe("PROPOSED_AWAITING_USER_CONFIRMATION");
    expect(ctx.collectedTransactions.length).toBe(1);
    expect(ctx.collectedTransactions[0].account_name).toBe("Kas Tunai");
    expect(ctx.collectedTransactions[0].amount).toBe(100000);
  });
});

