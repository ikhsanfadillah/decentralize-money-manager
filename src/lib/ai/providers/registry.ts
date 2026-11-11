import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import type {
  ActiveAiConnectionConfig,
  AiProviderId,
  ModelFallbackHandler,
} from "../types";

let defaultModelFallbackHandler: ModelFallbackHandler | null = null;

export function registerDefaultModelFallbackHandler(
  handler: ModelFallbackHandler | null
): void {
  defaultModelFallbackHandler = handler;
}

export function notifyModelFallback(
  provider: AiProviderId,
  replacementModel: string,
  customHandler?: ModelFallbackHandler
): void {
  if (customHandler) {
    customHandler(provider, replacementModel);
  } else {
    defaultModelFallbackHandler?.(provider, replacementModel);
  }
}

export function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export function normalizeGeminiModelId(model: string): string {
  return model.trim().replace(/^models\//, "");
}

export function extractSuggestedReplacementModel(
  errorMessage: string
): string | null {
  const match = /use\s+models\/([a-zA-Z0-9._-]+)/i.exec(errorMessage);
  return match?.[1] ?? null;
}

export function resolveFallbackModelForError(
  config: ActiveAiConnectionConfig,
  errorMessage: string
): string | null {
  if (config.provider !== "gemini") {
    return null;
  }
  const replacement = extractSuggestedReplacementModel(errorMessage);
  if (
    replacement &&
    replacement !== normalizeGeminiModelId(config.model)
  ) {
    return replacement;
  }
  return null;
}

export function formatAiSdkError(err: unknown, providerLabel: string): Error {
  let rawMessage =
    err instanceof Error ? err.message.trim() : String(err ?? "").trim();

  if (typeof err === "object" && err !== null) {
    const errRecord = err as Record<string, unknown>;
    if (
      typeof errRecord.responseBody === "string" &&
      errRecord.responseBody.trim()
    ) {
      try {
        const parsed = JSON.parse(errRecord.responseBody) as Record<
          string,
          unknown
        >;
        const errObj = parsed.error as
          | Record<string, unknown>
          | string
          | undefined;
        if (typeof errObj === "string" && errObj.trim()) {
          rawMessage = rawMessage ? `${rawMessage} (${errObj})` : errObj;
        } else if (
          errObj &&
          typeof errObj === "object" &&
          typeof errObj.message === "string" &&
          errObj.message.trim()
        ) {
          rawMessage = errObj.message.trim();
        }
      } catch {
        if (!rawMessage) {
          rawMessage = errRecord.responseBody.trim().slice(0, 200);
        }
      }
    }
  }

  if (!rawMessage) {
    rawMessage = `Permintaan ke ${providerLabel} gagal.`;
  }

  const statusCode =
    typeof err === "object" &&
    err !== null &&
    "statusCode" in err &&
    typeof (err as { statusCode?: unknown }).statusCode === "number"
      ? (err as { statusCode: number }).statusCode
      : undefined;

  if (statusCode === 401 || statusCode === 403) {
    return new Error(
      `Kunci API ${providerLabel} tidak valid atau akses ditolak (${statusCode}). ${rawMessage}`
    );
  }
  if (statusCode === 429) {
    return new Error(
      `Batas kuota / rate limit ${providerLabel} tercapai (429). Coba lagi beberapa saat. ${rawMessage}`
    );
  }
  return new Error(rawMessage);
}

/**
 * Creates a Vercel AI SDK LanguageModel instance for the active BYOK configuration.
 */
export function createVercelLanguageModel(config: ActiveAiConnectionConfig) {
  const baseURL = normalizeBaseUrl(config.baseUrl);

  if (config.provider === "gemini") {
    const google = createGoogleGenerativeAI({
      apiKey: config.apiKey,
      baseURL,
    });
    return google(normalizeGeminiModelId(config.model));
  }

  const openaiCompatible = createOpenAI({
    apiKey: config.apiKey || "ollama",
    baseURL,
    name: config.provider,
  });
  return openaiCompatible.chat(config.model);
}

/**
 * Fetches available models dynamically from the configured provider API.
 */
export async function fetchAvailableProviderModels(
  config: ActiveAiConnectionConfig
): Promise<{ id: string; label: string }[]> {
  if (!config.isConfigured) {
    throw new Error(
      "Masukkan API Key terlebih dahulu untuk memuat daftar model."
    );
  }

  const baseUrl = normalizeBaseUrl(config.baseUrl);
  if (config.provider === "gemini") {
    const res = await fetch(
      `${baseUrl}/models?key=${encodeURIComponent(config.apiKey)}`
    );
    if (!res.ok) {
      throw new Error(
        `Gagal memuat model dari ${config.providerLabel} (${res.status})`
      );
    }
    const data = (await res.json()) as {
      models?: {
        name?: string;
        displayName?: string;
        supportedGenerationMethods?: string[];
      }[];
    };
    return (data.models ?? [])
      .filter(
        (m) =>
          m.name &&
          (!m.supportedGenerationMethods ||
            m.supportedGenerationMethods.includes("generateContent"))
      )
      .map((m) => {
        const id = normalizeGeminiModelId(m.name!);
        return {
          id,
          label: m.displayName ? `${m.displayName} (${id})` : id,
        };
      });
  }

  const headers: Record<string, string> = {};
  if (config.apiKey) {
    headers.Authorization = `Bearer ${config.apiKey}`;
  }
  const res = await fetch(`${baseUrl}/models`, { headers });
  if (!res.ok) {
    throw new Error(
      `Gagal memuat model dari ${config.providerLabel} (${res.status})`
    );
  }
  const data = (await res.json()) as {
    data?: { id?: string; name?: string }[];
  };
  return (data.data ?? [])
    .filter((m) => Boolean(m.id))
    .map((m) => ({
      id: m.id!,
      label: m.name && m.name !== m.id ? `${m.name} (${m.id})` : m.id!,
    }));
}

