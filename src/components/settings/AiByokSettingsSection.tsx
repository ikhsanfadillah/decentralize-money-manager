import * as React from "react";
import { ChevronRight, ShieldCheck, Sparkles } from "lucide-react";
import { useAiConfig } from "../../hooks/ai";
import { AiByokConfigDrawer } from "../ai/AiByokConfigDrawer";

export { AiByokConfigDrawer };

export const AiByokSettingsSection: React.FC = () => {
  const { activeConfig, openByokSettings, openCopilot } = useAiConfig();

  return (
    <div className="space-y-2">
      <p className="px-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        Asisten AI Pintar (BYOK)
      </p>
      <div className="glass-card overflow-hidden divide-y divide-border/70">
        <button
          type="button"
          data-testid="settings-cta-ai-byok"
          onClick={openByokSettings}
          className="nav-touch-item group flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.04] focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary sm:px-5"
        >
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-border bg-black/[0.04] text-primary dark:bg-white/[0.06]">
              <Sparkles className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="truncate text-xs font-semibold text-foreground sm:text-sm">
                  Konfigurasi AI Agent (BYOK)
                </span>
                <span
                  data-testid="ai-byok-status-badge"
                  className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold ${
                    activeConfig.isConfigured
                      ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                      : "border-amber-500/35 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                  }`}
                >
                  {activeConfig.isConfigured
                    ? `${activeConfig.providerLabel} Aktif`
                    : "Belum Diatur"}
                </span>
              </div>
              <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                {activeConfig.isConfigured
                  ? `Model: ${activeConfig.model} · Tersimpan aman di perangkat lokal`
                  : "Gunakan API Key pribadi (Gemini, OpenAI, DeepSeek, Groq, OpenRouter / Ollama)"}
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <span className="rounded-full border border-border bg-black/[0.04] px-2.5 py-1 text-[11px] font-semibold text-foreground dark:bg-white/[0.06]">
              Atur Key
            </span>
            <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
          </div>
        </button>

        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-[11px] text-muted-foreground sm:px-5">
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
            <span>
              Kunci API hanya disimpan di perangkat ini dan tidak disinkronkan
              lewat P2P.
            </span>
          </span>
          <button
            type="button"
            onClick={openCopilot}
            className="nav-touch-item font-semibold text-primary hover:underline"
          >
            Buka Financial Co-Pilot →
          </button>
        </div>
      </div>
    </div>
  );
};
