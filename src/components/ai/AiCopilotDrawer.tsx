import * as React from "react";
import {
  Bot,
  Check,
  KeyRound,
  Loader2,
  Paperclip,
  Send,
  Settings2,
  Sparkles,
  Target,
  Trash2,
  User,
  X,
} from "lucide-react";
import { useBookFinance } from "../../hooks/useBookFinance";
import {
  compressImageFileToDataUrl,
  parseDataUrlToImagePayload,
  runCopilotAgentTurn,
} from "../../lib/ai-provider";
import { formatDateShort } from "../../lib/date";
import { pushToast } from "../../lib/toast";
import { formatRupiah, formatSignedRupiah } from "../../lib/utils";
import {
  resolveActiveAiConfig,
  toAddTransactionInputFromDraft,
  toUpsertBudgetInputFromDraft,
  useAiStore,
  type CopilotChatMessage,
  type ProposedBudgetDraft,
  type ProposedTransactionDraft,
} from "../../stores/ai-store";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "../ui/drawer";

export interface AiCopilotDrawerProps {
  bookId: string;
  bookName?: string;
}

const EMPTY_CHAT_MESSAGES: CopilotChatMessage[] = [];

const STARTER_PROMPTS = [
  "Analisis pengeluaran bulan ini & apa kategori terbesarnya?",
  "Berapa total saldo di semua rekening saat ini?",
  "5 pengeluaran terbesar bulan ini apa saja?",
  "Tolong rekomendasikan target anggaran bulan ini",
];

export const AiCopilotDrawer: React.FC<AiCopilotDrawerProps> = ({
  bookId,
  bookName,
}) => {
  const isOpen = useAiStore((s) => s.isCopilotOpen);
  const setOpen = useAiStore((s) => s.setCopilotOpen);
  const byok = useAiStore((s) => s.byok);
  const setByokSettingsDrawerOpen = useAiStore(
    (s) => s.setByokSettingsDrawerOpen
  );
  const messages = useAiStore(
    (s) => s.chatByBook[bookId] ?? EMPTY_CHAT_MESSAGES
  );
  const appendChatMessage = useAiStore((s) => s.appendChatMessage);
  const updateChatMessage = useAiStore((s) => s.updateChatMessage);
  const clearBookChat = useAiStore((s) => s.clearBookChat);

  const activeConfig = React.useMemo(() => resolveActiveAiConfig(byok), [byok]);

  const {
    addTransactionMutation,
    upsertCategoryMutation,
    upsertBudgetMutation,
  } = useBookFinance({ bookId, enableTransactionsQuery: false });

  const [input, setInput] = React.useState("");
  const [attachedImage, setAttachedImage] = React.useState<{
    dataUrl: string;
    fileName: string;
  } | null>(null);
  const [isSending, setIsSending] = React.useState(false);
  const [liveToolStep, setLiveToolStep] = React.useState<string | null>(null);
  const [applyingItemId, setApplyingItemId] = React.useState<string | null>(
    null
  );

  const scrollContainerRef = React.useRef<HTMLDivElement | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop =
        scrollContainerRef.current.scrollHeight;
    }
  }, [messages.length, isSending, liveToolStep]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      pushToast("Pilih file gambar", {
        description: "Format yang didukung: JPG, PNG, WEBP, HEIC.",
        variant: "warning",
      });
      return;
    }
    try {
      const dataUrl = await compressImageFileToDataUrl(file);
      setAttachedImage({
        dataUrl,
        fileName: file.name,
      });
    } catch (err: unknown) {
      pushToast("Gagal memproses gambar", {
        description:
          err instanceof Error ? err.message : "Coba pilih file lain.",
        variant: "error",
      });
    } finally {
      e.target.value = "";
    }
  };

  const handleSend = async (customPrompt?: string) => {
    const text = (customPrompt ?? input).trim();
    const currentAttachment = attachedImage;
    if ((!text && !currentAttachment) || isSending) return;

    if (!activeConfig.isConfigured) {
      pushToast("Atur API Key AI terlebih dahulu", {
        description:
          "Masukkan API Key pribadi Anda (Gemini, OpenAI, Groq, atau OpenRouter).",
        variant: "warning",
      });
      setByokSettingsDrawerOpen(true);
      return;
    }

    if (!customPrompt) {
      setInput("");
      setAttachedImage(null);
    }

    const userMsgId = `user-${Date.now()}`;
    appendChatMessage(bookId, {
      id: userMsgId,
      role: "user",
      content:
        text ||
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
        userMessage: text,
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
  };

  const handleApplyProposedTx = async (
    msgId: string,
    draft: ProposedTransactionDraft
  ) => {
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
  };

  const handleApplyProposedBudget = async (
    msgId: string,
    draft: ProposedBudgetDraft
  ) => {
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
  };

  return (
    <Drawer
      open={isOpen}
      onOpenChange={(open) => setOpen(open)}
      shouldScaleBackground={false}
    >
      <DrawerContent
        aria-describedby="ai-copilot-drawer-desc"
        className="h-screen max-h-screen w-full p-0 sm:mx-auto sm:max-w-xl"
      >
        {/* Header */}
        <DrawerHeader className="flex flex-row items-center justify-between border-b border-border/70 px-5 py-3.5 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-primary/40 bg-primary/15 text-primary">
              <Sparkles className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <DrawerTitle className="truncate text-sm font-bold text-foreground">
                  Financial Co-Pilot
                </DrawerTitle>
                <span className="rounded-full border border-border bg-black/[0.04] px-2 py-0.5 font-mono text-[10px] font-semibold text-muted-foreground dark:bg-white/[0.06]">
                  {activeConfig.isConfigured
                    ? `${activeConfig.providerLabel} · ${activeConfig.model}`
                    : "BYOK"}
                </span>
              </div>
              <DrawerDescription
                id="ai-copilot-drawer-desc"
                className="truncate text-xs text-muted-foreground"
              >
                Asisten pintar buku {bookName || "Keuangan"} (data lokal &amp;
                aman)
              </DrawerDescription>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setByokSettingsDrawerOpen(true)}
              title="Pengaturan API Key (BYOK)"
              aria-label="Pengaturan API Key"
              className="nav-touch-item inline-flex h-8 w-8 items-center justify-center rounded-full border border-border bg-black/[0.04] text-muted-foreground hover:bg-muted hover:text-foreground dark:bg-white/[0.06]"
            >
              <Settings2 className="h-4 w-4" />
            </button>
            {messages.length > 0 && (
              <button
                type="button"
                onClick={() => clearBookChat(bookId)}
                title="Bersihkan Riwayat Chat"
                aria-label="Bersihkan Riwayat Chat"
                className="nav-touch-item inline-flex h-8 w-8 items-center justify-center rounded-full border border-border bg-black/[0.04] text-muted-foreground hover:bg-muted hover:text-rose-500 dark:bg-white/[0.06]"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Tutup Co-Pilot"
              className="nav-touch-item inline-flex h-8 w-8 items-center justify-center rounded-full border border-border bg-black/[0.04] text-muted-foreground hover:bg-muted hover:text-foreground dark:bg-white/[0.06]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </DrawerHeader>

        {/* Unconfigured API Key Banner */}
        {!activeConfig.isConfigured && (
          <div className="mx-5 mt-3 flex items-center justify-between gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 px-3.5 py-2.5 text-xs">
            <div className="min-w-0">
              <p className="font-semibold text-amber-600 dark:text-amber-300">
                API Key BYOK Belum Diatur
              </p>
              <p className="text-[11px] text-muted-foreground">
                Pasang kunci API Google Gemini, OpenAI, Groq, atau OpenRouter
                Anda terlebih dahulu.
              </p>
            </div>
            <button
              type="button"
              data-testid="copilot-setup-key-btn"
              onClick={() => setByokSettingsDrawerOpen(true)}
              className="nav-touch-item shrink-0 inline-flex items-center gap-1.5 rounded-full bg-cta-surface px-3 py-1.5 text-xs font-bold text-cta-foreground"
            >
              <KeyRound className="h-3.5 w-3.5" />
              <span>Atur Key</span>
            </button>
          </div>
        )}

        {/* Messages Stream */}
        <div
          ref={scrollContainerRef}
          className="flex-1 overflow-y-auto overscroll-contain px-5 py-4 space-y-4"
        >
          {messages.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-6 text-center space-y-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-3xl border border-primary/35 bg-primary/10 text-primary">
                <Bot className="h-6 w-6" />
              </div>
              <div className="max-w-sm space-y-1">
                <p className="text-sm font-bold text-foreground">
                  Tanyakan Apa Saja Tentang Keuangan Buku Ini
                </p>
                <p className="text-xs text-muted-foreground">
                  AI Co-Pilot dapat memeriksa saldo, mencari transaksi,
                  menganalisis laporan bulanan, hingga membuatkan draf transaksi
                  dan anggaran untuk Anda.
                </p>
              </div>

              <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2 pt-2">
                {STARTER_PROMPTS.map((q) => (
                  <button
                    key={q}
                    type="button"
                    disabled={isSending}
                    onClick={() => void handleSend(q)}
                    className="nav-touch-item rounded-2xl border border-border bg-black/[0.03] px-3.5 py-2.5 text-left text-xs font-medium text-foreground transition-colors hover:border-primary/40 hover:bg-primary/[0.06] dark:bg-white/[0.04]"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((msg) => {
              const isUser = msg.role === "user";
              return (
                <div
                  key={msg.id}
                  className={`flex flex-col gap-2 ${
                    isUser ? "items-end" : "items-start"
                  }`}
                >
                  <div className="flex items-start gap-2.5 max-w-[92%]">
                    {!isUser && (
                      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-primary/35 bg-primary/10 text-primary">
                        <Bot className="h-3.5 w-3.5" />
                      </div>
                    )}

                    <div className="space-y-2 min-w-0">
                      {/* Tool Execution Trail Badges */}
                      {!isUser &&
                        msg.toolSteps &&
                        msg.toolSteps.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {msg.toolSteps.map((step, idx) => (
                              <span
                                key={idx}
                                className="inline-flex items-center gap-1 rounded-full border border-border bg-black/[0.03] px-2 py-0.5 font-mono text-[10px] text-muted-foreground dark:bg-white/[0.05]"
                              >
                                <Check className="h-2.5 w-2.5 text-emerald-500" />
                                <span>{step}</span>
                              </span>
                            ))}
                          </div>
                        )}

                      {/* Message Bubble */}
                      <div
                        className={`rounded-2xl px-3.5 py-2.5 text-xs leading-relaxed whitespace-pre-wrap ${
                          isUser
                            ? "bg-cta-surface text-cta-foreground font-medium"
                            : msg.isError
                              ? "border border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-300"
                              : "border border-border bg-black/[0.03] text-foreground dark:bg-white/[0.05]"
                        }`}
                      >
                        {msg.imageAttachment && (
                          <div className="mb-2 overflow-hidden rounded-xl border border-black/10 dark:border-white/10 max-w-[220px]">
                            <img
                              src={msg.imageAttachment.dataUrl}
                              alt={
                                msg.imageAttachment.fileName ||
                                "Foto struk terlampir"
                              }
                              className="h-auto max-h-48 w-full object-cover"
                            />
                          </div>
                        )}
                        {msg.content}
                      </div>

                      {/* HITL Proposed Transactions Cards */}
                      {msg.proposedTransactions &&
                        msg.proposedTransactions.length > 0 && (
                          <div className="space-y-2 pt-1">
                            {msg.proposedTransactions.map((tx) => (
                              <div
                                key={tx.id}
                                className="flex items-center justify-between gap-3 rounded-2xl border border-primary/35 bg-primary/[0.06] px-3.5 py-2.5 text-xs"
                              >
                                <div className="min-w-0 flex-1">
                                  <p className="truncate font-bold text-foreground">
                                    {tx.note}
                                  </p>
                                  <p className="truncate text-[11px] text-muted-foreground">
                                    {tx.account_name} ·{" "}
                                    {tx.category_name ?? "Transfer"} ·{" "}
                                    {formatDateShort(tx.tx_date)}
                                  </p>
                                  <p
                                    className={`mt-0.5 font-mono text-xs font-bold ${
                                      tx.tx_type === "INCOME"
                                        ? "text-emerald-500"
                                        : "text-rose-500"
                                    }`}
                                  >
                                    {formatSignedRupiah(tx.amount, tx.tx_type)}
                                  </p>
                                </div>

                                <button
                                  type="button"
                                  disabled={
                                    tx.applied || applyingItemId === tx.id
                                  }
                                  onClick={() =>
                                    void handleApplyProposedTx(msg.id, tx)
                                  }
                                  className={`nav-touch-item shrink-0 inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-bold ${
                                    tx.applied
                                      ? "border border-emerald-500/40 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                                      : "bg-cta-surface text-cta-foreground hover:opacity-90"
                                  }`}
                                >
                                  {tx.applied ? (
                                    <>
                                      <Check className="h-3.5 w-3.5" />
                                      <span>Tersimpan</span>
                                    </>
                                  ) : applyingItemId === tx.id ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <span>Simpan Transaksi</span>
                                  )}
                                </button>
                              </div>
                            ))}
                          </div>
                        )}

                      {/* HITL Proposed Budgets Cards */}
                      {msg.proposedBudgets &&
                        msg.proposedBudgets.length > 0 && (
                          <div className="space-y-2 pt-1">
                            {msg.proposedBudgets.map((b) => (
                              <div
                                key={b.id}
                                className="flex items-center justify-between gap-3 rounded-2xl border border-primary/35 bg-primary/[0.06] px-3.5 py-2.5 text-xs"
                              >
                                <div className="min-w-0 flex-1">
                                  <div className="flex items-center gap-1.5">
                                    <Target className="h-3.5 w-3.5 text-primary shrink-0" />
                                    <span className="truncate font-bold text-foreground">
                                      {b.category_name}
                                    </span>
                                  </div>
                                  <p className="mt-0.5 font-mono text-xs font-bold text-primary">
                                    Batas: {formatRupiah(b.amount_limit)} /bln
                                  </p>
                                  {b.reason && (
                                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                                      {b.reason}
                                    </p>
                                  )}
                                </div>

                                <button
                                  type="button"
                                  disabled={
                                    b.applied || applyingItemId === b.id
                                  }
                                  onClick={() =>
                                    void handleApplyProposedBudget(msg.id, b)
                                  }
                                  className={`nav-touch-item shrink-0 inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-xs font-bold ${
                                    b.applied
                                      ? "border border-emerald-500/40 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                                      : "bg-cta-surface text-cta-foreground hover:opacity-90"
                                  }`}
                                >
                                  {b.applied ? (
                                    <>
                                      <Check className="h-3.5 w-3.5" />
                                      <span>Diterapkan</span>
                                    </>
                                  ) : applyingItemId === b.id ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <span>Terapkan Anggaran</span>
                                  )}
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                    </div>

                    {isUser && (
                      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-black/[0.05] text-foreground dark:bg-white/[0.08]">
                        <User className="h-3.5 w-3.5" />
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}

          {/* Live Thinking / Tool Indicator */}
          {isSending && (
            <div className="flex items-center gap-2.5 text-xs text-muted-foreground">
              <div className="flex h-7 w-7 items-center justify-center rounded-full border border-primary/35 bg-primary/10 text-primary">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              </div>
              <span className="font-mono text-[11px]">
                {liveToolStep || "Memproses jawaban..."}
              </span>
            </div>
          )}
        </div>

        {/* Attached Image Preview Banner */}
        {attachedImage && (
          <div className="flex items-center justify-between gap-3 border-t border-border/70 bg-black/[0.02] px-4 py-2.5 text-xs dark:bg-white/[0.03]">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg border border-border shadow-xs">
                <img
                  src={attachedImage.dataUrl}
                  alt="Pratinjau lampiran"
                  className="h-full w-full object-cover"
                />
              </div>
              <div className="flex flex-col min-w-0">
                <span className="truncate font-medium text-foreground">
                  {attachedImage.fileName}
                </span>
                <span className="text-[10.5px] text-muted-foreground">
                  Foto struk/nota siap dianalisis
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setAttachedImage(null)}
              aria-label="Hapus lampiran"
              className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-black/10 hover:text-foreground dark:hover:bg-white/10"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {/* Input Composer Footer */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleSend();
          }}
          className="flex items-center gap-2 border-t border-border/70 p-3.5 sm:px-5 shrink-0"
        >
          <input
            type="file"
            ref={fileInputRef}
            accept="image/*"
            className="hidden"
            data-testid="copilot-file-input"
            onChange={handleFileChange}
          />
          <input
            type="text"
            data-testid="copilot-chat-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={isSending}
            placeholder={
              attachedImage
                ? "Tambahkan catatan instruksi (opsional)..."
                : "Tanya saldo, analisis pengeluaran, atau catat transaksi..."
            }
            className="h-10 flex-1 min-w-0 rounded-full border border-border bg-black/[0.03] px-4 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary dark:bg-white/[0.06]"
          />

          {/* Attachment Button (sebelah tombol send) */}
          <button
            type="button"
            data-testid="copilot-chat-attach-btn"
            onClick={() => fileInputRef.current?.click()}
            disabled={isSending}
            aria-label="Import gambar atau ambil foto"
            title="Import gambar atau ambil foto"
            className={`nav-touch-item inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border transition-colors ${
              attachedImage
                ? "border-primary bg-primary/10 text-primary"
                : "border-border bg-black/[0.03] text-muted-foreground hover:text-foreground dark:bg-white/[0.06]"
            }`}
          >
            <Paperclip className="h-4 w-4" />
          </button>

          {/* Send Button */}
          <button
            type="submit"
            data-testid="copilot-chat-send-btn"
            disabled={isSending || (!input.trim() && !attachedImage)}
            aria-label="Kirim pesan"
            className="nav-touch-item inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-cta-surface text-cta-foreground hover:opacity-90 disabled:opacity-50"
          >
            <Send className="h-4 w-4" />
          </button>
        </form>
      </DrawerContent>
    </Drawer>
  );
};
