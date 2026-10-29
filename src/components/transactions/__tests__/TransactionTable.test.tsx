import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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

  it("renders mobile-friendly transaction cards with all details and actions", () => {
    render(<TransactionTable {...defaultProps} />);

    // Mobile card for tx-1 (seamless 2-line TransactionItem)
    const mobileCard1 = screen.getByTestId("tx-mobile-card-tx-1");
    expect(mobileCard1).toBeInTheDocument();
    expect(mobileCard1).toHaveTextContent("Jajan");
    expect(mobileCard1).toHaveTextContent("Somai");
    expect(mobileCard1).toHaveTextContent("- Rp 7.000");
    expect(mobileCard1).toHaveTextContent("BCA");
    expect(mobileCard1).toHaveTextContent("2026-10-27");
    expect(mobileCard1).toHaveTextContent("#683742");

    // Click Edit on mobile card
    const editBtns = screen.getAllByRole("button", { name: "Edit" });
    fireEvent.click(editBtns[0]);
    expect(defaultProps.onEditTx).toHaveBeenCalledWith(mockTransactions[0]);

    // Click Hapus on mobile card to open confirm bottom drawer
    const hapusBtns = screen.getAllByRole("button", { name: "Hapus" });
    fireEvent.click(hapusBtns[0]);

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

  it("snaps sticky open to -140px on light left swipe and does not bounce back to 0px on post-drag click", () => {
    render(<TransactionTable {...defaultProps} />);

    const surface1 = screen.getByTestId("tx-swipe-surface-tx-1");
    expect(surface1).toHaveStyle({ transform: "translateX(0px)" });

    // 1) Simulate light mouse left swipe (25px) followed by mouseUp + synthetic browser click
    fireEvent.mouseDown(surface1, { clientX: 200, clientY: 20, button: 0 });
    fireEvent.mouseMove(window, { clientX: 175, clientY: 20 });
    fireEvent.mouseUp(window, { clientX: 175, clientY: 20 });
    fireEvent.click(surface1);

    // Must remain sticky open at -140px and NOT close from the post-drag click
    expect(surface1).toHaveStyle({ transform: "translateX(-140px)" });

    // 2) Simulate light touch swipe on tx-2 (automatically closes tx-1 and opens tx-2)
    const surface2 = screen.getByTestId("tx-swipe-surface-tx-2");
    fireEvent.touchStart(surface2, { touches: [{ clientX: 220, clientY: 20 }] });
    fireEvent.touchMove(surface2, { touches: [{ clientX: 195, clientY: 20 }] });
    fireEvent.touchEnd(surface2);
    fireEvent.click(surface2);

    expect(surface2).toHaveStyle({ transform: "translateX(-140px)" });
    expect(surface1).toHaveStyle({ transform: "translateX(0px)" });
  });
});
