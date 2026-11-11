import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TransactionDialog } from "../TransactionDialog";
import {
  tauriApi,
  type AccountView,
  type CategoryView,
} from "../../../lib/tauri-api";

describe("TransactionDialog QuickAddCategoryDrawer", () => {
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

  const baseCategories: CategoryView[] = [
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
    {
      id: "cat-2",
      name: "Transportasi",
      normalized_name: "transportasi",
      kind: "EXPENSE",
      merged_into_id: null,
      canonical_id: "cat-2",
      is_deleted: 0,
      updated_hlc: "1:1:1",
    },
  ];

  const createQueryClient = () =>
    new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(tauriApi, "listBooks").mockResolvedValue([]);
  });

  it("opens sub-drawer only via select '__NEW__' option and restores previous category when cancelled", async () => {
    render(
      <QueryClientProvider client={createQueryClient()}>
        <TransactionDialog
          isOpen={true}
          onClose={vi.fn()}
          bookId={bookId}
          accounts={mockAccounts}
          categories={baseCategories}
          editingTx={null}
          onAddTransaction={vi.fn().mockResolvedValue(undefined)}
          onUpdateTransaction={vi.fn().mockResolvedValue(undefined)}
          onTransferBetweenBooks={vi.fn().mockResolvedValue(undefined)}
        />
      </QueryClientProvider>
    );

    // No standalone external "Kategori Baru" button beside label
    expect(
      screen.queryByRole("button", { name: "Kategori Baru" })
    ).not.toBeInTheDocument();

    const categorySelect = screen.getByLabelText(
      /Kategori \(Pengeluaran\)/i
    ) as HTMLSelectElement;
    expect(categorySelect.value).toBe("cat-1");

    // Select "+ Tambah Kategori Baru..."
    fireEvent.change(categorySelect, { target: { value: "__NEW__" } });

    const subDrawer = await screen.findByTestId("quick-add-category-drawer");
    expect(subDrawer).toBeInTheDocument();
    // Main TransactionDialog remains open underneath while sub-drawer is open
    expect(screen.getByText("Catat Transaksi Baru")).toBeInTheDocument();

    // Existing category ("Transportasi") should be filtered out of suggestions
    const suggestions = screen.getByTestId("quick-add-category-suggestions");
    expect(suggestions).not.toHaveTextContent("Transportasi");
    expect(suggestions).toHaveTextContent("Belanja");

    // Cancel closes sub-drawer and keeps previous selection ("cat-1")
    fireEvent.click(screen.getByRole("button", { name: "Batal" }));

    await waitFor(() => {
      expect(
        screen.queryByTestId("quick-add-category-drawer")
      ).not.toBeInTheDocument();
    });
    expect(categorySelect.value).toBe("cat-1");
  });

  it("fills input on suggestion chip tap (allowing edit), creates category on submit, and selects it", async () => {
    const createdCat: CategoryView = {
      id: "cat-new",
      name: "Belanja Bulanan",
      normalized_name: "belanjabulanan",
      kind: "EXPENSE",
      merged_into_id: null,
      canonical_id: "cat-new",
      is_deleted: 0,
      updated_hlc: "2:1:1",
    };

    const upsertSpy = vi
      .spyOn(tauriApi, "upsertCategory")
      .mockResolvedValue(createdCat);

    const queryClient = createQueryClient();
    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <TransactionDialog
          isOpen={true}
          onClose={vi.fn()}
          bookId={bookId}
          accounts={mockAccounts}
          categories={baseCategories}
          editingTx={null}
          onAddTransaction={vi.fn().mockResolvedValue(undefined)}
          onUpdateTransaction={vi.fn().mockResolvedValue(undefined)}
          onTransferBetweenBooks={vi.fn().mockResolvedValue(undefined)}
        />
      </QueryClientProvider>
    );

    const categorySelect = screen.getByLabelText(
      /Kategori \(Pengeluaran\)/i
    ) as HTMLSelectElement;
    fireEvent.change(categorySelect, { target: { value: "__NEW__" } });

    const chip = await screen.findByRole("button", { name: "Belanja" });
    fireEvent.click(chip);

    // Chip fills input without submitting or closing immediately
    const input = screen.getByTestId(
      "quick-add-category-input"
    ) as HTMLInputElement;
    expect(input.value).toBe("Belanja");
    expect(chip).toHaveAttribute("aria-pressed", "true");
    expect(upsertSpy).not.toHaveBeenCalled();

    // User refines name before saving
    fireEvent.change(input, { target: { value: "Belanja Bulanan" } });

    fireEvent.click(screen.getByTestId("quick-add-category-submit-btn"));

    await waitFor(() => {
      expect(upsertSpy).toHaveBeenCalledWith(bookId, {
        id: null,
        name: "Belanja Bulanan",
        kind: "EXPENSE",
      });
    });

    // Simulate parent query returning updated categories list
    rerender(
      <QueryClientProvider client={queryClient}>
        <TransactionDialog
          isOpen={true}
          onClose={vi.fn()}
          bookId={bookId}
          accounts={mockAccounts}
          categories={[...baseCategories, createdCat]}
          editingTx={null}
          onAddTransaction={vi.fn().mockResolvedValue(undefined)}
          onUpdateTransaction={vi.fn().mockResolvedValue(undefined)}
          onTransferBetweenBooks={vi.fn().mockResolvedValue(undefined)}
        />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(
        screen.queryByTestId("quick-add-category-drawer")
      ).not.toBeInTheDocument();
      expect(categorySelect.value).toBe("cat-new");
    });
  });

  it("detects duplicate normalized category names and lets user pick existing category in one tap", async () => {
    const upsertSpy = vi.spyOn(tauriApi, "upsertCategory");

    render(
      <QueryClientProvider client={createQueryClient()}>
        <TransactionDialog
          isOpen={true}
          onClose={vi.fn()}
          bookId={bookId}
          accounts={mockAccounts}
          categories={baseCategories}
          editingTx={null}
          onAddTransaction={vi.fn().mockResolvedValue(undefined)}
          onUpdateTransaction={vi.fn().mockResolvedValue(undefined)}
          onTransferBetweenBooks={vi.fn().mockResolvedValue(undefined)}
        />
      </QueryClientProvider>
    );

    const categorySelect = screen.getByLabelText(
      /Kategori \(Pengeluaran\)/i
    ) as HTMLSelectElement;
    // Pick second category first
    fireEvent.change(categorySelect, { target: { value: "cat-2" } });
    expect(categorySelect.value).toBe("cat-2");

    // Open sub-drawer
    fireEvent.change(categorySelect, { target: { value: "__NEW__" } });

    const input = await screen.findByTestId("quick-add-category-input");
    fireEvent.change(input, { target: { value: "  JAJAN! " } });

    const dupAlert = await screen.findByTestId(
      "quick-add-category-duplicate-alert"
    );
    expect(dupAlert).toHaveTextContent('Kategori “Jajan” sudah tersedia.');
    expect(
      screen.getByTestId("quick-add-category-submit-btn")
    ).toBeDisabled();

    // Tap "Pilih" on duplicate alert
    fireEvent.click(screen.getByRole("button", { name: "Pilih" }));

    await waitFor(() => {
      expect(
        screen.queryByTestId("quick-add-category-drawer")
      ).not.toBeInTheDocument();
    });
    expect(upsertSpy).not.toHaveBeenCalled();
    expect(categorySelect.value).toBe("cat-1");
  });
});
