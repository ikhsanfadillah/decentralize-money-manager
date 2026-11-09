import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BookSwitcherPage } from "../BookSwitcherPage";
import { tauriApi, type BookMetadata } from "../../../lib/tauri-api";

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
  useNavigate: () => vi.fn(),
}));

describe("BookSwitcherPage - Clean Book List View", () => {
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

  it("opens Create Book drawer when Buat Buku button is clicked and closes cleanly", async () => {
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
      expect(screen.getByText("Geser untuk Buat Buku")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "Tutup" }));

    await waitFor(() => {
      expect(
        screen.queryByRole("heading", { name: "Buat Buku Keuangan Baru" })
      ).not.toBeInTheDocument();
    });
  });
});
