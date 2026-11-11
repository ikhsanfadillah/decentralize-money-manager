import * as React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TransactionDialog } from "../TransactionDialog";
import { useAiStore } from "../../../stores/ai-store";
import * as aiProvider from "../../../lib/ai-provider";
import {
  tauriApi,
  type AccountView,
  type CategoryView,
  type TransactionView,
} from "../../../lib/tauri-api";

describe("TransactionDialog (Detail & Delete Action)", () => {
  const bookId = "book-1";

  const mockAccounts: AccountView[] = [
    {
      id: "acc-1",
      name: "BCA",
      account_type: "BANK",
      initial_balance: 1_000_000,
      merged_into_id: null,
      root_id: "acc-1",
      is_deleted: 0,
      updated_hlc: "1:1:1",
    },
  ];

  const mockCategories: CategoryView[] = [
    {
      id: "cat-1",
      name: "Jajan",
      normalized_name: "jajan",
      kind: "EXPENSE",
      merged_into_id: null,
      canonical_id: "cat-1",
      is_deleted: 0,
      updated_hlc: "1:1:1",
    },
  ];

  const mockTx: TransactionView = {
    id: "tx-1",
    account_id: "acc-1",
    account_name: "BCA",
    category_id: "cat-1",
    category_name: "Jajan",
    tx_date: "2026-10-27",
    tx_type: "EXPENSE",
    amount: -7000,
    note: "Somai",
    to_account_id: null,
    to_account_name: null,
    link_id: null,
    created_by_device: "68374230dev",
    updated_hlc: "1:1:1",
  };

  const createQueryClient = () =>
    new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(tauriApi, "listBooks").mockResolvedValue([]);
  });

  it("does not render delete button when creating a new transaction", () => {
    render(
      <QueryClientProvider client={createQueryClient()}>
        <TransactionDialog
          isOpen={true}
          onClose={vi.fn()}
          bookId={bookId}
          accounts={mockAccounts}
          categories={mockCategories}
          editingTx={null}
          onAddTransaction={vi.fn().mockResolvedValue(undefined)}
          onUpdateTransaction={vi.fn().mockResolvedValue(undefined)}
          onTransferBetweenBooks={vi.fn().mockResolvedValue(undefined)}
          onDeleteTransaction={vi.fn().mockResolvedValue(undefined)}
        />
      </QueryClientProvider>
    );

    expect(screen.getByText("Catat Transaksi Baru")).toBeInTheDocument();
    expect(
      screen.queryByTestId("tx-detail-delete-button")
    ).not.toBeInTheDocument();
  });

  it("toggles between Manual Form view and AI Smart Input view via footer spark button", async () => {
    render(
      <QueryClientProvider client={createQueryClient()}>
        <TransactionDialog
          isOpen={true}
          onClose={vi.fn()}
          bookId={bookId}
          accounts={mockAccounts}
          categories={mockCategories}
          editingTx={null}
          onAddTransaction={vi.fn().mockResolvedValue(undefined)}
          onUpdateTransaction={vi.fn().mockResolvedValue(undefined)}
          onTransferBetweenBooks={vi.fn().mockResolvedValue(undefined)}
          onDeleteTransaction={vi.fn().mockResolvedValue(undefined)}
        />
      </QueryClientProvider>
    );

    // Initially shows Manual Form and hides AI Smart Input Bar
    expect(screen.getByLabelText("Nominal Transaksi")).toBeInTheDocument();
    expect(
      screen.queryByTestId("smart-magic-input-bar")
    ).not.toBeInTheDocument();

    const sparkBtn = screen.getByTestId("toggle-ai-magic-mode-btn");
    expect(sparkBtn).toBeInTheDocument();

    // Click Spark button -> switches to AI Smart Input view replacing main form
    fireEvent.click(sparkBtn);

    await waitFor(() => {
      expect(screen.getByTestId("smart-magic-input-bar")).toBeInTheDocument();
      expect(
        screen.queryByLabelText("Nominal Transaksi")
      ).not.toBeInTheDocument();
    });

    // Click close / toggle button again -> returns to Manual Form view
    fireEvent.click(sparkBtn);

    await waitFor(() => {
      expect(screen.getByLabelText("Nominal Transaksi")).toBeInTheDocument();
      expect(
        screen.queryByTestId("smart-magic-input-bar")
      ).not.toBeInTheDocument();
    });
  });

  it("renders delete button on detail/edit drawer, opens confirmation drawer, and supports cancel or confirm delete", async () => {
    const onDeleteTransaction = vi.fn().mockResolvedValue(undefined);

    const Harness: React.FC = () => {
      const [editingTx, setEditingTx] = React.useState<TransactionView | null>(
        mockTx
      );

      return (
        <TransactionDialog
          isOpen={editingTx !== null}
          onClose={() => setEditingTx(null)}
          bookId={bookId}
          accounts={mockAccounts}
          categories={mockCategories}
          editingTx={editingTx}
          onAddTransaction={vi.fn().mockResolvedValue(undefined)}
          onUpdateTransaction={vi.fn().mockResolvedValue(undefined)}
          onTransferBetweenBooks={vi.fn().mockResolvedValue(undefined)}
          onDeleteTransaction={onDeleteTransaction}
        />
      );
    };

    render(
      <QueryClientProvider client={createQueryClient()}>
        <Harness />
      </QueryClientProvider>
    );

    expect(screen.getByText("Detail & Ubah Transaksi")).toBeInTheDocument();

    const deleteDetailBtn = screen.getByTestId("tx-detail-delete-button");
    expect(deleteDetailBtn).toHaveTextContent("Hapus Transaksi Ini");

    // Clicking Delete on detail closes edit drawer and opens delete confirmation drawer
    fireEvent.click(deleteDetailBtn);

    await waitFor(() => {
      expect(
        screen.queryByText("Detail & Ubah Transaksi")
      ).not.toBeInTheDocument();
      expect(screen.getByText("Hapus Transaksi Ini?")).toBeInTheDocument();
    });

    // Receipt preview shows transaction details
    expect(screen.getByText("Jajan")).toBeInTheDocument();
    expect(screen.getByText("−Rp 7.000")).toBeInTheDocument();
    expect(screen.getByText('"Somai"')).toBeInTheDocument();

    // Cancel closes confirmation drawer without deleting
    fireEvent.click(screen.getByRole("button", { name: "Batal" }));
    await waitFor(() => {
      expect(
        screen.queryByText("Hapus Transaksi Ini?")
      ).not.toBeInTheDocument();
    });
    expect(onDeleteTransaction).not.toHaveBeenCalled();
  });

  it("calls onDeleteTransaction and closes confirmation drawer when confirmed", async () => {
    const onDeleteTransaction = vi.fn().mockResolvedValue(undefined);

    const Harness: React.FC = () => {
      const [editingTx, setEditingTx] = React.useState<TransactionView | null>(
        mockTx
      );

      return (
        <TransactionDialog
          isOpen={editingTx !== null}
          onClose={() => setEditingTx(null)}
          bookId={bookId}
          accounts={mockAccounts}
          categories={mockCategories}
          editingTx={editingTx}
          onAddTransaction={vi.fn().mockResolvedValue(undefined)}
          onUpdateTransaction={vi.fn().mockResolvedValue(undefined)}
          onTransferBetweenBooks={vi.fn().mockResolvedValue(undefined)}
          onDeleteTransaction={onDeleteTransaction}
        />
      );
    };

    render(
      <QueryClientProvider client={createQueryClient()}>
        <Harness />
      </QueryClientProvider>
    );

    fireEvent.click(screen.getByTestId("tx-detail-delete-button"));

    const confirmBtn = await screen.findByRole("button", {
      name: "Hapus Transaksi",
    });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(onDeleteTransaction).toHaveBeenCalledTimes(1);
      expect(onDeleteTransaction).toHaveBeenCalledWith("tx-1");
      expect(
        screen.queryByText("Hapus Transaksi Ini?")
      ).not.toBeInTheDocument();
    });
  });

  it("renders 'Proses & Isi Otomatis' in the footer without duplicate back button, submits prompt, and applies single draft", async () => {
    useAiStore.setState({
      byok: {
        activeProvider: "gemini",
        providers: {
          gemini: {
            apiKey: "test-key-123",
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
    });

    const parseSpy = vi
      .spyOn(aiProvider, "parseSmartTransactionInput")
      .mockResolvedValue([
        {
          id: "draft-1",
          tx_type: "EXPENSE",
          account_id: "acc-1",
          account_name: "BCA",
          to_account_id: null,
          to_account_name: null,
          category_id: "cat-1",
          category_name: "Jajan",
          suggested_new_category: null,
          amount: 45000,
          tx_date: "2026-11-11",
          note: "Makan siang",
        },
      ]);

    render(
      <QueryClientProvider client={createQueryClient()}>
        <TransactionDialog
          isOpen={true}
          onClose={vi.fn()}
          bookId={bookId}
          accounts={mockAccounts}
          categories={mockCategories}
          editingTx={null}
          onAddTransaction={vi.fn().mockResolvedValue(undefined)}
          onUpdateTransaction={vi.fn().mockResolvedValue(undefined)}
          onTransferBetweenBooks={vi.fn().mockResolvedValue(undefined)}
          onDeleteTransaction={vi.fn().mockResolvedValue(undefined)}
        />
      </QueryClientProvider>
    );

    const toggleBtn = screen.getByTestId("toggle-ai-magic-mode-btn");
    fireEvent.click(toggleBtn);

    const submitBtn = await screen.findByTestId("magic-input-submit-btn");
    expect(submitBtn).toHaveTextContent("Proses & Isi Otomatis");
    expect(submitBtn).toBeDisabled();
    expect(
      screen.queryByTestId("back-to-manual-form-btn")
    ).not.toBeInTheDocument();
    expect(toggleBtn).toHaveAttribute("aria-label", "Kembali ke Form Manual");

    // Enter text into labeled textarea -> footer submit button becomes enabled
    const textarea = screen.getByLabelText("Kalimat Transaksi");
    fireEvent.change(textarea, {
      target: { value: "Makan siang 45rb pakai BCA" },
    });

    await waitFor(() => {
      expect(submitBtn).not.toBeDisabled();
    });

    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(parseSpy).toHaveBeenCalledTimes(1);
      expect(screen.getByLabelText("Nominal Transaksi")).toBeInTheDocument();
    });

    expect(screen.getByDisplayValue("Makan siang")).toBeInTheDocument();
  });

  it("shows persistent inline error alert when extraction fails and empty-account guidance when no accounts exist", async () => {
    useAiStore.setState({
      byok: {
        activeProvider: "gemini",
        providers: {
          gemini: {
            apiKey: "test-key-123",
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
    });

    vi.spyOn(aiProvider, "parseSmartTransactionInput").mockRejectedValue(
      new Error("Koneksi AI gagal")
    );

    render(
      <QueryClientProvider client={createQueryClient()}>
        <TransactionDialog
          isOpen={true}
          onClose={vi.fn()}
          bookId={bookId}
          accounts={[]}
          categories={[]}
          editingTx={null}
          onAddTransaction={vi.fn().mockResolvedValue(undefined)}
          onUpdateTransaction={vi.fn().mockResolvedValue(undefined)}
          onTransferBetweenBooks={vi.fn().mockResolvedValue(undefined)}
          onDeleteTransaction={vi.fn().mockResolvedValue(undefined)}
        />
      </QueryClientProvider>
    );

    expect(
      screen.getByText(/Belum ada rekening aktif di buku ini/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Belum ada kategori\. Pilih Kategori Baru/i)
    ).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("toggle-ai-magic-mode-btn"));
    fireEvent.change(await screen.findByLabelText("Kalimat Transaksi"), {
      target: { value: "Kopi 20rb" },
    });

    const submitBtn = await screen.findByTestId("magic-input-submit-btn");
    await waitFor(() => expect(submitBtn).not.toBeDisabled());
    fireEvent.click(submitBtn);

    const errorAlert = await screen.findByTestId("magic-input-error");
    expect(errorAlert).toHaveAttribute("role", "alert");
    expect(errorAlert).toHaveTextContent("Koneksi AI gagal");
  });
});
