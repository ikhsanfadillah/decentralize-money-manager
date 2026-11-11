import { generateText, type ModelMessage } from "ai";
import { buildConnectionTestPrompt } from "./prompts";
import {
  createVercelLanguageModel,
  formatAiSdkError,
  notifyModelFallback,
  resolveFallbackModelForError,
} from "./providers/registry";
import type {
  ActiveAiConnectionConfig,
  ImageAttachmentPayload,
  ModelFallbackHandler,
} from "./types";

/**
 * Single prompt helper powered by Vercel AI SDK `generateText` with automatic Gemini model replacement retry.
 */
export async function callSinglePromptLlm(options: {
  config: ActiveAiConnectionConfig;
  systemPrompt: string;
  userPrompt: string;
  image?: ImageAttachmentPayload | null;
  onModelFallback?: ModelFallbackHandler;
  _retriedReplacement?: boolean;
}): Promise<string> {
  const { config, systemPrompt, userPrompt, image, onModelFallback } = options;

  if (!config.isConfigured) {
    throw new Error(
      "Kunci API belum dikonfigurasi. Silakan atur API Key terlebih dahulu di Pengaturan > Asisten AI (BYOK)."
    );
  }

  const messages: ModelMessage[] = [
    {
      role: "user",
      content: image
        ? [
            {
              type: "image",
              image: image.base64Data,
              mediaType: image.mimeType,
            },
            { type: "text", text: userPrompt },
          ]
        : userPrompt,
    },
  ];

  try {
    const result = await generateText({
      model: createVercelLanguageModel(config),
      system: systemPrompt,
      messages,
      temperature: 0.2,
      maxRetries: 0,
    });

    const text = result.text.trim();
    if (!text) {
      throw new Error(`Respons dari ${config.providerLabel} kosong.`);
    }
    return text;
  } catch (err: unknown) {
    const formattedErr = formatAiSdkError(err, config.providerLabel);
    const replacementModel = resolveFallbackModelForError(
      config,
      formattedErr.message
    );
    if (replacementModel && !options._retriedReplacement) {
      notifyModelFallback(config.provider, replacementModel, onModelFallback);
      return callSinglePromptLlm({
        ...options,
        config: { ...config, model: replacementModel },
        _retriedReplacement: true,
      });
    }
    throw formattedErr;
  }
}

/**
 * Tests the user's BYOK connection & model configuration via Vercel AI SDK.
 */
export async function testAiConnection(
  config: ActiveAiConnectionConfig
): Promise<{ ok: boolean; latencyMs: number; reply: string }> {
  const start = performance.now();
  const prompts = buildConnectionTestPrompt();
  const reply = await callSinglePromptLlm({
    config,
    systemPrompt: prompts.systemPrompt,
    userPrompt: prompts.userPrompt,
  });
  const latencyMs = Math.max(1, Math.round(performance.now() - start));
  return {
    ok: true,
    latencyMs,
    reply: reply.slice(0, 120),
  };
}

