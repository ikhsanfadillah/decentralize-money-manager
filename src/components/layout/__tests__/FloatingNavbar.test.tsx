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
  it("renders the 4 navigation items and center neutral CTA FAB button with correct labels and accessibility attributes", () => {
    const onAdd = vi.fn();
    render(<FloatingNavbar bookId="book-123" onAddTransaction={onAdd} />);

    // Verify nav accessibility
    const nav = screen.getByRole("navigation", { name: "Navigasi Buku" });
    expect(nav).toBeInTheDocument();

    // Verify 4 symmetric navigation items around the center FAB
    expect(screen.getByText("Home")).toBeInTheDocument();
    expect(screen.getByText("Transaksi")).toBeInTheDocument();
    expect(screen.getByText("Laporan")).toBeInTheDocument();
    expect(screen.getByText("Anggaran")).toBeInTheDocument();

    // Verify the + FAB button
    const fabButton = screen.getByTestId("fab-add-transaction");
    expect(fabButton).toBeInTheDocument();
    expect(fabButton).toHaveAttribute("aria-label", "Tambah Transaksi Baru");
    expect(fabButton.className).toContain("floating-navbar-fab");
    expect(fabButton.className).toContain("bg-cta-surface");
    expect(fabButton.className).toContain("text-cta-foreground");

    // Click FAB button
    fireEvent.click(fabButton);
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it("applies active styles and aria-current indicator to the active route item", () => {
    mockUseLocation.mockReturnValue({
      pathname: "/books/book-123/transactions",
    });

    render(<FloatingNavbar bookId="book-123" onAddTransaction={vi.fn()} />);

    const txLink = screen.getByText("Transaksi").closest("a");
    expect(txLink).toHaveAttribute("href", "/books/book-123/transactions");
    expect(txLink).toHaveAttribute("aria-current", "page");
    expect(txLink?.className).toContain("text-foreground");

    const homeLink = screen.getByText("Home").closest("a");
    expect(homeLink).not.toHaveAttribute("aria-current");
    expect(homeLink?.className).toContain("text-muted-foreground");
  });

  it("uses Neutral Zinc capsule dock tokens on navigation container and links", () => {
    mockUseLocation.mockReturnValue({
      pathname: "/books/book-123/transactions",
    });

    render(<FloatingNavbar bookId="book-123" onAddTransaction={vi.fn()} />);

    const nav = screen.getByRole("navigation", { name: "Navigasi Buku" });
    expect(nav.className).toContain("floating-navbar-pill");
    expect(nav.className).toContain("bg-dock");
    expect(nav.className).toContain("border-border");
    expect(nav.className).toContain("rounded-full");

    const txLink = screen.getByText("Transaksi").closest("a");
    expect(txLink?.className).toContain("text-foreground");

    const homeLink = screen.getByText("Home").closest("a");
    expect(homeLink?.className).toContain("text-muted-foreground");
  });
});

