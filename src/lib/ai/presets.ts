import type { AddTransactionInput, UpsertBudgetInput } from "../tauri-api";
import type {
  ActiveAiConnectionConfig,
  AiByokPersistedConfig,
  AiProviderId,
  AiProviderPreset,
  ProposedBudgetDraft,
  ProposedTransactionDraft,
} from "./types";

export const AI_PROVIDER_PRESETS: Record<AiProviderId, AiProviderPreset> = {
  gemini: {
    id: "gemini",
    label: "Google Gemini API",
    shortLabel: "Gemini",
    defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta",
    defaultModel: "gemini-3.8-flash",
    recommendedModels: [
      {
        id: "gemini-3.8-flash",
        label: "Gemini 3.8 Flash (Terbaru & Vision)",
        supportsVision: true,
      },
      {
        id: "gemini-3.1-pro",
        label: "Gemini 3.1 Pro (Penalaran Mendalam)",
        supportsVision: true,
      },
    ],
    apiKeyPlaceholder: "AIzaSy...",
    docsHint:
      "Dapatkan API Key gratis/berbayar dari Google AI Studio (aistudio.google.com).",
  },
  openai: {
    id: "openai",
    label: "OpenAI API",
    shortLabel: "OpenAI",
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    recommendedModels: [
      {
        id: "gpt-4o-mini",
        label: "GPT-4o Mini (Cepat & Hemat)",
        supportsVision: true,
      },
      {
        id: "gpt-4o",
        label: "GPT-4o (Akurasi Tinggi & Vision)",
        supportsVision: true,
      },
      {
        id: "gpt-4.1-mini",
        label: "GPT-4.1 Mini",
        supportsVision: true,
      },
    ],
    apiKeyPlaceholder: "sk-proj-...",
    docsHint: "Gunakan API Key dari platform.openai.com.",
  },
  deepseek: {
    id: "deepseek",
    label: "DeepSeek API",
    shortLabel: "DeepSeek",
    defaultBaseUrl: "https://api.deepseek.com",
    defaultModel: "deepseek-chat",
    recommendedModels: [
      {
        id: "deepseek-chat",
        label: "DeepSeek-V3 Chat (Hemat & Cepat)",
        supportsVision: false,
      },
      {
        id: "deepseek-reasoner",
        label: "DeepSeek-R1 Reasoner (Penalaran Mendalam)",
        supportsVision: false,
      },
    ],
    apiKeyPlaceholder: "sk-...",
    docsHint: "Dapatkan API Key dari platform.deepseek.com.",
  },
  groq: {
    id: "groq",
    label: "Groq Cloud (LPU Cepat)",
    shortLabel: "Groq",
    defaultBaseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "llama-3.3-70b-versatile",
    recommendedModels: [
      {
        id: "llama-3.3-70b-versatile",
        label: "Llama 3.3 70B Versatile (Sangat Cepat)",
        supportsVision: false,
      },
      {
        id: "meta-llama/llama-4-scout-17b-16e-instruct",
        label: "Llama 4 Scout 17B (Mendukung Vision/Struk)",
        supportsVision: true,
      },
      {
        id: "qwen-qwq-32b",
        label: "Qwen QwQ 32B",
        supportsVision: false,
      },
    ],
    apiKeyPlaceholder: "gsk_...",
    docsHint: "Dapatkan API Key berkecepatan tinggi dari console.groq.com.",
  },
  openrouter: {
    id: "openrouter",
    label: "OpenRouter / Custom / Ollama",
    shortLabel: "OpenRouter",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "google/gemini-2.5-flash",
    recommendedModels: [
      {
        id: "google/gemini-2.5-flash",
        label: "Google: Gemini 2.5 Flash (via OpenRouter)",
        supportsVision: true,
      },
      {
        id: "anthropic/claude-3.5-sonnet",
        label: "Anthropic: Claude 3.5 Sonnet",
        supportsVision: true,
      },
      {
        id: "deepseek/deepseek-chat",
        label: "DeepSeek V3 Chat",
        supportsVision: false,
      },
      {
        id: "llama3.2",
        label: "Ollama Lokal: llama3.2 (Base URL: http://localhost:11434/v1)",
        supportsVision: false,
      },
    ],
    apiKeyPlaceholder: "sk-or-v1-... (atau 'ollama' untuk lokal)",
    docsHint:
      "Bisa digunakan untuk OpenRouter.ai, DeepSeek, atau Ollama lokal (ubah Base URL ke http://localhost:11434/v1).",
  },
};

export function createDefaultByokConfig(): AiByokPersistedConfig {
  return {
    activeProvider: "gemini",
    providers: {
      gemini: {
        apiKey: "",
        model: AI_PROVIDER_PRESETS.gemini.defaultModel,
        baseUrl: AI_PROVIDER_PRESETS.gemini.defaultBaseUrl,
      },
      openai: {
        apiKey: "",
        model: AI_PROVIDER_PRESETS.openai.defaultModel,
        baseUrl: AI_PROVIDER_PRESETS.openai.defaultBaseUrl,
      },
      deepseek: {
        apiKey: "",
        model: AI_PROVIDER_PRESETS.deepseek.defaultModel,
        baseUrl: AI_PROVIDER_PRESETS.deepseek.defaultBaseUrl,
      },
      groq: {
        apiKey: "",
        model: AI_PROVIDER_PRESETS.groq.defaultModel,
        baseUrl: AI_PROVIDER_PRESETS.groq.defaultBaseUrl,
      },
      openrouter: {
        apiKey: "",
        model: AI_PROVIDER_PRESETS.openrouter.defaultModel,
        baseUrl: AI_PROVIDER_PRESETS.openrouter.defaultBaseUrl,
      },
    },
  };
}

export function resolveActiveAiConfig(
  config: AiByokPersistedConfig
): ActiveAiConnectionConfig {
  const provider = config.activeProvider;
  const preset = AI_PROVIDER_PRESETS[provider];
  const item = config.providers[provider] ?? {
    apiKey: "",
    model: preset.defaultModel,
    baseUrl: preset.defaultBaseUrl,
  };
  const trimmedKey = item.apiKey.trim();
  const isLocalEndpoint =
    provider === "openrouter" &&
    (item.baseUrl.includes("localhost") || item.baseUrl.includes("127.0.0.1"));

  return {
    provider,
    providerLabel: preset.shortLabel,
    apiKey: trimmedKey,
    model: item.model.trim() || preset.defaultModel,
    baseUrl: item.baseUrl.trim() || preset.defaultBaseUrl,
    isConfigured: Boolean(trimmedKey) || isLocalEndpoint,
  };
}

export function toAddTransactionInputFromDraft(
  draft: ProposedTransactionDraft
): AddTransactionInput {
  const signedAmount =
    draft.tx_type === "EXPENSE"
      ? -Math.abs(Math.trunc(draft.amount))
      : Math.abs(Math.trunc(draft.amount));

  return {
    account_id: draft.account_id,
    to_account_id:
      draft.tx_type === "TRANSFER" ? (draft.to_account_id ?? null) : null,
    category_id:
      draft.tx_type === "TRANSFER" ? null : (draft.category_id ?? null),
    amount: signedAmount,
    tx_type: draft.tx_type,
    note: draft.note.trim() || null,
    tx_date: draft.tx_date,
  };
}

export function toUpsertBudgetInputFromDraft(
  draft: ProposedBudgetDraft
): UpsertBudgetInput {
  return {
    category_id: draft.category_id,
    period: "MONTHLY",
    amount_limit: Math.abs(Math.trunc(draft.amount_limit)),
    alert_threshold_pct: draft.alert_threshold_pct || 80,
  };
}

