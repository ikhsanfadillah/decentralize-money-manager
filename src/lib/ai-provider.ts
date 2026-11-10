import { generateText, stepCountIs, type ModelMessage } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import {
  buildCopilotVercelTools,
  matchAccountByName,
  matchCategoryByName,
  type AgentToolExecutionContext,
} from "./ai-agent-tools";
import type {
  AccountView,
  BudgetProgressItem,
  CategoryView,
  MonthlyReportResponse,
  TransactionType,
} from "./tauri-api";
import { currentYearMonth, todayIsoDate } from "./utils";
import {
  useAiStore,
  type ActiveAiConnectionConfig,
  type AiReportInsightData,
  type CopilotChatMessage,
  type ProposedBudgetDraft,
  type ProposedTransactionDraft,
} from "../stores/ai-store";

export interface ImageAttachmentPayload {
  mimeType: string;
  base64Data: string;
  dataUrl: string;
}

/**
 * Compresses an image file in the browser canvas and returns a base64 JPEG data URL.
 */
export async function compressImageFileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Gagal membaca file gambar."));
    reader.onload = () => {
      const resultStr = String(reader.result ?? "");
      if (typeof Image === "undefined") {
        resolve(resultStr);
        return;
      }
      const img = new Image();
      img.onerror = () => resolve(resultStr);
      img.onload = () => {
        try {
          const maxDim = 1280;
          let { width, height } = img;
          if (width > maxDim || height > maxDim) {
            if (width >= height) {
              height = Math.round((height * maxDim) / width);
              width = maxDim;
            } else {
              width = Math.round((width * maxDim) / height);
              height = maxDim;
            }
          }
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            resolve(resultStr);
            return;
          }
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL("image/jpeg", 0.82));
        } catch {
          resolve(resultStr);
        }
      };
      img.src = resultStr;
    };
    reader.readAsDataURL(file);
  });
}

export function parseDataUrlToImagePayload(
  dataUrl: string
): ImageAttachmentPayload | null {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(
    dataUrl.trim()
  );
  if (!match) return null;
  return {
    mimeType: match[1],
    base64Data: match[2],
    dataUrl: dataUrl.trim(),
  };
}

export function extractJsonFromLlmText(rawText: string): unknown {
  const trimmed = rawText.trim();
  if (!trimmed) {
    throw new Error("Respons AI kosong.");
  }

  // 1. Try direct JSON parse
  try {
    return JSON.parse(trimmed);
  } catch {
    // continue
  }

  // 2. Try fenced ```json ... ``` block
  const fencedMatch = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fencedMatch?.[1]) {
    try {
      return JSON.parse(fencedMatch[1].trim());
    } catch {
      // continue
    }
  }

  // 3. Try first { ... } or [ ... ] substring
  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    try {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1));
    } catch {
      // continue
    }
  }

  throw new Error("Format respons AI tidak berupa JSON yang valid.");
}

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

function normalizeGeminiModelId(model: string): string {
  return model.trim().replace(/^models\//, "");
}

function extractSuggestedReplacementModel(errorMessage: string): string | null {
  const match = /use\s+models\/([a-zA-Z0-9._-]+)/i.exec(errorMessage);
  return match?.[1] ?? null;
}

function formatAiSdkError(err: unknown, providerLabel: string): Error {
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
      throw new Error(`Gagal memuat model dari ${config.providerLabel} (${res.status})`);
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
    throw new Error(`Gagal memuat model dari ${config.providerLabel} (${res.status})`);
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

/**
 * Single prompt helper powered by Vercel AI SDK `generateText` with automatic Gemini model replacement retry.
 */
export async function callSinglePromptLlm(options: {
  config: ActiveAiConnectionConfig;
  systemPrompt: string;
  userPrompt: string;
  image?: ImageAttachmentPayload | null;
  _retriedReplacement?: boolean;
}): Promise<string> {
  const { config, systemPrompt, userPrompt, image } = options;

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
    const replacementModel = extractSuggestedReplacementModel(
      formattedErr.message
    );
    if (
      config.provider === "gemini" &&
      replacementModel &&
      replacementModel !== normalizeGeminiModelId(config.model) &&
      !options._retriedReplacement
    ) {
      useAiStore
        .getState()
        .updateProviderConfig("gemini", { model: replacementModel });
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
  const reply = await callSinglePromptLlm({
    config,
    systemPrompt:
      "Kamu adalah asisten keuangan. Jawab hanya dengan kalimat singkat: 'Koneksi AI siap digunakan.'",
    userPrompt: "Tes koneksi",
  });
  const latencyMs = Math.max(1, Math.round(performance.now() - start));
  return {
    ok: true,
    latencyMs,
    reply: reply.slice(0, 120),
  };
}

/**
 * Parses natural language text and/or receipt photo into 1 or more ProposedTransactionDraft items.
 */
export async function parseSmartTransactionInput(options: {
  config: ActiveAiConnectionConfig;
  prompt: string;
  imageDataUrl?: string | null;
  accounts: AccountView[];
  categories: CategoryView[];
  todayDate?: string;
}): Promise<ProposedTransactionDraft[]> {
  const {
    config,
    prompt,
    imageDataUrl,
    accounts,
    categories,
    todayDate = todayIsoDate(),
  } = options;

  const activeAccounts = accounts.filter(
    (a) => !a.merged_into_id && a.is_deleted === 0
  );
  const activeExpenseCats = categories.filter(
    (c) => c.kind === "EXPENSE" && !c.merged_into_id && c.is_deleted === 0
  );
  const activeIncomeCats = categories.filter(
    (c) => c.kind === "INCOME" && !c.merged_into_id && c.is_deleted === 0
  );

  const imagePayload = imageDataUrl
    ? parseDataUrlToImagePayload(imageDataUrl)
    : null;

  const systemPrompt = `Kamu adalah parser transaksi keuangan cerdas untuk aplikasi Money Manager Indonesia.
Hari ini tanggal: ${todayDate}.
Daftar Rekening Aktif:
${activeAccounts.map((a) => `- "${a.name}" (tipe: ${a.account_type})`).join("\n") || "- Kas Tunai (CASH)"}

Daftar Kategori PENGELUARAN (EXPENSE):
${activeExpenseCats.map((c) => `- "${c.name}"`).join("\n") || "- Makanan & Minuman, Transportasi, Belanja"}

Daftar Kategori PEMASUKAN (INCOME):
${activeIncomeCats.map((c) => `- "${c.name}"`).join("\n") || "- Gaji, Penjualan, Lainnya"}

TUGAS:
Ekstrak 1 atau beberapa transaksi dari teks pengguna dan/atau gambar struk/mutasi yang diberikan.
- Konversi singkatan nominal Indonesia: "rb"/"ribu"/"k" = x1.000, "jt"/"juta" = x1.000.000 (contoh: "25rb" -> 25000, "1,5jt" -> 1500000).
- Jika dari gambar struk belanja terdapat total akhir yang jelas dan pengguna tidak meminta rincian per item, buat 1 transaksi dengan total akhir struk tersebut dan tulis rincian item di field "note". Namun jika pengguna menulis beberapa transaksi berbeda (misal: "beli kopi 25rb dan bensin 50rb"), buat beberapa item transaksi di dalam array "transactions".
- Pilih "account_name" yang paling cocok dari Daftar Rekening Aktif.
- Pilih "category_name" yang paling cocok dari Daftar Kategori sesuai jenisnya (EXPENSE/INCOME), atau usulkan nama kategori singkat yang relevan jika belum ada.
- Kembalikan HANYA objek JSON murni dengan struktur berikut tanpa markdown tambahan:
{
  "transactions": [
    {
      "tx_type": "EXPENSE" | "INCOME" | "TRANSFER",
      "amount": 25000,
      "account_name": "Nama Rekening Asal",
      "to_account_name": null,
      "category_name": "Nama Kategori",
      "tx_date": "${todayDate}",
      "note": "Catatan singkat"
    }
  ]
}`;

  const userText =
    prompt.trim() ||
    (imagePayload
      ? "Ekstrak transaksi keuangan dari gambar struk/bukti transaksi ini."
      : "");

  if (!userText) {
    throw new Error(
      "Masukkan kalimat transaksi atau pilih foto struk terlebih dahulu."
    );
  }

  const rawReply = await callSinglePromptLlm({
    config,
    systemPrompt,
    userPrompt: userText,
    image: imagePayload,
  });

  const parsed = extractJsonFromLlmText(rawReply) as {
    transactions?: Record<string, unknown>[];
  };

  const items = Array.isArray(parsed?.transactions)
    ? parsed.transactions
    : Array.isArray(parsed)
      ? (parsed as Record<string, unknown>[])
      : [];

  const drafts: ProposedTransactionDraft[] = [];

  for (let i = 0; i < items.length; i++) {
    const raw = items[i];
    const rawType = String(raw.tx_type ?? "EXPENSE").toUpperCase();
    const tx_type: TransactionType =
      rawType === "INCOME" || rawType === "TRANSFER" ? rawType : "EXPENSE";

    const amount = Math.max(
      0,
      Math.abs(Math.trunc(Number(raw.amount ?? 0)))
    );
    if (amount <= 0) continue;

    const srcAcc = matchAccountByName(
      activeAccounts,
      typeof raw.account_name === "string" ? raw.account_name : null
    );
    if (!srcAcc) continue;

    let toAcc: AccountView | null = null;
    if (tx_type === "TRANSFER") {
      const otherAccounts = activeAccounts.filter((a) => a.id !== srcAcc.id);
      toAcc =
        matchAccountByName(
          otherAccounts,
          typeof raw.to_account_name === "string" ? raw.to_account_name : null
        ) ??
        otherAccounts[0] ??
        null;
    }

    const catResult =
      tx_type === "TRANSFER"
        ? { matched: null, suggestedNewName: null }
        : matchCategoryByName(
            categories,
            tx_type,
            typeof raw.category_name === "string" ? raw.category_name : null
          );

    const tx_date =
      typeof raw.tx_date === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(raw.tx_date.trim())
        ? raw.tx_date.trim()
        : todayDate;

    drafts.push({
      id: `magic-tx-${Date.now()}-${i}`,
      tx_type,
      account_id: srcAcc.id,
      account_name: srcAcc.name,
      to_account_id: toAcc?.id ?? null,
      to_account_name: toAcc?.name ?? null,
      category_id: catResult.matched?.id ?? null,
      category_name:
        catResult.suggestedNewName ?? catResult.matched?.name ?? null,
      suggested_new_category: catResult.suggestedNewName,
      amount,
      tx_date,
      note:
        typeof raw.note === "string" && raw.note.trim()
          ? raw.note.trim()
          : prompt.trim().slice(0, 80) || "Transaksi pintar",
    });
  }

  if (drafts.length === 0) {
    throw new Error(
      "AI tidak menemukan nominal transaksi yang valid dari input tersebut. Coba sertakan nominal uangnya (misal: 'Beli makan siang 35rb')."
    );
  }

  return drafts;
}

/**
 * Generates structured financial insights & actionable budget recommendations for MonthlyReportPage & BudgetsPage.
 */
export async function generateMonthlyReportInsight(options: {
  config: ActiveAiConnectionConfig;
  report: MonthlyReportResponse;
  budgets: BudgetProgressItem[];
  categories: CategoryView[];
  isBusinessBook?: boolean;
}): Promise<AiReportInsightData> {
  const {
    config,
    report,
    budgets,
    categories,
    isBusinessBook = false,
  } = options;

  const compactPayload = {
    month: report.month,
    prev_month: report.prev_month,
    book_type: isBusinessBook ? "BUSINESS" : "PERSONAL",
    operational_income: report.operational_income,
    operational_expense: report.operational_expense,
    operational_net: report.operational_net,
    prev_operational_income: report.prev_operational_income,
    prev_operational_expense: report.prev_operational_expense,
    savings_rate_pct: Number((report.savings_rate_bps / 100).toFixed(2)),
    daily_burn_rate: report.daily_burn_rate,
    projected_month_expense: report.projected_month_expense,
    total_budget_limit: report.total_budget_limit,
    no_spend_days: report.no_spend_days,
    elapsed_days: report.elapsed_days,
    days_in_month: report.days_in_month,
    capital_injection: report.capital_injection,
    capital_withdrawal: report.capital_withdrawal,
    categories: report.category_breakdown.slice(0, 10).map((c) => ({
      name: c.category_name,
      kind: c.kind,
      current: c.current_amount,
      prev: c.prev_amount,
      delta: c.delta_amount,
      delta_pct: c.delta_pct,
      share_pct: Number((c.share_bps / 100).toFixed(1)),
    })),
    budgets: budgets.map((b) => ({
      category_name:
        b.category_id === null ? "Total Pengeluaran" : b.category_name,
      limit: b.amount_limit,
      spent: b.spent,
      pct: b.pct,
      status: b.status,
    })),
    device_contributions: report.device_contributions.map((d) => ({
      device_name: d.device_name || d.device_id.slice(0, 8),
      tx_count: d.tx_count,
      total_expense: d.total_expense,
      share_pct: Number((d.share_bps / 100).toFixed(1)),
    })),
  };

  const systemPrompt = `Kamu adalah penasihat keuangan pribadi & bisnis senior untuk pengguna aplikasi Money Manager Indonesia.
Analisis data laporan bulanan yang diberikan dan kembalikan HANYA objek JSON murni dengan skema berikut:
{
  "executiveSummary": "Ringkasan 2-3 kalimat yang tajam, spesifik menyebut angka Rupiah penting, kondisi surplus/defisit, dan proyeksi akhir bulan.",
  "healthScore": 82,
  "healthLabel": "Sangat Sehat" | "Sehat" | "Perlu Perhatian" | "Kritis",
  "highlights": [
    {
      "title": "Judul sorotan singkat",
      "detail": "Penjelasan spesifik (misal lonjakan kategori dibanding bulan lalu, burn rate harian, atau kontribusi perangkat P2P)",
      "severity": "positive" | "warning" | "critical" | "neutral"
    }
  ],
  "budgetRecommendations": [
    {
      "category_name": "Nama kategori pengeluaran dari data atau 'Total Pengeluaran'",
      "amount_limit": 1500000,
      "alert_threshold_pct": 80,
      "reason": "Alasan singkat mengapa batas anggaran ini disarankan"
    }
  ]
}
Berikan 2 sampai 4 item pada "highlights" dan 1 sampai 3 item pada "budgetRecommendations" (gunakan angka Rupiah bulat yang realistis).`;

  const rawText = await callSinglePromptLlm({
    config,
    systemPrompt,
    userPrompt: `Data Laporan Bulanan:\n${JSON.stringify(compactPayload)}`,
  });

  const parsed = extractJsonFromLlmText(rawText) as Record<string, unknown>;

  const rawScore = Number(parsed.healthScore ?? 75);
  const healthScore = Number.isFinite(rawScore)
    ? Math.max(0, Math.min(100, Math.round(rawScore)))
    : 75;

  const validLabels = [
    "Sangat Sehat",
    "Sehat",
    "Perlu Perhatian",
    "Kritis",
  ] as const;
  const healthLabel = validLabels.includes(
    parsed.healthLabel as (typeof validLabels)[number]
  )
    ? (parsed.healthLabel as (typeof validLabels)[number])
    : healthScore >= 80
      ? "Sangat Sehat"
      : healthScore >= 65
        ? "Sehat"
        : healthScore >= 45
          ? "Perlu Perhatian"
          : "Kritis";

  const rawHighlights = Array.isArray(parsed.highlights)
    ? parsed.highlights
    : [];
  const highlights = rawHighlights.slice(0, 4).map((h) => {
    const item = h as Record<string, unknown>;
    const sev = String(item.severity ?? "neutral");
    return {
      title: String(item.title ?? "Sorotan Keuangan"),
      detail: String(item.detail ?? ""),
      severity: (
        ["positive", "warning", "critical", "neutral"].includes(sev)
          ? sev
          : "neutral"
      ) as "positive" | "warning" | "critical" | "neutral",
    };
  });

  const rawRecs = Array.isArray(parsed.budgetRecommendations)
    ? parsed.budgetRecommendations
    : [];
  const budgetRecommendations: ProposedBudgetDraft[] = [];

  for (let i = 0; i < rawRecs.slice(0, 3).length; i++) {
    const r = rawRecs[i] as Record<string, unknown>;
    const amount_limit = Math.max(
      0,
      Math.abs(Math.trunc(Number(r.amount_limit ?? 0)))
    );
    if (amount_limit <= 0) continue;

    const rawCatName = String(r.category_name ?? "Total Pengeluaran").trim();
    const isTotal =
      rawCatName.toLowerCase().includes("total") ||
      rawCatName.toLowerCase().includes("semua");

    let category_id: string | null = null;
    let category_name = "Total Pengeluaran";

    if (!isTotal) {
      const match = matchCategoryByName(categories, "EXPENSE", rawCatName);
      if (match.matched) {
        category_id = match.matched.id;
        category_name = match.matched.name;
      } else {
        continue;
      }
    }

    budgetRecommendations.push({
      id: `insight-budget-${Date.now()}-${i}`,
      category_id,
      category_name,
      amount_limit,
      alert_threshold_pct: 80,
      reason: typeof r.reason === "string" ? r.reason : undefined,
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    providerLabel: config.providerLabel,
    model: config.model,
    executiveSummary:
      typeof parsed.executiveSummary === "string" &&
      parsed.executiveSummary.trim()
        ? parsed.executiveSummary.trim()
        : "Analisis laporan bulanan selesai disusun.",
    healthScore,
    healthLabel,
    highlights,
    budgetRecommendations,
  };
}

/**
 * Runs an interactive Agentic Co-Pilot turn with multi-step tool calling powered by Vercel AI SDK `generateText`.
 */
export async function runCopilotAgentTurn(options: {
  config: ActiveAiConnectionConfig;
  bookId: string;
  bookName?: string;
  history: CopilotChatMessage[];
  userMessage: string;
  image?: ImageAttachmentPayload | null;
  onToolStep?: (stepLabel: string) => void;
  _retriedReplacement?: boolean;
}): Promise<{
  replyText: string;
  toolSteps: string[];
  proposedTransactions: ProposedTransactionDraft[];
  proposedBudgets: ProposedBudgetDraft[];
}> {
  const { config, bookId, bookName, history, userMessage, image, onToolStep } =
    options;

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

  const systemPrompt = `Kamu adalah Financial Co-Pilot AI di aplikasi Decentralize Money Manager.
Buku aktif saat ini: "${bookName || "Buku Keuangan"}" (ID: ${bookId}).
Tanggal hari ini: ${todayIsoDate()} (Bulan berjalan: ${currentYearMonth()}).

PEDOMAN PENTING:
1. Jawab selalu dalam Bahasa Indonesia yang ringkas, ramah, dan rapi (gunakan bullet points & format Rp untuk angka uang).
2. JANGAN PERNAH MENGARANG angka saldo, transaksi, rekening, atau laporan. Gunakan tools yang tersedia (get_book_overview, search_transactions, get_monthly_report, get_budget_progress) untuk mengambil data nyata dari buku aktif sebelum menjawab pertanyaan.
3. ATURAN PENGAJUAN TRANSAKSI (propose_transactions):
   - Jangan mengisi parameter 'account_name' dengan null atau nama rekening rekaan.
   - Jika pengguna meminta mencatat transaksi TETAPI belum menyebutkan rekening/dompet yang digunakan (misal: "catat pengeluaran 100 ribu sebagai food"):
     a. Panggil tool 'get_book_overview' terlebih dahulu untuk melihat daftar rekening aktif beserta saldonya.
     b. Jika buku hanya memiliki 1 rekening aktif, gunakan rekening tersebut.
     c. Jika buku memiliki lebih dari 1 rekening aktif, JANGAN langsung memanggil 'propose_transactions'. Tanyakan secara ramah kepada pengguna ingin dicatat dari rekening mana, sambil menyebutkan daftar rekening yang tersedia dan saldonya.
   - Jika jenis transaksi ambigu (tidak jelas apakah Pengeluaran, Pemasukan, atau Transfer antar rekening), tanyakan klarifikasi terlebih dahulu sebelum membuat draf.
   - Jika kategori transaksi belum disebutkan atau tidak ada petunjuk, tanyakan kepada pengguna atau sarankan kategori yang sesuai dari daftar kategori aktif di 'get_book_overview'.
   - Jika transaksi adalah Transfer antar rekening, pastikan rekening asal dan rekening tujuan sudah jelas. Jika belum, tanyakan rekening tujuannya.
   - Ketika jenis transaksi, nominal, dan rekening sudah jelas (atau setelah pengguna menjawab pertanyaan klarifikasi), barulah panggil tool 'propose_transactions' agar muncul kartu konfirmasi 1-klik di chat.
4. ATURAN TARGET ANGGARAN (propose_budgets):
   - Panggil tool 'propose_budgets' untuk mengajukan draf target anggaran bulanan agar muncul kartu konfirmasi di chat.
5. JIKA PENGGUNA MELAMPIRKAN FOTO / STRUK / NOTA:
   - Periksa foto struk/nota dengan cermat: baca nama merchant/toko, tanggal struk, total nominal atau perincian barang/layanan, serta metode pembayaran jika tertera.
   - Jika total nominal dan jenis pengeluaran terbaca jelas, gunakan nama merchant/toko sebagai catatan (note) transaksi.
   - Terapkan aturan rekening: jika rekening pembayaran belum disebutkan dan buku memiliki lebih dari 1 rekening aktif, tanyakan kepada pengguna rekening mana yang digunakan untuk membayar struk ini.
   - Panggil tool 'propose_transactions' setelah data siap agar pengguna dapat mengonfirmasi.`;

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
    const replacementModel = extractSuggestedReplacementModel(
      formattedErr.message
    );
    if (
      config.provider === "gemini" &&
      replacementModel &&
      replacementModel !== normalizeGeminiModelId(config.model) &&
      !options._retriedReplacement
    ) {
      useAiStore
        .getState()
        .updateProviderConfig("gemini", { model: replacementModel });
      return runCopilotAgentTurn({
        ...options,
        config: { ...config, model: replacementModel },
        _retriedReplacement: true,
      });
    }
    throw formattedErr;
  }
}
