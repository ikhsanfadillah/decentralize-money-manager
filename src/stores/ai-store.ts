import { create } from "zustand";
import type {
  AddTransactionInput,
  TransactionType,
  UpsertBudgetInput,
} from "../lib/tauri-api";

export type AiProviderId =
  | "gemini"
  | "openai"
  | "deepseek"
  | "groq"
  | "openrouter";

export interface AiProviderPreset {
  id: AiProviderId;
  label: string;
  shortLabel: string;
  defaultBaseUrl: string;
  defaultModel: string;
  recommendedModels: { id: string; label: string; supportsVision?: boolean }[];
  apiKeyPlaceholder: string;
  docsHint: string;
}

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
    docsHint: "Dapatkan API Key gratis/berbayar dari Google AI Studio (aistudio.google.com).",
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

export interface AiProviderConfigItem {
  apiKey: string;
  model: string;
  baseUrl: string;
}

export interface AiByokPersistedConfig {
  activeProvider: AiProviderId;
  providers: Record<AiProviderId, AiProviderConfigItem>;
}

export interface ProposedTransactionDraft {
  id: string;
  tx_type: TransactionType;
  account_id: string;
  account_name: string;
  to_account_id?: string | null;
  to_account_name?: string | null;
  category_id?: string | null;
  category_name?: string | null;
  suggested_new_category?: string | null;
  amount: number;
  tx_date: string;
  note: string;
  applied?: boolean;
}

export interface ProposedBudgetDraft {
  id: string;
  category_id: string | null;
  category_name: string;
  amount_limit: number;
  alert_threshold_pct: number;
  reason?: string;
  applied?: boolean;
}

export interface CopilotChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  imageAttachment?: {
    dataUrl: string;
    fileName?: string;
  };
  toolSteps?: string[];
  proposedTransactions?: ProposedTransactionDraft[];
  proposedBudgets?: ProposedBudgetDraft[];
  isError?: boolean;
}

export interface AiReportInsightData {
  generatedAt: string;
  providerLabel: string;
  model: string;
  executiveSummary: string;
  healthScore: number; // 0-100
  healthLabel: "Sangat Sehat" | "Sehat" | "Perlu Perhatian" | "Kritis";
  highlights: {
    title: string;
    detail: string;
    severity: "positive" | "warning" | "critical" | "neutral";
  }[];
  budgetRecommendations: ProposedBudgetDraft[];
}

const AI_BYOK_STORAGE_KEY = "dmm-ai-byok-config";

function createDefaultByokConfig(): AiByokPersistedConfig {
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

export function loadStoredByokConfig(): AiByokPersistedConfig {
  const defaults = createDefaultByokConfig();
  if (typeof window === "undefined") {
    return defaults;
  }
  try {
    const raw = window.localStorage.getItem(AI_BYOK_STORAGE_KEY);
    if (!raw) {
      return defaults;
    }
    const parsed = JSON.parse(raw) as Partial<AiByokPersistedConfig>;
    const activeProvider: AiProviderId =
      parsed.activeProvider && parsed.activeProvider in AI_PROVIDER_PRESETS
        ? parsed.activeProvider
        : "gemini";

    const mergedProviders = { ...defaults.providers };
    if (parsed.providers && typeof parsed.providers === "object") {
      for (const key of Object.keys(AI_PROVIDER_PRESETS) as AiProviderId[]) {
        const item = parsed.providers[key];
        if (item && typeof item === "object") {
          let resolvedModel =
            typeof item.model === "string" && item.model.trim()
              ? item.model.trim().replace(/^models\//, "")
              : AI_PROVIDER_PRESETS[key].defaultModel;

          // Auto-migrate deprecated Gemini 2.5/2.0 flash default for new accounts
          if (
            key === "gemini" &&
            (resolvedModel === "gemini-2.5-flash" ||
              resolvedModel === "gemini-2.0-flash")
          ) {
            resolvedModel = AI_PROVIDER_PRESETS.gemini.defaultModel;
          }

          mergedProviders[key] = {
            apiKey: typeof item.apiKey === "string" ? item.apiKey : "",
            model: resolvedModel,
            baseUrl:
              typeof item.baseUrl === "string" && item.baseUrl.trim()
                ? item.baseUrl.trim()
                : AI_PROVIDER_PRESETS[key].defaultBaseUrl,
          };
        }
      }
    }

    return {
      activeProvider,
      providers: mergedProviders,
    };
  } catch {
    return defaults;
  }
}

function persistByokConfig(config: AiByokPersistedConfig): void {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(AI_BYOK_STORAGE_KEY, JSON.stringify(config));
  } catch {
    // Ignore storage quota / private mode errors
  }
}

export interface ActiveAiConnectionConfig {
  provider: AiProviderId;
  providerLabel: string;
  apiKey: string;
  model: string;
  baseUrl: string;
  isConfigured: boolean;
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

export interface AiStoreState {
  byok: AiByokPersistedConfig;
  isCopilotOpen: boolean;
  isByokSettingsDrawerOpen: boolean;
  chatByBook: Record<string, CopilotChatMessage[]>;
  reportInsightsByKey: Record<string, AiReportInsightData>;

  setActiveProvider: (provider: AiProviderId) => void;
  updateProviderConfig: (
    provider: AiProviderId,
    patch: Partial<AiProviderConfigItem>
  ) => void;
  clearProviderApiKey: (provider: AiProviderId) => void;
  setCopilotOpen: (open: boolean) => void;
  setByokSettingsDrawerOpen: (open: boolean) => void;

  appendChatMessage: (bookId: string, msg: CopilotChatMessage) => void;
  updateChatMessage: (
    bookId: string,
    msgId: string,
    updater: (prev: CopilotChatMessage) => CopilotChatMessage
  ) => void;
  clearBookChat: (bookId: string) => void;

  setReportInsight: (
    bookId: string,
    month: string,
    insight: AiReportInsightData
  ) => void;
  markInsightBudgetApplied: (
    bookId: string,
    month: string,
    draftId: string
  ) => void;
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

export const useAiStore = create<AiStoreState>((set) => ({
  byok: loadStoredByokConfig(),
  isCopilotOpen: false,
  isByokSettingsDrawerOpen: false,
  chatByBook: {},
  reportInsightsByKey: {},

  setActiveProvider: (provider) =>
    set((state) => {
      const next: AiByokPersistedConfig = {
        ...state.byok,
        activeProvider: provider,
      };
      persistByokConfig(next);
      return { byok: next };
    }),

  updateProviderConfig: (provider, patch) =>
    set((state) => {
      const current = state.byok.providers[provider];
      const next: AiByokPersistedConfig = {
        ...state.byok,
        providers: {
          ...state.byok.providers,
          [provider]: {
            ...current,
            ...patch,
          },
        },
      };
      persistByokConfig(next);
      return { byok: next };
    }),

  clearProviderApiKey: (provider) =>
    set((state) => {
      const current = state.byok.providers[provider];
      const next: AiByokPersistedConfig = {
        ...state.byok,
        providers: {
          ...state.byok.providers,
          [provider]: {
            ...current,
            apiKey: "",
          },
        },
      };
      persistByokConfig(next);
      return { byok: next };
    }),

  setCopilotOpen: (open) => set({ isCopilotOpen: open }),

  setByokSettingsDrawerOpen: (open) => set({ isByokSettingsDrawerOpen: open }),

  appendChatMessage: (bookId, msg) =>
    set((state) => ({
      chatByBook: {
        ...state.chatByBook,
        [bookId]: [...(state.chatByBook[bookId] ?? []), msg],
      },
    })),

  updateChatMessage: (bookId, msgId, updater) =>
    set((state) => {
      const list = state.chatByBook[bookId] ?? [];
      return {
        chatByBook: {
          ...state.chatByBook,
          [bookId]: list.map((m) => (m.id === msgId ? updater(m) : m)),
        },
      };
    }),

  clearBookChat: (bookId) =>
    set((state) => ({
      chatByBook: {
        ...state.chatByBook,
        [bookId]: [],
      },
    })),

  setReportInsight: (bookId, month, insight) =>
    set((state) => ({
      reportInsightsByKey: {
        ...state.reportInsightsByKey,
        [`${bookId}:${month}`]: insight,
      },
    })),

  markInsightBudgetApplied: (bookId, month, draftId) =>
    set((state) => {
      const key = `${bookId}:${month}`;
      const existing = state.reportInsightsByKey[key];
      if (!existing) return state;
      return {
        reportInsightsByKey: {
          ...state.reportInsightsByKey,
          [key]: {
            ...existing,
            budgetRecommendations: existing.budgetRecommendations.map((b) =>
              b.id === draftId ? { ...b, applied: true } : b
            ),
          },
        },
      };
    }),
}));

