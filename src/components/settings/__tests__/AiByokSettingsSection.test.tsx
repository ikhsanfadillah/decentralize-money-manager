import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AiByokConfigDrawer } from "../AiByokSettingsSection";
import { useAiStore } from "../../../stores/ai-store";
import * as aiProvider from "../../../lib/ai-provider";

describe("AiByokConfigDrawer Select Box & Auto-Fetch Models", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();

    useAiStore.setState({
      isByokSettingsDrawerOpen: true,
      byok: {
        activeProvider: "gemini",
        providers: {
          gemini: {
            apiKey: "test-gemini-key",
            model: "gemini-3.8-flash",
            baseUrl: "https://generativelanguage.googleapis.com/v1beta",
          },
          openai: {
            apiKey: "",
            model: "gpt-4o-mini",
            baseUrl: "https://api.openai.com/v1",
          },
          deepseek: {
            apiKey: "sk-deepseek-test",
            model: "deepseek-chat",
            baseUrl: "https://api.deepseek.com",
          },
          groq: {
            apiKey: "",
            model: "llama-3.3-70b-versatile",
            baseUrl: "https://api.groq.com/openai/v1",
          },
          openrouter: {
            apiKey: "",
            model: "google/gemini-2.5-flash",
            baseUrl: "https://openrouter.ai/api/v1",
          },
        },
      },
    });
  });

  it("renders select boxes for provider & model and auto-fetches models from API on open and provider switch", async () => {
    const fetchModelsSpy = vi
      .spyOn(aiProvider, "fetchAvailableProviderModels")
      .mockResolvedValueOnce([
        { id: "gemini-3.8-flash", label: "Gemini 3.8 Flash (gemini-3.8-flash)" },
        { id: "gemini-3.1-pro", label: "Gemini 3.1 Pro (gemini-3.1-pro)" },
      ])
      .mockResolvedValueOnce([
        { id: "deepseek-chat", label: "deepseek-chat" },
        { id: "deepseek-reasoner", label: "deepseek-reasoner" },
      ]);

    render(<AiByokConfigDrawer />);

    const providerSelect = screen.getByTestId(
      "ai-byok-provider-select"
    ) as HTMLSelectElement;
    const modelSelect = screen.getByTestId(
      "ai-byok-model-select"
    ) as HTMLSelectElement;

    expect(providerSelect.tagName).toBe("SELECT");
    expect(modelSelect.tagName).toBe("SELECT");

    // Verify all 5 providers are in provider select options
    const providerValues = Array.from(providerSelect.options).map(
      (o) => o.value
    );
    expect(providerValues).toEqual([
      "gemini",
      "openai",
      "deepseek",
      "groq",
      "openrouter",
    ]);

    // Auto-fetch should run immediately on drawer open for active provider (gemini)
    await waitFor(() => {
      expect(fetchModelsSpy).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(
        screen.getByText(/2 model langsung dimuat dari API Gemini/i)
      ).toBeInTheDocument();
    });

    // Switch provider to DeepSeek via select box -> auto-fetch runs immediately again
    fireEvent.change(providerSelect, { target: { value: "deepseek" } });

    await waitFor(() => {
      expect(fetchModelsSpy).toHaveBeenCalledTimes(2);
    });

    await waitFor(() => {
      expect(
        screen.getByText(/2 model langsung dimuat dari API DeepSeek/i)
      ).toBeInTheDocument();
    });

    // Select deepseek-reasoner from the model select box
    fireEvent.change(modelSelect, { target: { value: "deepseek-reasoner" } });
    expect(useAiStore.getState().byok.providers.deepseek.model).toBe(
      "deepseek-reasoner"
    );
  });
});

