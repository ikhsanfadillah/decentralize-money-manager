import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AiCopilotDrawer } from "../AiCopilotDrawer";
import { useAiStore } from "../../../stores/ai-store";
import * as aiProvider from "../../../lib/ai-provider";

vi.mock("../../../hooks/useBookFinance", () => ({
  useBookFinance: () => ({
    addTransactionMutation: { mutateAsync: vi.fn() },
    upsertCategoryMutation: { mutateAsync: vi.fn() },
    upsertBudgetMutation: { mutateAsync: vi.fn() },
  }),
}));

describe("AiCopilotDrawer Image Attachment & Vision Feature", () => {
  const bookId = "test-book-vision-123";
  let queryClient: QueryClient;

  beforeEach(() => {
    vi.restoreAllMocks();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    useAiStore.setState({
      isCopilotOpen: true,
      byok: {
        activeProvider: "gemini",
        providers: {
          gemini: {
            apiKey: "test-valid-key",
            model: "gemini-3.8-flash",
            baseUrl: "https://generativelanguage.googleapis.com/v1beta",
          },
          openai: {
            apiKey: "",
            model: "gpt-4o-mini",
            baseUrl: "https://api.openai.com/v1",
          },
          deepseek: {
            apiKey: "",
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
      chatByBook: {},
    });
  });

  it("renders attachment button beside send button and allows attaching image", async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <AiCopilotDrawer bookId={bookId} bookName="Buku Uji Coba" />
      </QueryClientProvider>
    );

    const attachBtn = screen.getByTestId("copilot-chat-attach-btn");
    const sendBtn = screen.getByTestId("copilot-chat-send-btn");
    const fileInput = screen.getByTestId("copilot-file-input") as HTMLInputElement;

    expect(attachBtn).toBeInTheDocument();
    expect(sendBtn).toBeInTheDocument();
    expect(fileInput).toBeInTheDocument();
    expect(fileInput.accept).toBe("image/*");

    // Initially send button is disabled when both text and attachment are empty
    expect(sendBtn).toBeDisabled();

    // Mock compressImageFileToDataUrl to return sample base64
    vi.spyOn(aiProvider, "compressImageFileToDataUrl").mockResolvedValue(
      "data:image/jpeg;base64,samplebase64data=="
    );

    const file = new File(["dummy content"], "struk-belanja.jpg", {
      type: "image/jpeg",
    });

    fireEvent.change(fileInput, { target: { files: [file] } });

    // Expect preview banner to appear with file name
    await waitFor(() => {
      expect(screen.getByText("struk-belanja.jpg")).toBeInTheDocument();
    });
    expect(
      screen.getByText(/Foto struk\/nota siap dianalisis/i)
    ).toBeInTheDocument();

    // Send button should now be enabled even if input text is empty
    expect(sendBtn).not.toBeDisabled();

    // Clicking remove attachment (X) should dismiss the preview banner
    const removeBtn = screen.getByRole("button", { name: "Hapus lampiran" });
    fireEvent.click(removeBtn);

    expect(screen.queryByText("struk-belanja.jpg")).not.toBeInTheDocument();
    expect(sendBtn).toBeDisabled();
  });

  it("sends attached image payload to runCopilotAgentTurn when form is submitted", async () => {
    const runCopilotSpy = vi
      .spyOn(aiProvider, "runCopilotAgentTurn")
      .mockResolvedValue({
        replyText: "Struk belanja Alfamart sebesar Rp 45.000 berhasil dianalisis.",
        toolSteps: ["Menganalisis foto struk..."],
        proposedTransactions: [],
        proposedBudgets: [],
      });

    vi.spyOn(aiProvider, "compressImageFileToDataUrl").mockResolvedValue(
      "data:image/jpeg;base64,samplebase64data=="
    );

    render(
      <QueryClientProvider client={queryClient}>
        <AiCopilotDrawer bookId={bookId} bookName="Buku Uji Coba" />
      </QueryClientProvider>
    );

    const fileInput = screen.getByTestId("copilot-file-input") as HTMLInputElement;
    const file = new File(["dummy content"], "nota.jpg", {
      type: "image/jpeg",
    });

    fireEvent.change(fileInput, { target: { files: [file] } });

    await waitFor(() => {
      expect(screen.getByText("nota.jpg")).toBeInTheDocument();
    });

    const sendBtn = screen.getByTestId("copilot-chat-send-btn");
    fireEvent.click(sendBtn);

    await waitFor(() => {
      expect(runCopilotSpy).toHaveBeenCalledTimes(1);
    });

    expect(runCopilotSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        bookId,
        image: {
          mimeType: "image/jpeg",
          base64Data: "samplebase64data==",
          dataUrl: "data:image/jpeg;base64,samplebase64data==",
        },
      })
    );

    // Assistant response should appear in chat
    await waitFor(() => {
      expect(
        screen.getByText(/Struk belanja Alfamart sebesar Rp 45.000 berhasil dianalisis/i)
      ).toBeInTheDocument();
    });
  });
});

