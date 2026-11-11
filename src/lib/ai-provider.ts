export {
  callSinglePromptLlm,
  testAiConnection,
} from "./ai/client";

export {
  compressImageFileToDataUrl,
  parseDataUrlToImagePayload,
} from "./ai/media";

export {
  createVercelLanguageModel,
  extractSuggestedReplacementModel,
  fetchAvailableProviderModels,
  formatAiSdkError,
  normalizeBaseUrl,
  normalizeGeminiModelId,
} from "./ai/providers/registry";

export { extractJsonFromLlmText } from "./ai/schemas";

export { runCopilotAgentTurn } from "./ai/services/copilot-agent";
export { generateMonthlyReportInsight } from "./ai/services/report-insight";
export { parseSmartTransactionInput } from "./ai/services/smart-transaction";

export type { ImageAttachmentPayload } from "./ai/types";
