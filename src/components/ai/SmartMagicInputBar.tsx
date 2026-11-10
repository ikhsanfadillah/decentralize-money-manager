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
import {
  compressImageFileToDataUrl,
  parseSmartTransactionInput,
} from "../../lib/ai-provider";
import type {
  AccountView,
  AddTransactionInput,
  CategoryView,
} from "../../lib/tauri-api";
import { formatDateShort } from "../../lib/date";
import { pushToast } from "../../lib/toast";
import { formatSignedRupiah } from "../../lib/utils";
import {
  resolveActiveAiConfig,
  toAddTransactionInputFromDraft,
  useAiStore,
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
}

export const SmartMagicInputBar: React.FC<SmartMagicInputBarProps> = ({
  accounts,
  categories,
  onApplySingleDraft,
  onSaveMultipleDrafts,
  onQuickCreateCategory,
}) => {
  const byok = useAiStore((s) => s.byok);
  const setByokSettingsDrawerOpen = useAiStore(
    (s) => s.setByokSettingsDrawerOpen
  );
  const activeConfig = React.useMemo(() => resolveActiveAiConfig(byok), [byok]);

  const [prompt, setPrompt] = React.useState("");
  const [imageDataUrl, setImageDataUrl] = React.useState<string | null>(null);
  const [imageName, setImageName] = React.useState<string>("");
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

  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      pushToast("Pilih file gambar (JPG, PNG, WebP)", { variant: "warning" });
      return;
    }
    try {
      const dataUrl = await compressImageFileToDataUrl(file);
      setImageDataUrl(dataUrl);
      setImageName(file.name);
    } catch (err: unknown) {
      pushToast(
        err instanceof Error ? err.message : "Gagal memproses foto struk",
        { variant: "error" }
      );
    } finally {
      e.target.value = "";
    }
  };

  const handleParse = async () => {
    if (!activeConfig.isConfigured) {
      pushToast("Atur API Key AI terlebih dahulu", {
        description:
          "Masukkan API Key pribadi Anda (Gemini, OpenAI, Groq, atau OpenRouter).",
        variant: "warning",
      });
      setByokSettingsDrawerOpen(true);
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
      setImageDataUrl(null);
    } finally {
      setIsSavingBatch(false);
    }
  };

  return (
    <div
      data-testid="smart-magic-input-bar"
      className="rounded-2xl border border-primary/35 bg-primary/[0.06] p-3 space-y-2.5"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <Sparkles className="h-3.5 w-3.5 text-primary shrink-0" />
          <span className="text-xs font-bold text-foreground">
            AI Smart Input &amp; Scan Struk
          </span>
          <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 font-mono text-[9px] font-semibold text-primary">
            {activeConfig.isConfigured
              ? activeConfig.providerLabel
              : "BYOK"}
          </span>
        </div>

        {!activeConfig.isConfigured && (
          <button
            type="button"
            data-testid="magic-input-setup-key-btn"
            onClick={() => setByokSettingsDrawerOpen(true)}
            className="inline-flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/15 px-2.5 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-300 hover:bg-amber-500/25"
          >
            <KeyRound className="h-3 w-3" />
            <span>Atur API Key</span>
          </button>
        )}
      </div>

      {/* Input Row: Natural Language + Photo Attachment + Parse Button */}
      <div className="flex items-center gap-1.5">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={(e) => void handleFileChange(e)}
          className="hidden"
          data-testid="magic-input-file-upload"
        />

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          title="Lampirkan Foto Struk / Bukti Transfer"
          aria-label="Lampirkan Foto Struk"
          disabled={isParsing}
          className={`nav-touch-item inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border transition-colors ${
            imageDataUrl
              ? "border-primary bg-primary/20 text-primary"
              : "border-border bg-background/80 text-muted-foreground hover:text-foreground"
          }`}
        >
          <ImagePlus className="h-4 w-4" />
        </button>

        <input
          type="text"
          data-testid="magic-input-text"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void handleParse();
            }
          }}
          disabled={isParsing}
          placeholder="Contoh: Makan siang 45rb & kopi 22rb pakai GoPay..."
          className="h-9 flex-1 min-w-0 rounded-xl border border-border bg-background/80 px-3 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
        />

        <button
          type="button"
          data-testid="magic-input-submit-btn"
          disabled={isParsing || (!prompt.trim() && !imageDataUrl)}
          onClick={() => void handleParse()}
          className="nav-touch-item inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl bg-cta-surface px-3 text-xs font-bold text-cta-foreground hover:opacity-90 disabled:opacity-50"
        >
          {isParsing ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span>Proses...</span>
            </>
          ) : (
            <>
              <Sparkles className="h-3.5 w-3.5" />
              <span>Isi</span>
            </>
          )}
        </button>
      </div>

      {/* Attached Receipt Thumbnail Preview */}
      {imageDataUrl && (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-border/80 bg-background/70 px-2.5 py-1.5 text-[11px]">
          <div className="flex items-center gap-2 min-w-0">
            <img
              src={imageDataUrl}
              alt="Preview Struk"
              className="h-7 w-7 rounded-md object-cover border border-border shrink-0"
            />
            <span className="truncate font-medium text-foreground">
              {imageName || "Foto Struk Terlampir"}
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              setImageDataUrl(null);
              setImageName("");
            }}
            className="inline-flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Hapus foto struk"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

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
          className="rounded-xl border border-border bg-background/90 p-2.5 space-y-2"
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

          <div className="max-h-44 overflow-y-auto divide-y divide-border/60">
            {multiDrafts.map((item) => (
              <div
                key={item.id}
                className="flex items-center justify-between gap-2 py-1.5 text-xs"
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
            className="nav-touch-item flex w-full items-center justify-center gap-1.5 rounded-full bg-cta-surface py-2 text-xs font-bold text-cta-foreground hover:opacity-90 disabled:opacity-50"
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

