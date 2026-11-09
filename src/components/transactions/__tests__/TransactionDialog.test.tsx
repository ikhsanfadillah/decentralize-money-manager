import * as React from "react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TransactionDialog } from "../TransactionDialog";
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
});
