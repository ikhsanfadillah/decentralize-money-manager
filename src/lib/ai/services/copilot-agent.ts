import { generateText, stepCountIs, type ModelMessage } from "ai";
import { currentYearMonth, todayIsoDate } from "../../utils";
import { parseDataUrlToImagePayload } from "../media";
import { buildCopilotAgentSystemPrompt } from "../prompts";
import {
  createVercelLanguageModel,
  formatAiSdkError,
  notifyModelFallback,
  resolveFallbackModelForError,
} from "../providers/registry";
import {
  buildCopilotVercelTools,
  type AgentToolExecutionContext,
} from "../tools/copilot-tools";
import type {
  ActiveAiConnectionConfig,
  CopilotChatMessage,
  ImageAttachmentPayload,
  ModelFallbackHandler,
  ProposedBudgetDraft,
  ProposedTransactionDraft,
} from "../types";

/**
 * Runs an interactive Agentic Assistant turn with multi-step tool calling powered by Vercel AI SDK `generateText`.
 */
export async function runCopilotAgentTurn(options: {
  config: ActiveAiConnectionConfig;
  bookId: string;
  bookName?: string;
  history: CopilotChatMessage[];
  userMessage: string;
  image?: ImageAttachmentPayload | null;
  onToolStep?: (stepLabel: string) => void;
  onModelFallback?: ModelFallbackHandler;
  _retriedReplacement?: boolean;
}): Promise<{
  replyText: string;
  toolSteps: string[];
  proposedTransactions: ProposedTransactionDraft[];
  proposedBudgets: ProposedBudgetDraft[];
}> {
  const {
    config,
    bookId,
    bookName,
    history,
    userMessage,
    image,
    onToolStep,
    onModelFallback,
  } = options;

  if (!config.isConfigured) {
    throw new Error(
      "Kunci API belum diatur. Buka Pengaturan > Asisten AI (BYOK) untuk memasukkan API Key."
    );
  }

  const toolSteps: string[] = [];
  const execContext: AgentToolExecutionContext = {
    bookId,
    onToolStep: (step) => {
      toolSteps.push(step);
      onToolStep?.(step);
    },
    collectedTransactions: [],
    collectedBudgets: [],
  };

  const systemPrompt = buildCopilotAgentSystemPrompt({
    bookId,
    bookName,
    todayDate: todayIsoDate(),
    currentMonth: currentYearMonth(),
  });

  const messages: ModelMessage[] = [];
  for (const msg of history.slice(-8)) {
    if (msg.isError || (!msg.content.trim() && !msg.imageAttachment)) continue;
    if (msg.role === "user" && msg.imageAttachment) {
      const parsedHistoryImg = parseDataUrlToImagePayload(
        msg.imageAttachment.dataUrl
      );
      if (parsedHistoryImg) {
        messages.push({
          role: "user",
          content: [
            {
              type: "image",
              image: parsedHistoryImg.base64Data,
              mediaType: parsedHistoryImg.mimeType,
            },
            {
              type: "text",
              text: msg.content.trim() || "Foto struk/nota terlampir.",
            },
          ],
        });
        continue;
      }
    }
    messages.push({
      role: msg.role,
      content: msg.content,
    });
  }

  if (image) {
    messages.push({
      role: "user",
      content: [
        {
          type: "image",
          image: image.base64Data,
          mediaType: image.mimeType,
        },
        {
          type: "text",
          text:
            userMessage.trim() ||
            "Tolong periksa dan ekstrak data transaksi dari foto/struk ini.",
        },
      ],
    });
  } else {
    messages.push({
      role: "user",
      content: userMessage,
    });
  }

  try {
    const result = await generateText({
      model: createVercelLanguageModel(config),
      system: systemPrompt,
      messages,
      tools: buildCopilotVercelTools(execContext),
      stopWhen: stepCountIs(5),
      temperature: 0.25,
      maxRetries: 0,
    });

    return {
      replyText:
        result.text.trim() ||
        "Berikut draf dan hasil pemeriksaan data keuangan Anda.",
      toolSteps,
      proposedTransactions: execContext.collectedTransactions,
      proposedBudgets: execContext.collectedBudgets,
    };
  } catch (err: unknown) {
    const formattedErr = formatAiSdkError(err, config.providerLabel);
    const replacementModel = resolveFallbackModelForError(
      config,
      formattedErr.message
    );
    if (replacementModel && !options._retriedReplacement) {
      notifyModelFallback(config.provider, replacementModel, onModelFallback);
      return runCopilotAgentTurn({
        ...options,
        config: { ...config, model: replacementModel },
        _retriedReplacement: true,
      });
    }
    throw formattedErr;
  }
}

