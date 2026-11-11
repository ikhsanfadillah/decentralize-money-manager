import * as React from "react";
import {
  AlertCircle,
  ArrowLeftRight,
  Check,
  ChevronLeft,
  ChevronRight,
  ImagePlus,
  KeyRound,
  Layers,
  Loader2,
  Plus,
  Trash2,
  TrendingDown,
  TrendingUp,
  X,
} from "lucide-react";
import { useReducedMotion } from "motion/react";
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

export interface SmartMagicInputActionState {
  canSubmit: boolean;
  isParsing: boolean;
}

export interface SmartMagicInputBarHandle {
  submit: () => void;
}

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
  hideSubmitButton?: boolean;
  onActionStateChange?: (state: SmartMagicInputActionState) => void;
}

interface QuickPromptExample {
  id: string;
  text: string;
  kind: "EXPENSE" | "MULTI" | "INCOME" | "TRANSFER";
}

const QUICK_PROMPT_EXAMPLES: QuickPromptExample[] = [
  {
    id: "expense-lunch",
    text: "Makan siang 45rb pakai GoPay",
    kind: "EXPENSE",
  },
  {
    id: "expense-multi",
    text: "Kopi 22rb & parkir 3rb tunai",
    kind: "MULTI",
  },
  {
    id: "income-salary",
    text: "Gaji bulanan 8,5jt ke BCA",
    kind: "INCOME",
  },
  {
    id: "transfer-wallet",
    text: "Transfer 500rb dari BCA ke GoPay",
    kind: "TRANSFER",
  },
];

const renderQuickExampleIcon = (
  kind: QuickPromptExample["kind"],
  isSelected: boolean
) => {
  const iconClass = isSelected
    ? "h-3.5 w-3.5 shrink-0 text-cta-foreground"
    : kind === "INCOME"
      ? "h-3.5 w-3.5 shrink-0 text-emerald-700 dark:text-emerald-400"
      : kind === "TRANSFER"
        ? "h-3.5 w-3.5 shrink-0 text-sky-700 dark:text-sky-400"
        : kind === "MULTI"
          ? "h-3.5 w-3.5 shrink-0 text-amber-700 dark:text-amber-400"
          : "h-3.5 w-3.5 shrink-0 text-rose-700 dark:text-rose-400";

  switch (kind) {
    case "INCOME":
      return <TrendingUp className={iconClass} aria-hidden="true" />;
    case "TRANSFER":
      return <ArrowLeftRight className={iconClass} aria-hidden="true" />;
    case "MULTI":
      return <Layers className={iconClass} aria-hidden="true" />;
    case "EXPENSE":
    default:
      return <TrendingDown className={iconClass} aria-hidden="true" />;
  }
};

export const SmartMagicInputBar = React.forwardRef<
  SmartMagicInputBarHandle,
  SmartMagicInputBarProps
>(
  (
    {
      accounts,
      categories,
      onApplySingleDraft,
      onSaveMultipleDrafts,
      onQuickCreateCategory,
      onCloseAiMode,
      hideSubmitButton = false,
      onActionStateChange,
    },
    ref
  ) => {
    const shouldReduceMotion = useReducedMotion();
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
    const [parseError, setParseError] = React.useState<string | null>(null);
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

    const quickScrollRef = React.useRef<HTMLDivElement>(null);
    const dragStateRef = React.useRef<{
      pointerId: number;
      startX: number;
      startScrollLeft: number;
      didDrag: boolean;
    } | null>(null);
    const suppressNextClickRef = React.useRef(false);
    const stopDragListenersRef = React.useRef<(() => void) | null>(null);
    const [isDraggingExamples, setIsDraggingExamples] = React.useState(false);
    const [scrollBounds, setScrollBounds] = React.useState({
      canScrollLeft: false,
      canScrollRight: false,
    });

    const updateScrollBounds = React.useCallback(() => {
      const el = quickScrollRef.current;
      if (!el) return;
      const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth);
      const canLeft = el.scrollLeft > 2;
      const canRight = maxScroll - el.scrollLeft > 2;
      setScrollBounds((prev) =>
        prev.canScrollLeft === canLeft && prev.canScrollRight === canRight
          ? prev
          : { canScrollLeft: canLeft, canScrollRight: canRight }
      );
    }, []);

    React.useEffect(() => {
      updateScrollBounds();
      const rafId =
        typeof window !== "undefined" &&
        typeof window.requestAnimationFrame === "function"
          ? window.requestAnimationFrame(updateScrollBounds)
          : null;
      const el = quickScrollRef.current;
      let observer: ResizeObserver | null = null;
      if (el && typeof ResizeObserver !== "undefined") {
        observer = new ResizeObserver(updateScrollBounds);
        observer.observe(el);
      }
      return () => {
        if (rafId !== null) {
          window.cancelAnimationFrame(rafId);
        }
        observer?.disconnect();
      };
    }, [updateScrollBounds]);

    React.useEffect(() => {
      return () => {
        stopDragListenersRef.current?.();
        stopDragListenersRef.current = null;
      };
    }, []);

    const handleExamplesPointerDown = (
      e: React.PointerEvent<HTMLDivElement>
    ) => {
      if (e.pointerType !== "mouse" || e.button !== 0) return;
      const el = quickScrollRef.current;
      if (!el || el.scrollWidth <= el.clientWidth + 2) return;

      stopDragListenersRef.current?.();

      dragStateRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startScrollLeft: el.scrollLeft,
        didDrag: false,
      };

      const onPointerMove = (moveEvent: PointerEvent) => {
        const state = dragStateRef.current;
        if (!state || moveEvent.pointerId !== state.pointerId) return;
        const dx = moveEvent.clientX - state.startX;
        if (!state.didDrag && Math.abs(dx) > 6) {
          state.didDrag = true;
          setIsDraggingExamples(true);
        }
        if (state.didDrag) {
          el.scrollLeft = state.startScrollLeft - dx;
        }
      };

      const cleanup = () => {
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", finishPointerDrag);
        window.removeEventListener("pointercancel", finishPointerDrag);
        stopDragListenersRef.current = null;
      };

      const finishPointerDrag = (endEvent: PointerEvent) => {
        const state = dragStateRef.current;
        if (!state || endEvent.pointerId !== state.pointerId) return;
        if (state.didDrag) {
          suppressNextClickRef.current = true;
          window.setTimeout(() => {
            suppressNextClickRef.current = false;
          }, 0);
        }
        dragStateRef.current = null;
        setIsDraggingExamples(false);
        cleanup();
      };

      stopDragListenersRef.current = cleanup;
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", finishPointerDrag);
      window.addEventListener("pointercancel", finishPointerDrag);
    };

    const scrollExamplesBy = (direction: "left" | "right") => {
      const el = quickScrollRef.current;
      if (!el) return;
      const step = Math.max(180, Math.round(el.clientWidth * 0.72));
      const delta = direction === "left" ? -step : step;
      if (typeof el.scrollBy === "function") {
        el.scrollBy({
          left: delta,
          behavior: shouldReduceMotion ? "auto" : "smooth",
        });
      } else {
        el.scrollLeft += delta;
        updateScrollBounds();
      }
    };

    const hasHorizontalOverflow =
      scrollBounds.canScrollLeft || scrollBounds.canScrollRight;
    const trackFadeMask = React.useMemo(() => {
      const { canScrollLeft, canScrollRight } = scrollBounds;
      if (!canScrollLeft && !canScrollRight) return undefined;
      if (canScrollLeft && canScrollRight) {
        return "linear-gradient(to right, transparent 0px, black 24px, black calc(100% - 24px), transparent 100%)";
      }
      if (canScrollRight) {
        return "linear-gradient(to right, black 0px, black calc(100% - 28px), transparent 100%)";
      }
      return "linear-gradient(to right, transparent 0px, black 28px, black 100%)";
    }, [scrollBounds]);

    const imageDataUrl = attachedImage?.dataUrl ?? null;
    const imageName = attachedImage?.fileName ?? "";
    const canSubmit = Boolean(prompt.trim() || imageDataUrl);

    const handleParse = React.useCallback(async () => {
      setParseError(null);
      if (!ensureConfigured()) {
        setParseError(
          "Atur API key terlebih dahulu melalui tombol Atur API Key di kanan atas."
        );
        return;
      }

      if (!prompt.trim() && !imageDataUrl) {
        const msg =
          "Tulis kalimat transaksi atau lampirkan foto struk terlebih dahulu.";
        setParseError(msg);
        pushToast(msg, {
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
          pushToast("Form otomatis diisi", {
            description: `${single.note} (${formatSignedRupiah(single.amount, single.tx_type)})`,
            variant: "success",
          });
          onCloseAiMode?.();
        } else {
          setMultiDrafts(drafts);
          pushToast(`${drafts.length} transaksi berhasil dibaca`, {
            description: "Tinjau daftar di bawah lalu simpan sekaligus.",
            variant: "success",
          });
        }
      } catch (err: unknown) {
        const msg =
          err instanceof Error ? err.message : "Gagal membaca transaksi";
        setParseError(msg);
        pushToast("Pembacaan transaksi gagal", {
          description: msg,
          variant: "error",
        });
      } finally {
        setIsParsing(false);
      }
    }, [
      accounts,
      activeConfig,
      categories,
      ensureConfigured,
      imageDataUrl,
      onApplySingleDraft,
      onCloseAiMode,
      prompt,
    ]);

    React.useImperativeHandle(
      ref,
      () => ({
        submit: () => {
          void handleParse();
        },
      }),
      [handleParse]
    );

    React.useEffect(() => {
      onActionStateChange?.({ canSubmit, isParsing });
    }, [canSubmit, isParsing, onActionStateChange]);

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
        setParseError(null);
      } finally {
        setIsSavingBatch(false);
      }
    };

    return (
      <div
        data-testid="smart-magic-input-bar"
        className="space-y-4"
      >
        {/* Header Row: Title + Provider / BYOK Action */}
          {!activeConfig.isConfigured ? (
            <button
              type="button"
              data-testid="magic-input-setup-key-btn"
              onClick={openByokSettings}
              className="nav-touch-item flex flex-1 w-full text-center justify-center min-h-11 shrink-0 items-center gap-1.5 rounded-xl border border-amber-700/50 bg-amber-500/15 px-3 text-xs font-semibold text-amber-800 hover:bg-amber-500/25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary dark:border-amber-400/50 dark:text-amber-300"
            >
              <KeyRound className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>Atur API Key AI Agent</span>
            </button>
          ) : null}

        {/* Multiline Natural Language Input */}
        <div className="space-y-2.5">
          <label
            htmlFor="magic-input-textarea"
            className="block text-xs font-medium text-foreground"
          >
            Prompt
          </label>
          <div className="relative">
            <textarea
              id="magic-input-textarea"
              rows={3}
              data-testid="magic-input-text"
              value={prompt}
              onChange={(e) => {
                setPrompt(e.target.value);
                if (parseError) setParseError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void handleParse();
                }
              }}
              disabled={isParsing}
              placeholder="Contoh: Makan siang 45rb & kopi 22rb pakai GoPay..."
              className="w-full resize-none rounded-xl border border-control-border bg-background/90 p-3 pr-12 text-xs leading-relaxed text-foreground placeholder:text-muted-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-60"
            />
            {prompt && !isParsing && (
              <button
                type="button"
                onClick={() => {
                  setPrompt("");
                  setParseError(null);
                }}
                aria-label="Bersihkan teks"
                className="nav-touch-item absolute right-1 top-1 inline-flex h-11 w-11 items-center justify-center rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            )}
          </div>

          {/* Quick Example Horizontal Slider */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span
                id="quick-examples-label"
                className="block text-xs font-medium text-muted-foreground"
              >
                Contoh cepat:
              </span>

              {hasHorizontalOverflow && (
                <div
                  className="flex items-center gap-1"
                  data-vaul-no-drag=""
                >
                  <button
                    type="button"
                    onClick={() => scrollExamplesBy("left")}
                    disabled={!scrollBounds.canScrollLeft || isParsing}
                    aria-label="Geser contoh cepat ke kiri"
                    className="nav-touch-item inline-flex h-8 w-8 items-center justify-center rounded-full border border-control-border/40 bg-background/80 text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-35 disabled:hover:bg-background/80 transition-colors"
                  >
                    <ChevronLeft className="h-4 w-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => scrollExamplesBy("right")}
                    disabled={!scrollBounds.canScrollRight || isParsing}
                    aria-label="Geser contoh cepat ke kanan"
                    className="nav-touch-item inline-flex h-8 w-8 items-center justify-center rounded-full border border-control-border/40 bg-background/80 text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-35 disabled:hover:bg-background/80 transition-colors"
                  >
                    <ChevronRight className="h-4 w-4" aria-hidden="true" />
                  </button>
                </div>
              )}
            </div>

            <div
              ref={quickScrollRef}
              role="region"
              aria-labelledby="quick-examples-label"
              data-testid="quick-examples-slider"
              data-vaul-no-drag=""
              onScroll={updateScrollBounds}
              onPointerDown={handleExamplesPointerDown}
              onClickCapture={(e) => {
                if (suppressNextClickRef.current) {
                  e.preventDefault();
                  e.stopPropagation();
                  suppressNextClickRef.current = false;
                }
              }}
              style={
                trackFadeMask
                  ? {
                      maskImage: trackFadeMask,
                      WebkitMaskImage: trackFadeMask,
                    }
                  : undefined
              }
              className={`flex flex-nowrap items-center gap-2 overflow-x-auto no-scrollbar py-1 select-none touch-pan-x overscroll-x-contain ${
                hideSubmitButton
                  ? "-mx-5 px-5 scroll-px-5"
                  : "-mx-1 px-1 scroll-px-1"
              } ${
                isDraggingExamples
                  ? "snap-none cursor-grabbing [&>button]:cursor-grabbing [&>button]:transform-none"
                  : `snap-x snap-proximity ${hasHorizontalOverflow ? "cursor-grab" : ""}`
              }`}
            >
              {QUICK_PROMPT_EXAMPLES.map((example) => {
                const isSelected = prompt.trim() === example.text;
                return (
                  <button
                    key={example.id}
                    type="button"
                    disabled={isParsing}
                    aria-pressed={isSelected}
                    onClick={(e) => {
                      setPrompt(example.text);
                      setParseError(null);
                      e.currentTarget.scrollIntoView?.({
                        behavior: shouldReduceMotion ? "auto" : "smooth",
                        block: "nearest",
                        inline: "nearest",
                      });
                    }}
                    className={`nav-touch-item inline-flex min-h-11 shrink-0 snap-start items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-2 text-left text-xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-50 ${
                      isSelected
                        ? "border-cta-surface bg-cta-surface font-semibold text-cta-foreground"
                        : "border-control-border/45 bg-black/[0.03] font-medium text-foreground hover:border-control-border hover:bg-muted dark:bg-white/[0.05]"
                    }`}
                  >
                    {renderQuickExampleIcon(example.kind, isSelected)}
                    <span>{example.text}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* Receipt / Struk Attachment Section */}
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            onChange={(e) => {
              setParseError(null);
              void handleFileChange(e);
            }}
            className="hidden"
            data-testid="magic-input-file-upload"
          />

          {imageDataUrl ? (
            <div className="flex items-center justify-between gap-2.5 rounded-xl border border-control-border bg-primary/5 p-2.5 text-xs">
              <div className="flex items-center gap-2.5 min-w-0">
                <img
                  src={imageDataUrl}
                  alt="Pratinjau foto struk transaksi"
                  width={44}
                  height={44}
                  className="h-11 w-11 shrink-0 rounded-xl border border-control-border object-cover"
                />
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold text-foreground">
                    {imageName || "Foto Struk Terlampir"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Foto struk siap dipindai untuk mengisi transaksi
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={openFilePicker}
                  disabled={isParsing}
                  className="nav-touch-item min-h-11 rounded-xl border border-control-border bg-background px-3.5 text-xs font-semibold text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                >
                  Ganti
                </button>
                <button
                  type="button"
                  onClick={() => {
                    clearAttachment();
                    setParseError(null);
                  }}
                  disabled={isParsing}
                  className="nav-touch-item inline-flex h-11 w-11 items-center justify-center rounded-xl border border-control-border bg-background text-foreground hover:bg-muted hover:text-rose-700 dark:hover:text-rose-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  aria-label="Hapus foto struk"
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={openFilePicker}
              disabled={isParsing}
              className="nav-touch-item flex min-h-14 w-full items-center justify-between gap-3 rounded-xl border border-dashed border-control-border bg-background/60 px-3.5 py-2.5 text-left hover:border-primary hover:bg-background/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary transition-colors"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-black/[0.04] dark:bg-white/[0.06] text-foreground">
                  <ImagePlus className="h-4 w-4" aria-hidden="true" />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-foreground">
                    Scan Foto Struk / Bukti Transfer
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Pilih foto JPG, PNG, atau WebP untuk dibaca otomatis
                  </p>
                </div>
              </div>
              <span className="shrink-0 text-xs font-semibold text-primary">
                Pilih Foto
              </span>
            </button>
          )}
        </div>

        {/* Loading & Persistent Error Feedback */}
        {isParsing && (
          <div
            aria-live="polite"
            className="flex items-center gap-2 rounded-xl border border-control-border bg-muted px-3 py-2.5 text-xs font-medium text-foreground"
          >
            <Loader2
              className={`h-4 w-4 shrink-0 ${shouldReduceMotion ? "" : "animate-spin"}`}
              aria-hidden="true"
            />
            <span>Membaca transaksi dari teks dan foto struk...</span>
          </div>
        )}

        {parseError && (
          <div
            role="alert"
            data-testid="magic-input-error"
            className="flex items-start gap-2 rounded-xl border border-rose-700/50 bg-rose-500/12 px-3 py-2.5 text-xs font-medium text-rose-800 dark:border-rose-400/50 dark:text-rose-300"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{parseError}</span>
          </div>
        )}

        {/* Standalone Submit Fallback (hidden when rendered inside TransactionDialog footer) */}
        {!hideSubmitButton && (
          <button
            type="button"
            data-testid="magic-input-submit-btn"
            disabled={isParsing || !canSubmit}
            onClick={() => void handleParse()}
            className="nav-touch-item flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-cta-surface px-4 text-xs font-bold text-cta-foreground hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:border disabled:border-control-border disabled:bg-zinc-200 disabled:text-zinc-700 disabled:hover:opacity-100 dark:disabled:bg-zinc-800 dark:disabled:text-zinc-300 transition-opacity"
          >
            {isParsing ? (
              <>
                <Loader2
                  className={`h-4 w-4 shrink-0 ${shouldReduceMotion ? "" : "animate-spin"}`}
                  aria-hidden="true"
                />
                <span>Membaca transaksi...</span>
              </>
            ) : (
              <span>Proses &amp; Isi Otomatis</span>
            )}
          </button>
        )}

        {/* Quick Create Suggested Category Chip */}
        {suggestedCategory && onQuickCreateCategory && (
          <div className="flex items-center justify-between gap-2 rounded-xl border border-control-border bg-background/70 px-3 py-2 text-xs">
            <span className="text-muted-foreground">
              Kategori baru yang disarankan:{" "}
              <strong className="text-foreground">
                {suggestedCategory.name}
              </strong>
            </span>
            <button
              type="button"
              disabled={isCreatingSuggestedCat}
              onClick={() => void handleCreateSuggestedCategory()}
              className="nav-touch-item inline-flex min-h-11 shrink-0 items-center gap-1 rounded-xl bg-primary/15 px-3.5 text-xs font-semibold text-foreground hover:bg-primary/25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-60"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
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
            className="rounded-xl border border-control-border bg-background/90 p-3 space-y-2.5"
          >
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-foreground">
                Draf Multi-Transaksi ({multiDrafts.length} item)
              </span>
              <button
                type="button"
                onClick={() => setMultiDrafts([])}
                className="nav-touch-item min-h-11 rounded-xl px-3 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
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
                    <p className="truncate text-xs text-muted-foreground">
                      {item.account_name} · {item.category_name ?? "Transfer"} ·{" "}
                      {formatDateShort(item.tx_date)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={`font-mono text-xs font-bold tabular-nums ${
                        item.tx_type === "INCOME"
                          ? "text-emerald-700 dark:text-emerald-400"
                          : "text-rose-700 dark:text-rose-400"
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
                      className="nav-touch-item inline-flex h-11 w-11 items-center justify-center rounded-xl text-muted-foreground hover:bg-muted hover:text-rose-700 dark:hover:text-rose-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                      aria-label={`Hapus draf ${item.note}`}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
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
              className="nav-touch-item flex min-h-12 w-full items-center justify-center gap-1.5 rounded-2xl bg-cta-surface px-4 py-2.5 text-xs font-bold text-cta-foreground hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:border disabled:border-control-border disabled:bg-zinc-200 disabled:text-zinc-700 dark:disabled:bg-zinc-800 dark:disabled:text-zinc-300"
            >
              {isSavingBatch ? (
                <>
                  <Loader2
                    className={`h-4 w-4 shrink-0 ${shouldReduceMotion ? "" : "animate-spin"}`}
                    aria-hidden="true"
                  />
                  <span>Menyimpan {multiDrafts.length} Transaksi...</span>
                </>
              ) : (
                <>
                  <Check className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>Simpan Semua ({multiDrafts.length} Transaksi)</span>
                </>
              )}
            </button>
          </div>
        )}
      </div>
    );
  }
);

SmartMagicInputBar.displayName = "SmartMagicInputBar";
