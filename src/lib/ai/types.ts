import type { TransactionType } from "../tauri-api";

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

export interface AiProviderConfigItem {
  apiKey: string;
  model: string;
  baseUrl: string;
}

export interface AiByokPersistedConfig {
  activeProvider: AiProviderId;
  providers: Record<AiProviderId, AiProviderConfigItem>;
}

export interface ActiveAiConnectionConfig {
  provider: AiProviderId;
  providerLabel: string;
  apiKey: string;
  model: string;
  baseUrl: string;
  isConfigured: boolean;
}

export interface ImageAttachmentPayload {
  mimeType: string;
  base64Data: string;
  dataUrl: string;
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

export type FinancialHealthLabel =
  | "Sangat Sehat"
  | "Sehat"
  | "Perlu Perhatian"
  | "Kritis";

export type InsightHighlightSeverity =
  | "positive"
  | "warning"
  | "critical"
  | "neutral";

export interface AiReportInsightHighlight {
  title: string;
  detail: string;
  severity: InsightHighlightSeverity;
}

export interface AiReportInsightData {
  generatedAt: string;
  providerLabel: string;
  model: string;
  executiveSummary: string;
  healthScore: number; // 0-100
  healthLabel: FinancialHealthLabel;
  highlights: AiReportInsightHighlight[];
  budgetRecommendations: ProposedBudgetDraft[];
}

export type ModelFallbackHandler = (
  provider: AiProviderId,
  replacementModel: string
) => void;

