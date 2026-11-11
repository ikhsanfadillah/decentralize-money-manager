import { create } from "zustand";
import {
  AI_PROVIDER_PRESETS,
  createDefaultByokConfig,
  registerDefaultModelFallbackHandler,
  resolveActiveAiConfig,
  toAddTransactionInputFromDraft,
  toUpsertBudgetInputFromDraft,
  type ActiveAiConnectionConfig,
  type AiByokPersistedConfig,
  type AiProviderConfigItem,
  type AiProviderId,
  type AiProviderPreset,
  type AiReportInsightData,
  type CopilotChatMessage,
  type ProposedBudgetDraft,
  type ProposedTransactionDraft,
} from "../lib/ai";

export {
  AI_PROVIDER_PRESETS,
  createDefaultByokConfig,
  resolveActiveAiConfig,
  toAddTransactionInputFromDraft,
  toUpsertBudgetInputFromDraft,
  type ActiveAiConnectionConfig,
  type AiByokPersistedConfig,
  type AiProviderConfigItem,
  type AiProviderId,
  type AiProviderPreset,
  type AiReportInsightData,
  type CopilotChatMessage,
  type ProposedBudgetDraft,
  type ProposedTransactionDraft,
};

const AI_BYOK_STORAGE_KEY = "dmm-ai-byok-config";

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

// Register store updater for automatic model deprecation fallback
registerDefaultModelFallbackHandler((provider, replacementModel) => {
  useAiStore
    .getState()
    .updateProviderConfig(provider, { model: replacementModel });
});
