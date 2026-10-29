import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FloatingNavbar } from "../FloatingNavbar";

const mockUseLocation = vi.fn(() => ({ pathname: "/books/book-123/dashboard" }));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    className,
    params,
    ...props
  }: {
    children: React.ReactNode;
    to: string;
    className?: string;
    params?: Record<string, string>;
  }) => {
    const resolvedHref = params?.bookId
      ? to.replace("$bookId", params.bookId)
      : to;
    return (
      <a href={resolvedHref} className={className} {...props}>
        {children}
      </a>
    );
  },
  useLocation: () => mockUseLocation(),
}));

describe("FloatingNavbar", () => {
  it("renders the 4 navigation items and action button with correct labels and accessibility attributes", () => {
    const onAdd = vi.fn();
    render(<FloatingNavbar bookId="book-123" onAddTransaction={onAdd} />);

    // Verify nav accessibility
    const nav = screen.getByRole("navigation", { name: "Navigasi Buku" });
    expect(nav).toBeInTheDocument();

    // Verify 4 navigation items are present
    expect(screen.getByText("Home")).toBeInTheDocument();
    expect(screen.getByText("Transactions")).toBeInTheDocument();
    expect(screen.getByText("Reports")).toBeInTheDocument();
    expect(screen.getByText("Settings")).toBeInTheDocument();

    // Verify the + FAB button
    const fabButton = screen.getByTestId("fab-add-transaction");
    expect(fabButton).toBeInTheDocument();
    expect(fabButton).toHaveAttribute("aria-label", "Tambah Transaksi Baru");

    // Click FAB button
    fireEvent.click(fabButton);
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it("applies active styles and indicator to the active route item", () => {
    mockUseLocation.mockReturnValue({
      pathname: "/books/book-123/transactions",
    });

    render(<FloatingNavbar bookId="book-123" onAddTransaction={vi.fn()} />);

    const txLink = screen.getByText("Transactions").closest("a");
    expect(txLink).toHaveAttribute("href", "/books/book-123/transactions");
    expect(txLink?.className).toContain("bg-emerald-50/80");

    const homeLink = screen.getByText("Home").closest("a");
    expect(homeLink?.className).not.toContain("bg-emerald-50/80");
  });
});

