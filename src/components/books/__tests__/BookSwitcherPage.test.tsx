import { describe, expect, it, vi, beforeEach, beforeAll } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BookSwitcherPage } from "../BookSwitcherPage";
import { computeSmartBudgetAllocations } from "../BookSetupWizardDrawer";
import { tauriApi, type BookMetadata } from "../../../lib/tauri-api";
import { DEFAULT_CASH_ACCOUNT_ID } from "../../../lib/web-core";

beforeAll(() => {
  if (typeof window !== "undefined" && !window.PointerEvent) {
    class MockPointerEvent extends MouseEvent {
      pointerId: number;
      pointerType: string;
      constructor(type: string, params: PointerEventInit = {}) {
        super(type, params);
        this.pointerId = params.pointerId ?? 0;
        this.pointerType = params.pointerType ?? "mouse";
      }
    }
    window.PointerEvent =
      MockPointerEvent as unknown as typeof window.PointerEvent;
  }
});

const mockNavigate = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    params,
    ...props
  }: {
    children: React.ReactNode;
    to?: string;
    params?: Record<string, string>;
    [key: string]: unknown;
  }) => {
    let href = typeof to === "string" ? to : "#";
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        href = href.replace(`$${k}`, v);
      }
    }
    return (
      <a href={href} {...props}>
        {children}
      </a>
    );
  },
  useNavigate: () => mockNavigate,
}));

describe("BookSwitcherPage & BookSetupWizardDrawer", () => {
  const mockBooks: BookMetadata[] = [
    {
      id: "book-001",
      name: "Uang Pribadi",
      kind: "PERSONAL",
      file_exists: true,
      last_opened_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    },
    {
      id: "book-002",
      name: "Kas Usaha Warung",
      kind: "BUSINESS",
      file_exists: true,
      last_opened_at: new Date(Date.now() - 86400_000).toISOString(),
      created_at: new Date(Date.now() - 172800_000).toISOString(),
    },
  ];

  beforeEach(() => {
    vi.restoreAllMocks();
    mockNavigate.mockReset();
    vi.spyOn(tauriApi, "listBooks").mockResolvedValue(mockBooks);
  });

  const createQueryClient = () =>
    new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

  it("renders clean clickable book cards without inline Ubah Nama or Hapus buttons", async () => {
    render(
      <QueryClientProvider client={createQueryClient()}>
        <BookSwitcherPage />
      </QueryClientProvider>
    );

    expect(await screen.findByText("Uang Pribadi")).toBeInTheDocument();
    expect(screen.getByText("Kas Usaha Warung")).toBeInTheDocument();
    expect(screen.getByText("Pribadi")).toBeInTheDocument();
    expect(screen.getByText("Usaha")).toBeInTheDocument();

    // Whole card links directly to book dashboard
    const primaryCard = screen.getByTestId("book-item-book-001");
    expect(primaryCard.tagName.toLowerCase()).toBe("a");
    expect(primaryCard).toHaveAttribute("href", "/books/book-001/dashboard");

    // Rename & Delete actions were moved to Book -> Settings
    expect(
      screen.queryByRole("button", { name: "Ubah Nama" })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Hapus" })
    ).not.toBeInTheDocument();
  });

  it("renders empty state when there are no books", async () => {
    vi.spyOn(tauriApi, "listBooks").mockResolvedValue([]);

    render(
      <QueryClientProvider client={createQueryClient()}>
        <BookSwitcherPage />
      </QueryClientProvider>
    );

    expect(
      await screen.findByText("Belum ada buku keuangan")
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "+ Buat Buku Baru" })
    ).toBeInTheDocument();
  });

  it("opens 4-Step Create Book Wizard drawer when Buat Buku button is clicked and closes cleanly", async () => {
    render(
      <QueryClientProvider client={createQueryClient()}>
        <BookSwitcherPage />
      </QueryClientProvider>
    );

    expect(await screen.findByText("Uang Pribadi")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Buat Buku" }));

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Buat Buku Keuangan Baru" })
      ).toBeInTheDocument();
      expect(screen.getByLabelText("Nama Buku Keuangan")).toBeInTheDocument();
      expect(screen.getByTestId("wizard-skip-btn")).toHaveTextContent(
        "Lewati Setup & Buat"
      );
      expect(screen.getByTestId("wizard-next-btn")).toHaveTextContent("Lanjut");
    });

    fireEvent.click(screen.getByRole("button", { name: "Tutup" }));

    await waitFor(() => {
      expect(
        screen.queryByRole("heading", { name: "Buat Buku Keuangan Baru" })
      ).not.toBeInTheDocument();
    });
  });

  it("allows skipping setup at Step 1 and creates book with default Kas Tunai only", async () => {
    const createBookSpy = vi.spyOn(tauriApi, "createBook").mockResolvedValue({
      id: "book-skip-1",
      name: "Buku Cepat",
      kind: "PERSONAL",
      file_exists: true,
      created_at: new Date().toISOString(),
      last_opened_at: new Date().toISOString(),
    });
    const upsertAccountSpy = vi.spyOn(tauriApi, "upsertAccount");
    const upsertCategorySpy = vi.spyOn(tauriApi, "upsertCategory");
    const upsertBudgetSpy = vi.spyOn(tauriApi, "upsertBudget");

    render(
      <QueryClientProvider client={createQueryClient()}>
        <BookSwitcherPage />
      </QueryClientProvider>
    );

    expect(await screen.findByText("Uang Pribadi")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Buat Buku" }));

    const nameInput = await screen.findByLabelText("Nama Buku Keuangan");
    fireEvent.change(nameInput, { target: { value: "Buku Cepat" } });

    fireEvent.click(screen.getByTestId("wizard-skip-btn"));

    await waitFor(() => {
      expect(createBookSpy).toHaveBeenCalledWith("Buku Cepat", "PERSONAL");
      expect(upsertAccountSpy).not.toHaveBeenCalled();
      expect(upsertCategorySpy).not.toHaveBeenCalled();
      expect(upsertBudgetSpy).not.toHaveBeenCalled();
      expect(mockNavigate).toHaveBeenCalledWith({
        to: "/books/$bookId/dashboard",
        params: { bookId: "book-skip-1" },
      });
    });
  });

  it("navigates across Steps 1 -> 2 -> 3 -> 4, supports custom chips, and preserves previous step selections on mid-wizard skip", async () => {
    const createBookSpy = vi.spyOn(tauriApi, "createBook").mockResolvedValue({
      id: "book-step3-skip",
      name: "Uang Rumah Tangga",
      kind: "PERSONAL",
      file_exists: true,
      created_at: new Date().toISOString(),
      last_opened_at: new Date().toISOString(),
    });
    const upsertAccountSpy = vi.spyOn(tauriApi, "upsertAccount").mockResolvedValue({
      id: "acc-new",
      name: "BCA",
      account_type: "BANK",
      initial_balance: 0,
      merged_into_id: null,
      is_deleted: 0,
      updated_hlc: "hlc",
    });
    const deleteAccountSpy = vi
      .spyOn(tauriApi, "deleteAccount")
      .mockResolvedValue(undefined);
    const upsertCategorySpy = vi
      .spyOn(tauriApi, "upsertCategory")
      .mockImplementation(async (_bookId, input) => ({
        id: `cat-${input.name}`,
        name: input.name,
        normalized_name: input.name.toLowerCase(),
        kind: input.kind,
        merged_into_id: null,
        canonical_id: `cat-${input.name}`,
        is_deleted: 0,
        updated_hlc: "hlc",
      }));

    render(
      <QueryClientProvider client={createQueryClient()}>
        <BookSwitcherPage />
      </QueryClientProvider>
    );

    expect(await screen.findByText("Uang Pribadi")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Buat Buku" }));

    // Step 1: Select quick suggestion pill "Uang Rumah Tangga" and click Lanjut
    fireEvent.click(await screen.findByRole("button", { name: "Uang Rumah Tangga" }));
    fireEvent.click(screen.getByTestId("wizard-next-btn"));

    // Step 2: Accounts
    expect(await screen.findByTestId("wizard-step-2")).toBeInTheDocument();
    expect(screen.getByTestId("selected-accounts-count")).toHaveTextContent(
      "1 dipilih"
    );

    // Select BCA and GoPay, unselect Kas Tunai
    fireEvent.click(screen.getByTestId("wizard-account-chip-bank-bca"));
    fireEvent.click(screen.getByTestId("wizard-account-chip-ewallet-gopay"));
    fireEvent.click(screen.getByTestId("wizard-account-chip-cash-kas-tunai"));
    expect(screen.getByTestId("selected-accounts-count")).toHaveTextContent(
      "2 dipilih"
    );

    // Move to Step 3: Categories
    fireEvent.click(screen.getByTestId("wizard-next-btn"));
    expect(await screen.findByTestId("wizard-step-3")).toBeInTheDocument();
    // 5 default Expense + 2 default Income = 7 categories
    expect(screen.getByTestId("selected-categories-count")).toHaveTextContent(
      "7 kategori dipilih"
    );

    // Move to Step 4: Budgets
    fireEvent.click(screen.getByTestId("wizard-next-btn"));
    expect(await screen.findByTestId("wizard-step-4")).toBeInTheDocument();
    expect(screen.getByText("Geser untuk Buat Buku")).toBeInTheDocument();

    // Select Rp 5 Jt quick pill -> Smart Auto-Split section appears
    fireEvent.click(screen.getByTestId("wizard-budget-pill-5000000"));
    expect(screen.getByText("Smart Auto-Split Kategori")).toBeInTheDocument();

    // Now test clicking "Lewati Anggaran & Buat Buku" at Step 4 (keeps Step 2 accounts & Step 3 categories, skips budgets)
    fireEvent.click(screen.getByTestId("wizard-skip-btn"));

    await waitFor(() => {
      expect(createBookSpy).toHaveBeenCalledWith(
        "Uang Rumah Tangga",
        "PERSONAL"
      );
      // BCA and GoPay were seeded
      expect(upsertAccountSpy).toHaveBeenCalledTimes(2);
      // Default Kas Tunai was unchecked so it should be deleted
      expect(deleteAccountSpy).toHaveBeenCalledWith(
        "book-step3-skip",
        DEFAULT_CASH_ACCOUNT_ID
      );
      // 7 default categories were seeded
      expect(upsertCategorySpy).toHaveBeenCalledTimes(7);
      expect(mockNavigate).toHaveBeenCalledWith({
        to: "/books/$bookId/dashboard",
        params: { bookId: "book-step3-skip" },
      });
    });
  });

  it("computes weighted Smart Auto-Split budget allocations that sum exactly to totalBudget", () => {
    const categories = [
      { key: "makan", name: "Makan & Minum", budgetWeight: 30 },
      { key: "belanja", name: "Belanja Bulanan", budgetWeight: 25 },
      { key: "tagihan", name: "Tagihan & Utilitas", budgetWeight: 20 },
      { key: "transport", name: "Transportasi", budgetWeight: 15 },
      { key: "hiburan", name: "Hiburan", budgetWeight: 10 },
    ];

    const result = computeSmartBudgetAllocations(5_000_000, categories);
    expect(result).toHaveLength(5);

    const sum = result.reduce((acc, item) => acc + item.amount, 0);
    expect(sum).toBe(5_000_000);

    // Makan & Minum (weight 30/100) should get 1_500_000
    expect(result.find((r) => r.key === "makan")?.amount).toBe(1_500_000);
    // Hiburan (weight 10/100) should get 500_000
    expect(result.find((r) => r.key === "hiburan")?.amount).toBe(500_000);
  });

  it("seeds accounts, categories, total budget, and auto-split category budgets when confirmed via SlideToConfirm on Step 4", async () => {
    vi.spyOn(tauriApi, "createBook").mockResolvedValue({
      id: "book-full-setup",
      name: "Keuangan Pribadi",
      kind: "PERSONAL",
      file_exists: true,
      created_at: new Date().toISOString(),
      last_opened_at: new Date().toISOString(),
    });
    const upsertAccountSpy = vi.spyOn(tauriApi, "upsertAccount").mockResolvedValue({
      id: "acc-bca",
      name: "BCA",
      account_type: "BANK",
      initial_balance: 0,
      merged_into_id: null,
      is_deleted: 0,
      updated_hlc: "hlc",
    });
    const upsertCategorySpy = vi
      .spyOn(tauriApi, "upsertCategory")
      .mockImplementation(async (_bookId, input) => ({
        id: `cat-id-${input.name}`,
        name: input.name,
        normalized_name: input.name.toLowerCase(),
        kind: input.kind,
        merged_into_id: null,
        canonical_id: `cat-id-${input.name}`,
        is_deleted: 0,
        updated_hlc: "hlc",
      }));
    const upsertBudgetSpy = vi.spyOn(tauriApi, "upsertBudget").mockResolvedValue({
      id: "budget-row",
      category_id: null,
      period: "MONTHLY",
      amount_limit: 5_000_000,
      alert_threshold_pct: 80,
      is_deleted: 0,
      updated_hlc: "hlc",
    });

    render(
      <QueryClientProvider client={createQueryClient()}>
        <BookSwitcherPage />
      </QueryClientProvider>
    );

    expect(await screen.findByText("Uang Pribadi")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Buat Buku" }));

    // Step 1: Select "Keuangan Pribadi"
    fireEvent.click(await screen.findByRole("button", { name: "Keuangan Pribadi" }));
    fireEvent.click(screen.getByTestId("wizard-next-btn"));

    // Step 2: Add BCA (keeping default Kas Tunai selected)
    expect(await screen.findByTestId("wizard-step-2")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("wizard-account-chip-bank-bca"));
    fireEvent.click(screen.getByTestId("wizard-next-btn"));

    // Step 3: Keep default 7 categories (5 Expense + 2 Income)
    expect(await screen.findByTestId("wizard-step-3")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("wizard-next-btn"));

    // Step 4: Select Rp 5 Jt total budget pill and slide ButtonSlideToConfirm
    expect(await screen.findByTestId("wizard-step-4")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("wizard-budget-pill-5000000"));

    const knob = screen.getByTestId("button-slide-to-confirm-knob");
    fireEvent.pointerDown(knob, { pointerId: 1, clientX: 0, button: 0 });
    fireEvent.pointerMove(knob, { pointerId: 1, clientX: 240 });
    fireEvent.pointerUp(knob, { pointerId: 1, clientX: 240 });

    await waitFor(
      () => {
        // 1 additional account (BCA) besides default Kas Tunai
        expect(upsertAccountSpy).toHaveBeenCalledTimes(1);
        expect(upsertAccountSpy).toHaveBeenCalledWith("book-full-setup", {
          name: "BCA",
          account_type: "BANK",
          initial_balance: 0,
        });
        // 7 default categories
        expect(upsertCategorySpy).toHaveBeenCalledTimes(7);
        // 1 Total Budget + 5 Expense Category Auto-Split Budgets = 6 upsertBudget calls
        expect(upsertBudgetSpy).toHaveBeenCalledTimes(6);
        expect(upsertBudgetSpy).toHaveBeenCalledWith("book-full-setup", {
          category_id: null,
          period: "MONTHLY",
          amount_limit: 5_000_000,
          alert_threshold_pct: 80,
        });
        expect(mockNavigate).toHaveBeenCalledWith({
          to: "/books/$bookId/dashboard",
          params: { bookId: "book-full-setup" },
        });
      },
      { timeout: 2500 }
    );
  });
});
