import * as React from "react";
import {
  Check,
  ImagePlus,
  KeyRound,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { useAiConfig, useAiImageAttachment } from "../../hooks/ai";
import { parseSmartTransactionInput } from "../../lib/ai-provider";
import { formatDateShort } from "../../lib/date";
import type {
  AccountView,
  AddTransactionInput,
  CategoryView,
} from "../../lib/tauri-api";
import { pushToast } from "../../lib/toast";
import { formatSignedRupiah } from "../../lib/utils";
import {
  toAddTransactionInputFromDraft,
  type ProposedTransactionDraft,
} from "../../stores/ai-store";

export interface SmartMagicInputBarProps {
  bookId: string;
  accounts: AccountView[];
  categories: CategoryView[];
  onApplySingleDraft: (draft: ProposedTransactionDraft) => void;
  onSaveMultipleDrafts: (inputs: AddTransactionInput[]) => Promise<void>;
  onQuickCreateCategory?: (
    name: string,
    kind: "EXPENSE" | "INCOME"
  ) => Promise<string | null>;
  onCloseAiMode?: () => void;
}

const QUICK_PROMPT_EXAMPLES = [
  "Makan siang 45rb pakai GoPay",
  "Kopi 22rb & parkir 3rb tunai",
  "Gaji bulanan 8,5jt ke BCA",
];

export const SmartMagicInputBar: React.FC<SmartMagicInputBarProps> = ({
  accounts,
  categories,
  onApplySingleDraft,
  onSaveMultipleDrafts,
  onQuickCreateCategory,
  onCloseAiMode,
}) => {
  const { activeConfig, ensureConfigured, openByokSettings } = useAiConfig();
  const {
    attachedImage,
    fileInputRef,
    handleFileChange,
    clearAttachment,
    openFilePicker,
  } = useAiImageAttachment({
    invalidTypeTitle: "Pilih file gambar (JPG, PNG, WebP)",
  });

  const [prompt, setPrompt] = React.useState("");
  const [isParsing, setIsParsing] = React.useState(false);
  const [isSavingBatch, setIsSavingBatch] = React.useState(false);
  const [multiDrafts, setMultiDrafts] = React.useState<
    ProposedTransactionDraft[]
  >([]);
  const [suggestedCategory, setSuggestedCategory] = React.useState<{
    name: string;
    kind: "EXPENSE" | "INCOME";
  } | null>(null);
  const [isCreatingSuggestedCat, setIsCreatingSuggestedCat] =
    React.useState(false);

  const imageDataUrl = attachedImage?.dataUrl ?? null;
  const imageName = attachedImage?.fileName ?? "";

  const handleParse = async () => {
    if (!ensureConfigured()) {
      return;
    }

    if (!prompt.trim() && !imageDataUrl) {
      pushToast("Ketik kalimat transaksi atau lampirkan foto struk", {
        variant: "warning",
      });
      return;
    }

    setIsParsing(true);
    setSuggestedCategory(null);
    setMultiDrafts([]);

    try {
      const drafts = await parseSmartTransactionInput({
        config: activeConfig,
        prompt,
        imageDataUrl,
        accounts,
        categories,
      });

      if (drafts.length === 1) {
        const single = drafts[0];
        onApplySingleDraft(single);
        if (
          single.suggested_new_category &&
          (single.tx_type === "EXPENSE" || single.tx_type === "INCOME")
        ) {
          setSuggestedCategory({
            name: single.suggested_new_category,
            kind: single.tx_type,
          });
        }
        pushToast("Form otomatis diisi oleh AI", {
          description: `${single.note} (${formatSignedRupiah(single.amount, single.tx_type)})`,
          variant: "success",
        });
        onCloseAiMode?.();
      } else {
        setMultiDrafts(drafts);
        pushToast(`${drafts.length} transaksi berhasil diekstrak`, {
          description: "Tinjau daftar di bawah lalu simpan sekaligus.",
          variant: "success",
        });
      }
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Gagal mengekstrak transaksi";
      pushToast("Ekstraksi AI gagal", {
        description: msg,
        variant: "error",
      });
    } finally {
      setIsParsing(false);
    }
  };

  const handleCreateSuggestedCategory = async () => {
    if (!suggestedCategory || !onQuickCreateCategory) return;
    setIsCreatingSuggestedCat(true);
    try {
      const createdId = await onQuickCreateCategory(
        suggestedCategory.name,
        suggestedCategory.kind
      );
      if (createdId) {
        setSuggestedCategory(null);
      }
    } finally {
      setIsCreatingSuggestedCat(false);
    }
  };

  const handleSaveBatch = async () => {
    if (multiDrafts.length === 0 || isSavingBatch) return;
    setIsSavingBatch(true);
    try {
      const inputs = multiDrafts.map(toAddTransactionInputFromDraft);
      await onSaveMultipleDrafts(inputs);
      setMultiDrafts([]);
      setPrompt("");
      clearAttachment();
    } finally {
      setIsSavingBatch(false);
    }
  };

  return (
    <div
      data-testid="smart-magic-input-bar"
      className="rounded-2xl border border-border bg-card p-4 space-y-3.5"
    >
      {/* Header Row: Title + Provider / BYOK Action */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-primary/30 bg-primary/10 text-primary">
            <Sparkles className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs font-bold text-foreground">
                AI Smart Input &amp; Scan Struk
              </span>
              <button
                type="button"
                onClick={openByokSettings}
                title="Pengaturan Provider & API Key AI"
                className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 font-mono text-[9px] font-semibold text-primary hover:bg-primary/20 transition-colors"
              >
                {activeConfig.isConfigured ? activeConfig.providerLabel : "BYOK"}
              </button>
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Ketik kalimat bebas atau unggah foto struk belanja Anda.
            </p>
          </div>
        </div>

        {!activeConfig.isConfigured && (
          <button
            type="button"
            data-testid="magic-input-setup-key-btn"
            onClick={openByokSettings}
            className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/15 px-2.5 py-1 text-[10px] font-semibold text-amber-600 dark:text-amber-300 hover:bg-amber-500/25"
          >
            <KeyRound className="h-3 w-3" />
            <span>Atur API Key</span>
          </button>
        )}
      </div>

      {/* Spacious Multiline Natural Language Input */}
      <div className="space-y-2">
        <div className="relative">
          <textarea
            rows={3}
            data-testid="magic-input-text"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleParse();
              }
            }}
            disabled={isParsing}
            placeholder="Contoh: Makan siang 45rb & kopi 22rb pakai GoPay..."
            className="w-full resize-none rounded-xl border border-border bg-background/90 p-3 text-xs leading-relaxed text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
          />
          {prompt && !isParsing && (
            <button
              type="button"
              onClick={() => setPrompt("")}
              aria-label="Bersihkan teks"
              className="absolute right-2.5 top-2.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-muted/80 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Quick Example Chips */}
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
          <span className="text-[10px] font-medium text-muted-foreground shrink-0">
            Contoh:
          </span>
          {QUICK_PROMPT_EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              disabled={isParsing}
              onClick={() => setPrompt(example)}
              className="nav-touch-item shrink-0 rounded-full border border-border/80 bg-background/70 px-2.5 py-1 text-[10px] font-medium text-muted-foreground hover:border-primary/40 hover:text-foreground transition-colors"
            >
              {example}
            </button>
          ))}
        </div>
      </div>

      {/* Receipt / Struk Attachment Section */}
      <div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={(e) => void handleFileChange(e)}
          className="hidden"
          data-testid="magic-input-file-upload"
        />

        {imageDataUrl ? (
          <div className="flex items-center justify-between gap-2.5 rounded-xl border border-primary/35 bg-primary/5 p-2.5 text-xs">
            <div className="flex items-center gap-2.5 min-w-0">
              <img
                src={imageDataUrl}
                alt="Preview Struk"
                className="h-10 w-10 rounded-lg object-cover border border-border shrink-0"
              />
              <div className="min-w-0">
                <p className="truncate font-semibold text-foreground text-xs">
                  {imageName || "Foto Struk Terlampir"}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  Siap dipindai oleh AI Vision
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={openFilePicker}
                disabled={isParsing}
                className="rounded-lg border border-border bg-background px-2.5 py-1 text-[10px] font-semibold text-foreground hover:bg-muted"
              >
                Ganti
              </button>
              <button
                type="button"
                onClick={clearAttachment}
                disabled={isParsing}
                className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-rose-500"
                aria-label="Hapus foto struk"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={openFilePicker}
            title="Lampirkan Foto Struk / Bukti Transfer"
            aria-label="Lampirkan Foto Struk"
            disabled={isParsing}
            className="nav-touch-item flex w-full items-center justify-between gap-3 rounded-xl border border-dashed border-border bg-background/60 px-3.5 py-2.5 text-left hover:border-primary/40 hover:bg-background/90 transition-colors"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-black/[0.04] dark:bg-white/[0.06] text-foreground">
                <ImagePlus className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-foreground">
                  Scan Foto Struk / Bukti Transfer
                </p>
                <p className="truncate text-[10px] text-muted-foreground">
                  Pilih foto JPG, PNG, atau WebP untuk diekstrak otomatis
                </p>
              </div>
            </div>
            <span className="shrink-0 rounded-full border border-border bg-card px-2.5 py-1 text-[10px] font-semibold text-foreground">
              Pilih Foto
            </span>
          </button>
        )}
      </div>

      {/* Primary Parse / Auto-Fill CTA Button */}
      <button
        type="button"
        data-testid="magic-input-submit-btn"
        disabled={isParsing || (!prompt.trim() && !imageDataUrl)}
        onClick={() => void handleParse()}
        className="nav-touch-item flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-cta-surface px-4 text-xs font-bold text-cta-foreground hover:opacity-90 disabled:opacity-40 transition-opacity"
      >
        {isParsing ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Mengekstrak Transaksi...</span>
          </>
        ) : (
          <>
            <Sparkles className="h-4 w-4" />
            <span>Proses &amp; Isi Otomatis</span>
          </>
        )}
      </button>

      {/* Quick Create Suggested Category Chip */}
      {suggestedCategory && onQuickCreateCategory && (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-primary/30 bg-background/70 px-3 py-1.5 text-[11px]">
          <span className="text-muted-foreground">
            Kategori disarankan AI:{" "}
            <strong className="text-foreground">
              {suggestedCategory.name}
            </strong>
          </span>
          <button
            type="button"
            disabled={isCreatingSuggestedCat}
            onClick={() => void handleCreateSuggestedCategory()}
            className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2.5 py-1 font-semibold text-primary hover:bg-primary/25 disabled:opacity-50"
          >
            <Plus className="h-3 w-3" />
            <span>
              {isCreatingSuggestedCat ? "Membuat..." : "Buat & Pilih"}
            </span>
          </button>
        </div>
      )}

      {/* Multi-Transaction Draft Review List */}
      {multiDrafts.length > 1 && (
        <div
          data-testid="magic-multi-drafts-list"
          className="rounded-xl border border-border bg-background/90 p-3 space-y-2.5"
        >
          <div className="flex items-center justify-between text-[11px]">
            <span className="font-semibold text-foreground">
              Draf Multi-Transaksi ({multiDrafts.length} item)
            </span>
            <button
              type="button"
              onClick={() => setMultiDrafts([])}
              className="text-muted-foreground hover:text-foreground"
            >
              Batal
            </button>
          </div>

          <div className="max-h-48 overflow-y-auto divide-y divide-border/60">
            {multiDrafts.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between gap-2 py-2 text-xs"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-foreground">
                    {item.note}
                  </p>
                  <p className="truncate text-[10px] text-muted-foreground">
                    {item.account_name} · {item.category_name ?? "Transfer"} ·{" "}
                    {formatDateShort(item.tx_date)}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span
                    className={`font-mono text-xs font-bold tabular-nums ${
                      item.tx_type === "INCOME"
                        ? "text-emerald-500"
                        : "text-rose-500"
                    }`}
                  >
                    {formatSignedRupiah(item.amount, item.tx_type)}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setMultiDrafts((prev) =>
                        prev.filter((d) => d.id !== item.id)
                      )
                    }
                    className="rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-rose-500"
                    aria-label="Hapus item draf"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <button
            type="button"
            data-testid="magic-save-all-btn"
            disabled={isSavingBatch}
            onClick={() => void handleSaveBatch()}
            className="nav-touch-item flex w-full items-center justify-center gap-1.5 rounded-full bg-cta-surface py-2.5 text-xs font-bold text-cta-foreground hover:opacity-90 disabled:opacity-50"
          >
            {isSavingBatch ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>Menyimpan {multiDrafts.length} Transaksi...</span>
              </>
            ) : (
              <>
                <Check className="h-3.5 w-3.5" />
                <span>Simpan Semua ({multiDrafts.length} Transaksi)</span>
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
};
