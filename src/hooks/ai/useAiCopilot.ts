import * as React from "react";
import {
  parseDataUrlToImagePayload,
  runCopilotAgentTurn,
} from "../../lib/ai-provider";
import { pushToast } from "../../lib/toast";
import { formatRupiah, formatSignedRupiah } from "../../lib/utils";
import {
  toAddTransactionInputFromDraft,
  toUpsertBudgetInputFromDraft,
  useAiStore,
  type ActiveAiConnectionConfig,
  type CopilotChatMessage,
  type ProposedBudgetDraft,
  type ProposedTransactionDraft,
} from "../../stores/ai-store";
import { useBookFinance } from "../useBookFinance";
import type { AttachedAiImage } from "./useAiImageAttachment";

const EMPTY_CHAT_MESSAGES: CopilotChatMessage[] = [];

export interface UseAiCopilotParams {
  bookId: string;
  bookName?: string;
  activeConfig: ActiveAiConnectionConfig;
  ensureConfigured: () => boolean;
}

export function useAiCopilot({
  bookId,
  bookName,
  activeConfig,
  ensureConfigured,
}: UseAiCopilotParams) {
  const messages = useAiStore(
    (s) => s.chatByBook[bookId] ?? EMPTY_CHAT_MESSAGES
  );
  const appendChatMessage = useAiStore((s) => s.appendChatMessage);
  const updateChatMessage = useAiStore((s) => s.updateChatMessage);
  const clearBookChat = useAiStore((s) => s.clearBookChat);

  const {
    addTransactionMutation,
    upsertCategoryMutation,
    upsertBudgetMutation,
  } = useBookFinance({ bookId, enableTransactionsQuery: false });

  const [isSending, setIsSending] = React.useState(false);
  const [liveToolStep, setLiveToolStep] = React.useState<string | null>(null);
  const [applyingItemId, setApplyingItemId] = React.useState<string | null>(
    null
  );

  const sendTurn = React.useCallback(
    async (params: {
      text: string;
      attachment?: AttachedAiImage | null;
      onInputConsumed?: () => void;
    }) => {
      const trimmedText = params.text.trim();
      const currentAttachment = params.attachment ?? null;
      if ((!trimmedText && !currentAttachment) || isSending) return;

      if (!ensureConfigured()) {
        return;
      }

      params.onInputConsumed?.();

      const userMsgId = `user-${Date.now()}`;
      appendChatMessage(bookId, {
        id: userMsgId,
        role: "user",
        content:
          trimmedText ||
          (currentAttachment
            ? "Tolong periksa dan ekstrak data transaksi dari foto struk ini."
            : ""),
        imageAttachment: currentAttachment ?? undefined,
        createdAt: new Date().toISOString(),
      });

      setIsSending(true);
      setLiveToolStep("Menghubungi AI Agent...");

      try {
        const imagePayload = currentAttachment
          ? parseDataUrlToImagePayload(currentAttachment.dataUrl)
          : null;

        const turnResult = await runCopilotAgentTurn({
          config: activeConfig,
          bookId,
          bookName,
          history: messages,
          userMessage: trimmedText,
          image: imagePayload,
          onToolStep: (step) => setLiveToolStep(step),
        });

        appendChatMessage(bookId, {
          id: `assistant-${Date.now()}`,
          role: "assistant",
          content: turnResult.replyText,
          createdAt: new Date().toISOString(),
          toolSteps: turnResult.toolSteps,
          proposedTransactions: turnResult.proposedTransactions,
          proposedBudgets: turnResult.proposedBudgets,
        });
      } catch (err: unknown) {
        const msg =
          err instanceof Error
            ? err.message
            : "Terjadi kendala saat menghubungi AI Agent.";
        appendChatMessage(bookId, {
          id: `assistant-err-${Date.now()}`,
          role: "assistant",
          content: msg,
          createdAt: new Date().toISOString(),
          isError: true,
        });
      } finally {
        setIsSending(false);
        setLiveToolStep(null);
      }
    },
    [
      activeConfig,
      appendChatMessage,
      bookId,
      bookName,
      ensureConfigured,
      isSending,
      messages,
    ]
  );

  const handleApplyProposedTx = React.useCallback(
    async (msgId: string, draft: ProposedTransactionDraft) => {
      if (draft.applied || applyingItemId) return;
      setApplyingItemId(draft.id);
      try {
        let categoryIdToUse = draft.category_id ?? null;
        if (
          draft.suggested_new_category &&
          (draft.tx_type === "EXPENSE" || draft.tx_type === "INCOME")
        ) {
          const createdCat = await upsertCategoryMutation.mutateAsync({
            id: null,
            name: draft.suggested_new_category,
            kind: draft.tx_type,
          });
          categoryIdToUse = createdCat.id;
        }

        const txInput = toAddTransactionInputFromDraft({
          ...draft,
          category_id: categoryIdToUse,
        });
        await addTransactionMutation.mutateAsync(txInput);

        updateChatMessage(bookId, msgId, (prev) => ({
          ...prev,
          proposedTransactions: (prev.proposedTransactions ?? []).map((t) =>
            t.id === draft.id ? { ...t, applied: true } : t
          ),
        }));

        pushToast("Transaksi berhasil dicatat", {
          description: `${draft.note} (${formatSignedRupiah(draft.amount, draft.tx_type)})`,
          variant: "success",
        });
      } catch (err: unknown) {
        pushToast(
          err instanceof Error ? err.message : "Gagal mencatat transaksi",
          { variant: "error" }
        );
      } finally {
        setApplyingItemId(null);
      }
    },
    [
      addTransactionMutation,
      applyingItemId,
      bookId,
      updateChatMessage,
      upsertCategoryMutation,
    ]
  );

  const handleApplyProposedBudget = React.useCallback(
    async (msgId: string, draft: ProposedBudgetDraft) => {
      if (draft.applied || applyingItemId) return;
      setApplyingItemId(draft.id);
      try {
        await upsertBudgetMutation.mutateAsync(
          toUpsertBudgetInputFromDraft(draft)
        );

        updateChatMessage(bookId, msgId, (prev) => ({
          ...prev,
          proposedBudgets: (prev.proposedBudgets ?? []).map((b) =>
            b.id === draft.id ? { ...b, applied: true } : b
          ),
        }));

        pushToast(`Anggaran "${draft.category_name}" berhasil diterapkan`, {
          description: `Batas bulanan diatur ke ${formatRupiah(draft.amount_limit)}.`,
          variant: "success",
        });
      } catch (err: unknown) {
        pushToast(
          err instanceof Error ? err.message : "Gagal menyimpan anggaran",
          { variant: "error" }
        );
      } finally {
        setApplyingItemId(null);
      }
    },
    [applyingItemId, bookId, updateChatMessage, upsertBudgetMutation]
  );

  return {
    messages,
    isSending,
    liveToolStep,
    applyingItemId,
    clearBookChat,
    sendTurn,
    handleApplyProposedTx,
    handleApplyProposedBudget,
  };
}

