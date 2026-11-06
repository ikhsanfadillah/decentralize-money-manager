import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BookSwitcherPage } from "../BookSwitcherPage";
import { tauriApi, type BookMetadata } from "../../../lib/tauri-api";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, ...props }: { children: React.ReactNode }) => (
    <a {...props}>{children}</a>
  ),
  useNavigate: () => vi.fn(),
}));

describe("BookSwitcherPage - Rename Book in Drawer", () => {
  const mockBooks: BookMetadata[] = [
    {
      id: "book-001",
      name: "Uang Pribadi",
      kind: "PERSONAL",
      file_exists: true,
      last_opened_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
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

  it("renders books list without inline input and opens drawer on Ubah Nama click", async () => {
    render(
      <QueryClientProvider client={createQueryClient()}>
        <BookSwitcherPage />
      </QueryClientProvider>
    );

    // Book name rendered cleanly in list
    expect(await screen.findByText("Uang Pribadi")).toBeInTheDocument();

    // Verify there is NO inline input in the row
    expect(screen.queryByLabelText("Nama Buku Baru")).not.toBeInTheDocument();

    // Click "Ubah Nama"
    const renameButton = screen.getByRole("button", { name: "Ubah Nama" });
    fireEvent.click(renameButton);

    // Verify the drawer is opened
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Ubah Nama Buku Keuangan" })
      ).toBeInTheDocument();
      const input = screen.getByLabelText("Nama Buku Keuangan Baru");
      expect(input).toBeInTheDocument();
      expect(input).toHaveValue("Uang Pribadi");
      expect(screen.getByText("Geser untuk Ubah Nama")).toBeInTheDocument();
    });
  });

  it("closes rename drawer when close button is clicked", async () => {
    render(
      <QueryClientProvider client={createQueryClient()}>
        <BookSwitcherPage />
      </QueryClientProvider>
    );

    expect(await screen.findByText("Uang Pribadi")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Ubah Nama" }));

    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Ubah Nama Buku Keuangan" })
      ).toBeInTheDocument();
    });

    const closeButton = screen.getByRole("button", { name: "Tutup" });
    fireEvent.click(closeButton);

    await waitFor(() => {
      expect(
        screen.queryByRole("heading", { name: "Ubah Nama Buku Keuangan" })
      ).not.toBeInTheDocument();
    });
  });
});
