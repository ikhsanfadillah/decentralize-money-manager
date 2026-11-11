import type {
  AccountView,
  CategoryView,
  TransactionType,
} from "../../tauri-api";
import { todayIsoDate } from "../../utils";
import { callSinglePromptLlm } from "../client";
import { matchAccountByName, matchCategoryByName } from "../matchers";
import { parseDataUrlToImagePayload } from "../media";
import { buildSmartTransactionSystemPrompt } from "../prompts";
import {
  extractJsonFromLlmText,
  parseSmartTransactionItemsFromJson,
} from "../schemas";
import type {
  ActiveAiConnectionConfig,
  ModelFallbackHandler,
  ProposedTransactionDraft,
} from "../types";

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
  onModelFallback?: ModelFallbackHandler;
}): Promise<ProposedTransactionDraft[]> {
  const {
    config,
    prompt,
    imageDataUrl,
    accounts,
    categories,
    todayDate = todayIsoDate(),
    onModelFallback,
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

  const systemPrompt = buildSmartTransactionSystemPrompt({
    todayDate,
    activeAccounts,
    activeExpenseCats,
    activeIncomeCats,
  });

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
    onModelFallback,
  });

  const parsed = extractJsonFromLlmText(rawReply);
  const items = parseSmartTransactionItemsFromJson(parsed);

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

