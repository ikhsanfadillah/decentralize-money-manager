import * as React from "react";
import { pushToast } from "../../lib/toast";
import { resolveActiveAiConfig, useAiStore } from "../../stores/ai-store";

export function useAiConfig() {
  const byok = useAiStore((s) => s.byok);
  const isCopilotOpen = useAiStore((s) => s.isCopilotOpen);
  const isByokSettingsDrawerOpen = useAiStore(
    (s) => s.isByokSettingsDrawerOpen
  );
  const setCopilotOpen = useAiStore((s) => s.setCopilotOpen);
  const setByokSettingsDrawerOpen = useAiStore(
    (s) => s.setByokSettingsDrawerOpen
  );

  const activeConfig = React.useMemo(() => resolveActiveAiConfig(byok), [byok]);

  const ensureConfigured = React.useCallback((): boolean => {
    if (!activeConfig.isConfigured) {
      pushToast("Atur API Key AI terlebih dahulu", {
        description:
          "Masukkan API Key pribadi Anda (Gemini, OpenAI, Groq, atau OpenRouter).",
        variant: "warning",
      });
      setByokSettingsDrawerOpen(true);
      return false;
    }
    return true;
  }, [activeConfig.isConfigured, setByokSettingsDrawerOpen]);

  const openByokSettings = React.useCallback(() => {
    setByokSettingsDrawerOpen(true);
  }, [setByokSettingsDrawerOpen]);

  const openCopilot = React.useCallback(() => {
    setCopilotOpen(true);
  }, [setCopilotOpen]);

  return {
    byok,
    activeConfig,
    isCopilotOpen,
    isByokSettingsDrawerOpen,
    setCopilotOpen,
    setByokSettingsDrawerOpen,
    ensureConfigured,
    openByokSettings,
    openCopilot,
  };
}

