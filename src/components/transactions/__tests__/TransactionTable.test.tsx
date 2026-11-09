import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { TransactionTable } from "../TransactionTable";
import type { TransactionView } from "../../../lib/tauri-api";

describe("TransactionTable (Mobile Friendly & Responsive)", () => {
  const mockTransactions: TransactionView[] = [
    {
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
    },
    {
      id: "tx-2",
      account_id: "acc-1",
      account_name: "BCA",
      category_id: "cat-2",
      category_name: "Gaji",
      tx_date: "2026-10-27",
      tx_type: "INCOME",
      amount: 9500000,
      note: "Gaji Pokok",
      to_account_id: null,
      to_account_name: null,
      link_id: null,
      created_by_device: "68374230dev",
      updated_hlc: "1:1:2",
    },
  ];

  const defaultProps = {
    items: mockTransactions,
    total: 2,
    filter: { limit: 25, offset: 0, sort_by: "tx_date" as const, sort_dir: "desc" as const },
    accounts: [],
    categories: [],
    isLoading: false,
    onFilterChange: vi.fn(),
    onResetFilter: vi.fn(),
    onEditTx: vi.fn(),
    onDeleteTx: vi.fn(),
    onOpenNewTx: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders clickable mobile transaction cards without swipe-to-reveal actions and supports desktop actions", () => {
    render(<TransactionTable {...defaultProps} />);

    // Mobile card for tx-1 (simple clickable 2-line TransactionItem, no swipe surface)
    const mobileCard1 = screen.getByTestId("tx-mobile-card-tx-1");
    expect(mobileCard1).toBeInTheDocument();
    expect(mobileCard1).toHaveTextContent("Jajan");
    expect(mobileCard1).toHaveTextContent("Somai");
    expect(mobileCard1).toHaveTextContent("−Rp 7.000");
    expect(mobileCard1).toHaveTextContent("BCA");
    expect(mobileCard1).toHaveTextContent("2026-10-27");
    expect(mobileCard1).toHaveTextContent("#683742");
    expect(screen.queryByTestId("tx-swipe-surface-tx-1")).not.toBeInTheDocument();
    expect(within(mobileCard1).queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(within(mobileCard1).queryByRole("button", { name: "Hapus" })).not.toBeInTheDocument();

    // Clicking mobile card opens edit/detail directly
    fireEvent.click(mobileCard1);
    expect(defaultProps.onEditTx).toHaveBeenCalledTimes(1);
    expect(defaultProps.onEditTx).toHaveBeenLastCalledWith(mockTransactions[0]);

    // Keyboard Enter/Space on mobile card also opens edit/detail
    fireEvent.keyDown(mobileCard1, { key: "Enter" });
    expect(defaultProps.onEditTx).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(mobileCard1, { key: " " });
    expect(defaultProps.onEditTx).toHaveBeenCalledTimes(3);

    // Desktop row actions still work cleanly without double-triggering row click
    const editBtns = screen.getAllByRole("button", { name: "Edit" });
    fireEvent.click(editBtns[0]);
    expect(defaultProps.onEditTx).toHaveBeenCalledTimes(4);

    // Click Hapus on desktop row to open confirm bottom drawer (does not trigger onEditTx)
    const hapusBtns = screen.getAllByRole("button", { name: "Hapus" });
    fireEvent.click(hapusBtns[0]);
    expect(defaultProps.onEditTx).toHaveBeenCalledTimes(4);

    // Confirm in the bottom drawer popup
    const confirmBtn = screen.getByRole("button", { name: "Hapus Transaksi" });
    expect(screen.getByText("Hapus Transaksi Ini?")).toBeInTheDocument();
    fireEvent.click(confirmBtn);
    expect(defaultProps.onDeleteTx).toHaveBeenCalledWith("tx-1");
  });

  it("renders empty state correctly when no transactions match filter", () => {
    render(<TransactionTable {...defaultProps} items={[]} total={0} />);
    expect(
      screen.getAllByText("Tidak ada transaksi yang cocok dengan filter saat ini.")
    ).toHaveLength(2); // One for mobile list, one for desktop table
  });

  it("opens filter drawer/modal when Filter button is clicked and closes on ESC or Terapkan", () => {
    render(<TransactionTable {...defaultProps} />);

    // Filter dialog should not be in document initially
    expect(screen.queryByRole("dialog", { name: "Filter Transaksi" })).not.toBeInTheDocument();

    // Click Filter button
    const filterBtn = screen.getByTestId("filter-open-button");
    fireEvent.click(filterBtn);

    // Dialog should be visible
    const dialog = screen.getByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText("Filter Transaksi")).toBeInTheDocument();
    expect(screen.getByText("Pencarian Kata Kunci")).toBeInTheDocument();

    // Click Terapkan & Selesai to close
    const applyBtn = screen.getByRole("button", { name: "Terapkan & Selesai" });
    fireEvent.click(applyBtn);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("opens edit/detail directly on mobile card click and desktop row click without swipe gesture", () => {
    render(<TransactionTable {...defaultProps} />);

    // No swipe surfaces exist for any item
    expect(screen.queryByTestId("tx-swipe-surface-tx-1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("tx-swipe-surface-tx-2")).not.toBeInTheDocument();

    // Clicking mobile card tx-2 triggers onEditTx with tx-2
    const mobileCard2 = screen.getByTestId("tx-mobile-card-tx-2");
    fireEvent.click(mobileCard2);
    expect(defaultProps.onEditTx).toHaveBeenCalledWith(mockTransactions[1]);

    // Clicking desktop row tx-1 triggers onEditTx with tx-1
    const desktopRow1 = screen.getByTestId("tx-desktop-row-tx-1");
    fireEvent.click(desktopRow1);
    expect(defaultProps.onEditTx).toHaveBeenCalledWith(mockTransactions[0]);
  });

  it("opens sort drawer on mobile sort button click and updates sorting on selection", () => {
    const onFilterChange = vi.fn();
    render(<TransactionTable {...defaultProps} onFilterChange={onFilterChange} />);

    // Mobile sort icon button
    const sortBtn = screen.getByTestId("sort-open-button");
    expect(sortBtn).toBeInTheDocument();
    fireEvent.click(sortBtn);

    // Sort drawer should now be visible with options
    expect(screen.getByText("Urutkan Transaksi")).toBeInTheDocument();
    expect(screen.getByText("Tanggal Terbaru")).toBeInTheDocument();
    expect(screen.getByText("Nominal Terbesar")).toBeInTheDocument();

    // Select "Nominal Terbesar"
    const nominalTerbesarBtn = screen.getByRole("button", { name: /Nominal Terbesar/i });
    fireEvent.click(nominalTerbesarBtn);

    expect(onFilterChange).toHaveBeenCalledWith(expect.any(Function));

    // Verify updater function produces correct filter payload
    const updater = onFilterChange.mock.calls[0][0];
    const updated = updater({ sort_by: "tx_date", sort_dir: "desc", offset: 10 });
    expect(updated).toEqual({
      sort_by: "amount",
      sort_dir: "desc",
      offset: 0,
    });
  });

  it("renders full width transaction CTA button and triggers onOpenNewTx on mobile", () => {
    const onOpenNewTx = vi.fn();
    render(<TransactionTable {...defaultProps} onOpenNewTx={onOpenNewTx} />);

    const ctaBtns = screen.getAllByRole("button", { name: /Catat Transaksi/i });
    // Expect mobile full-width button to exist
    const mobileCtaBtn = ctaBtns.find((btn) => btn.className.includes("w-full"));
    expect(mobileCtaBtn).toBeDefined();

    fireEvent.click(mobileCtaBtn!);
    expect(onOpenNewTx).toHaveBeenCalledTimes(1);
  });

  it("closes sort drawer using the icon close button and supports reset sort in drawer", () => {
    const onFilterChange = vi.fn();
    render(
      <TransactionTable
        {...defaultProps}
        filter={{ ...defaultProps.filter, sort_by: "amount", sort_dir: "asc" }}
        onFilterChange={onFilterChange}
      />
    );

    // Open sort drawer
    fireEvent.click(screen.getByTestId("sort-open-button"));
    expect(screen.getByText("Urutkan Transaksi")).toBeInTheDocument();

    // Click Reset Urutan button inside sort drawer
    const resetUrutanBtn = screen.getByRole("button", { name: /Reset Urutan/i });
    fireEvent.click(resetUrutanBtn);

    expect(onFilterChange).toHaveBeenCalled();
    const updater = onFilterChange.mock.calls[0][0];
    const resetResult = updater({ sort_by: "amount", sort_dir: "asc", offset: 5 });
    expect(resetResult).toEqual({
      sort_by: "tx_date",
      sort_dir: "desc",
      offset: 0,
    });
  });

  it("triggers reset filter and sort from toolbar reset button", () => {
    const onResetFilter = vi.fn();
    const onFilterChange = vi.fn();
    render(
      <TransactionTable
        {...defaultProps}
        filter={{ ...defaultProps.filter, search: "somai", sort_by: "amount" }}
        onResetFilter={onResetFilter}
        onFilterChange={onFilterChange}
      />
    );

    // Reset button should be visible when filter or sort is active
    const resetMobileBtn = screen.getByTestId("reset-filter-sort-mobile-button");
    expect(resetMobileBtn).toBeInTheDocument();
    fireEvent.click(resetMobileBtn);

    expect(onResetFilter).toHaveBeenCalledTimes(1);
    expect(onFilterChange).toHaveBeenCalled();
    const updater = onFilterChange.mock.calls[0][0];
    expect(updater({})).toEqual({
      sort_by: "tx_date",
      sort_dir: "desc",
      offset: 0,
    });
  });

  it("replaces page-number pagination controls with scroll sentinel footer", () => {
    render(
      <TransactionTable
        {...defaultProps}
        total={50}
        hasNextPage={true}
      />
    );

    expect(
      screen.queryByRole("button", { name: /Sebelumnya/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Berikutnya/i })
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/Halaman \d+/)).not.toBeInTheDocument();

    const sentinel = screen.getByTestId("tx-scroll-sentinel");
    expect(sentinel).toHaveTextContent("Menampilkan 2 dari 50 transaksi");
    expect(sentinel).toHaveTextContent("Gulir untuk memuat lainnya");
  });

  it("triggers onLoadMore on window scroll and prevents duplicate calls while in-flight", () => {
    const onLoadMore = vi.fn();
    const { rerender } = render(
      <TransactionTable
        {...defaultProps}
        total={50}
        hasNextPage={true}
        isFetchingNextPage={false}
        onLoadMore={onLoadMore}
      />
    );

    fireEvent.scroll(window);
    expect(onLoadMore).toHaveBeenCalledTimes(1);

    // Rapid follow-up scroll before state settles must not spam onLoadMore
    fireEvent.scroll(window);
    expect(onLoadMore).toHaveBeenCalledTimes(1);

    // Loading state renders spinner text
    rerender(
      <TransactionTable
        {...defaultProps}
        total={50}
        hasNextPage={true}
        isFetchingNextPage={true}
        onLoadMore={onLoadMore}
      />
    );
    expect(screen.getByTestId("tx-scroll-sentinel")).toHaveTextContent(
      "Memuat transaksi berikutnya..."
    );

    // Settling fetch allows subsequent scroll to trigger next page
    rerender(
      <TransactionTable
        {...defaultProps}
        total={50}
        hasNextPage={true}
        isFetchingNextPage={false}
        onLoadMore={onLoadMore}
      />
    );
    fireEvent.scroll(window);
    expect(onLoadMore).toHaveBeenCalledTimes(2);
  });

  it("triggers onLoadMore via IntersectionObserver when sentinel intersects viewport", () => {
    const callbacks: IntersectionObserverCallback[] = [];
    const observe = vi.fn();
    const disconnect = vi.fn();

    class MockIntersectionObserver implements IntersectionObserver {
      readonly root = null;
      readonly rootMargin = "240px 0px";
      readonly scrollMargin = "0px";
      readonly thresholds = [0];
      constructor(cb: IntersectionObserverCallback) {
        callbacks.push(cb);
      }
      observe = observe;
      disconnect = disconnect;
      unobserve = vi.fn();
      takeRecords = vi.fn(() => []);
    }

    vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
    try {
      const onLoadMore = vi.fn();
      render(
        <TransactionTable
          {...defaultProps}
          total={50}
          hasNextPage={true}
          onLoadMore={onLoadMore}
        />
      );

      expect(observe).toHaveBeenCalledTimes(1);
      callbacks[0](
        [
          {
            isIntersecting: true,
          } as IntersectionObserverEntry,
        ],
        {} as IntersectionObserver
      );
      expect(onLoadMore).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("shows manual retry button on load-more error and completion message when all items loaded", () => {
    const onLoadMore = vi.fn();
    const { rerender } = render(
      <TransactionTable
        {...defaultProps}
        total={50}
        hasNextPage={true}
        isLoadMoreError={true}
        onLoadMore={onLoadMore}
      />
    );

    // Scroll should not auto-loop when in error state
    fireEvent.scroll(window);
    expect(onLoadMore).not.toHaveBeenCalled();

    const retryBtn = screen.getByRole("button", {
      name: /Gagal memuat · Ketuk untuk coba lagi/i,
    });
    fireEvent.click(retryBtn);
    expect(onLoadMore).toHaveBeenCalledTimes(1);

    rerender(
      <TransactionTable
        {...defaultProps}
        total={2}
        hasNextPage={false}
        isLoadMoreError={false}
        onLoadMore={onLoadMore}
      />
    );
    expect(screen.getByTestId("tx-scroll-sentinel")).toHaveTextContent(
      "Semua transaksi telah ditampilkan"
    );
  });
});
