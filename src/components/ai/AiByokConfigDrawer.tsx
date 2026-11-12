import * as React from "react";
import {
  Check,
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import {
  fetchAvailableProviderModels,
  testAiConnection,
} from "../../lib/ai-provider";
import { pushToast } from "../../lib/toast";
import {
  AI_PROVIDER_PRESETS,
  resolveActiveAiConfig,
  useAiStore,
  type AiProviderId,
} from "../../stores/ai-store";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "../ui/drawer";
import { Input } from "../ui/input";

export const AiByokConfigDrawer: React.FC = () => {
  const isOpen = useAiStore((s) => s.isByokSettingsDrawerOpen);
  const setOpen = useAiStore((s) => s.setByokSettingsDrawerOpen);
  const byok = useAiStore((s) => s.byok);
  const setActiveProvider = useAiStore((s) => s.setActiveProvider);
  const updateProviderConfig = useAiStore((s) => s.updateProviderConfig);
  const clearProviderApiKey = useAiStore((s) => s.clearProviderApiKey);

  const [showKey, setShowKey] = React.useState(false);
  const [isTesting, setIsTesting] = React.useState(false);
  const [isLoadingModels, setIsLoadingModels] = React.useState(false);
  const [fetchedModels, setFetchedModels] = React.useState<
    { id: string; label: string }[]
  >([]);
  const [fetchModelsError, setFetchModelsError] = React.useState<string | null>(
    null
  );
  const [testResult, setTestResult] = React.useState<{
    ok: boolean;
    message: string;
  } | null>(null);

  const activeProvider = byok.activeProvider;
  const preset = AI_PROVIDER_PRESETS[activeProvider];
  const currentConfig = byok.providers[activeProvider];

  const prevAutoFetchTriggerRef = React.useRef<{
    isOpen: boolean;
    provider: AiProviderId;
  }>({ isOpen: false, provider: activeProvider });
  const latestFetchReqIdRef = React.useRef(0);

  React.useEffect(() => {
    setTestResult(null);
  }, [
    activeProvider,
    currentConfig.apiKey,
    currentConfig.model,
    currentConfig.baseUrl,
  ]);

  React.useEffect(() => {
    setFetchedModels([]);
    setFetchModelsError(null);
  }, [activeProvider]);

  const executeFetchModels = React.useCallback(async (silent: boolean) => {
    const resolved = resolveActiveAiConfig(useAiStore.getState().byok);
    if (!resolved.isConfigured) {
      if (!silent) {
        pushToast("Masukkan API Key terlebih dahulu", { variant: "warning" });
      }
      return;
    }

    const reqId = ++latestFetchReqIdRef.current;
    setIsLoadingModels(true);
    setFetchModelsError(null);
    try {
      const models = await fetchAvailableProviderModels(resolved);
      if (reqId !== latestFetchReqIdRef.current) return;
      setFetchedModels(models);
      if (!silent) {
        if (models.length > 0) {
          pushToast(
            `${models.length} model ditemukan dari ${resolved.providerLabel}`,
            { variant: "success" }
          );
        } else {
          pushToast("Tidak ada model yang dikembalikan oleh API", {
            variant: "info",
          });
        }
      }
    } catch (err: unknown) {
      if (reqId !== latestFetchReqIdRef.current) return;
      const msg =
        err instanceof Error ? err.message : "Gagal memuat daftar model";
      setFetchModelsError(msg);
      if (!silent) {
        pushToast(msg, { variant: "error" });
      }
    } finally {
      if (reqId === latestFetchReqIdRef.current) {
        setIsLoadingModels(false);
      }
    }
  }, []);

  // Automatically load models from API when drawer opens, provider changes, or API key / base URL is updated
  React.useEffect(() => {
    if (!isOpen) {
      prevAutoFetchTriggerRef.current = {
        isOpen: false,
        provider: activeProvider,
      };
      return;
    }

    const resolved = resolveActiveAiConfig(byok);
    const prev = prevAutoFetchTriggerRef.current;
    const isImmediateTrigger =
      !prev.isOpen || prev.provider !== activeProvider;

    prevAutoFetchTriggerRef.current = {
      isOpen: true,
      provider: activeProvider,
    };

    if (!resolved.isConfigured) {
      setFetchedModels([]);
      setFetchModelsError(null);
      setIsLoadingModels(false);
      return;
    }

    const timer = window.setTimeout(
      () => {
        void executeFetchModels(true);
      },
      isImmediateTrigger ? 0 : 450
    );

    return () => {
      window.clearTimeout(timer);
    };
  }, [
    isOpen,
    activeProvider,
    currentConfig.apiKey,
    currentConfig.baseUrl,
    byok,
    executeFetchModels,
  ]);

  const modelOptions = React.useMemo(() => {
    const list: { id: string; label: string }[] = [];
    const seen = new Set<string>();

    if (fetchedModels.length > 0) {
      for (const fm of fetchedModels) {
        if (!seen.has(fm.id)) {
          seen.add(fm.id);
          list.push(fm);
        }
      }
    } else {
      for (const rm of preset.recommendedModels) {
        if (!seen.has(rm.id)) {
          seen.add(rm.id);
          list.push({ id: rm.id, label: rm.label });
        }
      }
    }

    if (currentConfig.model && !seen.has(currentConfig.model)) {
      list.unshift({
        id: currentConfig.model,
        label: currentConfig.model,
      });
    }

    return list;
  }, [fetchedModels, preset.recommendedModels, currentConfig.model]);

  const handleTestConnection = async () => {
    const resolved = resolveActiveAiConfig(byok);
    if (!resolved.isConfigured) {
      pushToast("Masukkan API Key terlebih dahulu", { variant: "warning" });
      return;
    }

    setIsTesting(true);
    setTestResult(null);
    try {
      const res = await testAiConnection(resolved);
      setTestResult({
        ok: true,
        message: `Terhubung ke ${resolved.providerLabel} (${resolved.model}) dalam ${res.latencyMs} ms.`,
      });
      pushToast(`Koneksi ${resolved.providerLabel} berhasil`, {
        description: `Respons diterima dalam ${res.latencyMs} ms.`,
        variant: "success",
      });
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Gagal menghubungi server AI";
      setTestResult({
        ok: false,
        message: msg,
      });
      pushToast("Tes koneksi AI gagal", {
        description: msg,
        variant: "error",
      });
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <Drawer
      open={isOpen}
      onOpenChange={(open) => setOpen(open)}
      shouldScaleBackground={false}
    >
      <DrawerContent
        aria-describedby="ai-byok-drawer-desc"
        className="p-0 data-[vaul-drawer-direction=bottom]:max-h-[90dvh] data-[vaul-drawer-direction=bottom]:w-full data-[vaul-drawer-direction=bottom]:sm:mx-auto sm:max-w-lg"
      >
        <DrawerHeader className="flex flex-row items-center justify-between border-b border-border/70 px-5 py-3.5">
          <div>
            <DrawerTitle className="flex items-center gap-2 text-sm font-bold text-foreground">
              <Sparkles className="h-4 w-4 text-primary" />
              <span>Pengaturan AI Agent (BYOK)</span>
            </DrawerTitle>
            <DrawerDescription
              id="ai-byok-drawer-desc"
              className="mt-0.5 text-xs text-muted-foreground"
            >
              Pilih provider AI dan masukkan kunci API milik Anda sendiri.
            </DrawerDescription>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Tutup"
            className="nav-touch-item inline-flex h-8 w-8 items-center justify-center rounded-full border border-border bg-black/[0.04] text-muted-foreground hover:bg-muted hover:text-foreground dark:bg-white/[0.06]"
          >
            <X className="h-4 w-4" />
          </button>
        </DrawerHeader>

        <div className="flex-auto min-h-0 overflow-y-auto overscroll-contain px-5 py-4 space-y-4">
          {/* 1. Provider Select Box */}
          <div className="space-y-1.5">
            <label
              htmlFor="ai-byok-provider-select"
              className="block text-xs font-semibold text-foreground"
            >
              Pilih Provider AI
            </label>
            <select
              id="ai-byok-provider-select"
              data-testid="ai-byok-provider-select"
              value={activeProvider}
              onChange={(e) =>
                setActiveProvider(e.target.value as AiProviderId)
              }
              className="flex h-10 w-full rounded-xl border border-border bg-black/[0.03] px-3.5 py-2 text-xs font-medium text-foreground focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary dark:bg-white/[0.06]"
            >
              {(Object.keys(AI_PROVIDER_PRESETS) as AiProviderId[]).map(
                (pid) => {
                  const p = AI_PROVIDER_PRESETS[pid];
                  const hasKey = Boolean(byok.providers[pid]?.apiKey.trim());
                  return (
                    <option
                      key={pid}
                      value={pid}
                      className="bg-background text-foreground"
                    >
                      {p.label}
                      {hasKey ? " (API Key tersimpan)" : ""}
                    </option>
                  );
                }
              )}
            </select>
            <p className="text-[11px] text-muted-foreground">
              {preset.docsHint}
            </p>
          </div>

          {/* 2. API Key Input */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label
                htmlFor="ai-byok-api-key-input"
                className="flex items-center gap-1.5 text-xs font-semibold text-foreground"
              >
                <KeyRound className="h-3.5 w-3.5 text-primary" />
                <span>API Key ({preset.shortLabel})</span>
              </label>
              {currentConfig.apiKey.trim() && (
                <button
                  type="button"
                  onClick={() => {
                    clearProviderApiKey(activeProvider);
                    pushToast(`API Key ${preset.shortLabel} dihapus`, {
                      variant: "info",
                    });
                  }}
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-500 hover:underline"
                >
                  <Trash2 className="h-3 w-3" />
                  <span>Hapus Key</span>
                </button>
              )}
            </div>

            <div className="relative flex items-center">
              <Input
                id="ai-byok-api-key-input"
                data-testid="ai-byok-api-key-input"
                type={showKey ? "text" : "password"}
                value={currentConfig.apiKey}
                onChange={(e) =>
                  updateProviderConfig(activeProvider, {
                    apiKey: e.target.value,
                  })
                }
                placeholder={preset.apiKeyPlaceholder}
                className="pr-10 font-mono text-xs"
                autoComplete="off"
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                aria-label={
                  showKey ? "Sembunyikan API Key" : "Tampilkan API Key"
                }
                className="absolute right-2.5 inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:text-foreground"
              >
                {showKey ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          {/* 3. Model AI Select Box */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="ai-byok-model-select"
                className="block text-xs font-semibold text-foreground"
              >
                Model AI
              </label>
              <button
                type="button"
                data-testid="ai-byok-refresh-models-btn"
                disabled={isLoadingModels}
                onClick={() => void executeFetchModels(false)}
                className="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline disabled:opacity-50"
              >
                <RefreshCw
                  className={`h-3 w-3 ${isLoadingModels ? "animate-spin" : ""}`}
                />
                <span>
                  {isLoadingModels ? "Memuat Model..." : "Muat Ulang Model"}
                </span>
              </button>
            </div>

            <select
              id="ai-byok-model-select"
              data-testid="ai-byok-model-select"
              value={currentConfig.model}
              disabled={isLoadingModels && fetchedModels.length === 0}
              onChange={(e) =>
                updateProviderConfig(activeProvider, {
                  model: e.target.value.replace(/^models\//, ""),
                })
              }
              className="flex h-10 w-full rounded-xl border border-border bg-black/[0.03] px-3.5 py-2 font-mono text-xs text-foreground focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary disabled:opacity-60 dark:bg-white/[0.06]"
            >
              {modelOptions.map((m) => (
                <option
                  key={m.id}
                  value={m.id}
                  className="bg-background text-foreground"
                >
                  {m.label}
                </option>
              ))}
            </select>

            {fetchModelsError ? (
              <p className="text-[11px] text-rose-500">{fetchModelsError}</p>
            ) : fetchedModels.length > 0 ? (
              <p className="text-[11px] text-emerald-600 dark:text-emerald-400">
                ✓ {fetchedModels.length} model langsung dimuat dari API{" "}
                {preset.shortLabel}.
              </p>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                {resolveActiveAiConfig(byok).isConfigured
                  ? isLoadingModels
                    ? `Mengambil daftar model dari ${preset.shortLabel}...`
                    : `Menampilkan model bawaan ${preset.shortLabel}.`
                  : "Masukkan API Key untuk memuat daftar model langsung dari server."}
              </p>
            )}
          </div>

          {/* 4. Base URL */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label
                htmlFor="ai-byok-base-url-input"
                className="block text-xs font-semibold text-foreground"
              >
                Endpoint Base URL
              </label>
              {currentConfig.baseUrl !== preset.defaultBaseUrl && (
                <button
                  type="button"
                  onClick={() =>
                    updateProviderConfig(activeProvider, {
                      baseUrl: preset.defaultBaseUrl,
                    })
                  }
                  className="text-[11px] font-semibold text-primary hover:underline"
                >
                  Reset Default
                </button>
              )}
            </div>
            <Input
              id="ai-byok-base-url-input"
              value={currentConfig.baseUrl}
              onChange={(e) =>
                updateProviderConfig(activeProvider, {
                  baseUrl: e.target.value,
                })
              }
              placeholder={preset.defaultBaseUrl}
              className="font-mono text-xs"
            />
          </div>

          {/* 5. Connection Test Feedback */}
          {testResult && (
            <div
              data-testid="ai-byok-test-result"
              className={`rounded-2xl border p-3 text-xs ${
                testResult.ok
                  ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
                  : "border-rose-500/35 bg-rose-500/10 text-rose-600 dark:text-rose-300"
              }`}
            >
              <p className="font-semibold">
                {testResult.ok ? "✓ Koneksi Berhasil" : "✕ Koneksi Gagal"}
              </p>
              <p className="mt-0.5 text-[11px] opacity-90">
                {testResult.message}
              </p>
            </div>
          )}

          {/* Privacy Guarantee Banner */}
          <div className="flex items-start gap-2.5 rounded-2xl border border-border/80 bg-black/[0.02] p-3 text-[11px] text-muted-foreground dark:bg-white/[0.03]">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
            <div>
              <p className="font-semibold text-foreground">
                Privasi Lokal &amp; Keamanan P2P
              </p>
              <p className="mt-0.5 leading-relaxed">
                Kunci API Anda disimpan khusus di perangkat ini dan{" "}
                <strong className="text-foreground">tidak pernah</strong>{" "}
                dimasukkan ke oplog sinkronisasi P2P maupun file cadangan buku.
              </p>
            </div>
          </div>
        </div>

        <DrawerFooter className="flex flex-row items-center justify-between gap-2 border-t border-border/70 px-5 py-3.5">
          <button
            type="button"
            data-testid="ai-byok-test-button"
            disabled={isTesting}
            onClick={() => void handleTestConnection()}
            className="nav-touch-item inline-flex h-10 items-center justify-center gap-1.5 rounded-full border border-border bg-black/[0.04] px-4 text-xs font-semibold text-foreground transition-colors hover:bg-muted disabled:opacity-50 dark:bg-white/[0.06]"
          >
            {isTesting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                <span>Menguji...</span>
              </>
            ) : (
              <span>Tes Koneksi</span>
            )}
          </button>

          <button
            type="button"
            data-testid="ai-byok-done-button"
            onClick={() => setOpen(false)}
            className="nav-touch-item inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-full bg-cta-surface px-4 text-xs font-bold text-cta-foreground transition-opacity hover:opacity-90"
          >
            <Check className="h-4 w-4" />
            <span>Selesai &amp; Gunakan</span>
          </button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
};

