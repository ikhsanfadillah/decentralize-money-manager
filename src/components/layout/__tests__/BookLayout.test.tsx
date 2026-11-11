import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BookLayout } from "../BookLayout";
import { tauriApi, type BookMetadata } from "../../../lib/tauri-api";

const mockUseLocation = vi.fn(() => ({ pathname: "/books/book-123/dashboard" }));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    to,
    params,
    ...props
  }: {
    children: React.ReactNode;
    to: string;
    params?: Record<string, string>;
    [key: string]: unknown;
  }) => {
    const resolvedHref = params?.bookId
      ? to.replace("$bookId", params.bookId)
      : to;
    return (
      <a href={resolvedHref} {...props}>
        {children}
      </a>
    );
  },
  Outlet: () => <div data-testid="layout-outlet">Outlet Content</div>,
  useLocation: () => mockUseLocation(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

describe("BookLayout Top Navbar", () => {
  const bookId = "book-123";
  const bookMeta: BookMetadata = {
    id: bookId,
    name: "Kas Pribadi",
    kind: "PERSONAL",
    created_at: "2026-11-01T08:00:00.000Z",
    last_opened_at: "2026-11-09T09:00:00.000Z",
    file_exists: true,
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    window.scrollTo = vi.fn();
    mockUseLocation.mockReturnValue({ pathname: `/books/${bookId}/dashboard` });

    vi.spyOn(tauriApi, "listAccounts").mockResolvedValue([]);
    vi.spyOn(tauriApi, "listCategories").mockResolvedValue([]);
    vi.spyOn(tauriApi, "getSyncStatus").mockResolvedValue({
      book_id: bookId,
      state: "idle",
      peers: 0,
      last_synced_at: null,
    });
  });

  const renderLayout = () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    return render(
      <QueryClientProvider client={queryClient}>
        <BookLayout bookId={bookId} bookMeta={bookMeta} />
      </QueryClientProvider>
    );
  };

  it("renders Money Manager brand title, subtitle, AI Assistant toggle, and settings link", () => {
    renderLayout();

    expect(screen.getByText("Money Manager")).toBeInTheDocument();
    expect(screen.getByText("Take control of your money")).toBeInTheDocument();

    const brandLink = screen.getByText("Money Manager").closest("a");
    expect(brandLink).toHaveAttribute("href", `/books/${bookId}/dashboard`);

    const aiCopilotBtn = screen.getByTestId("navbar-ai-copilot-toggle");
    expect(aiCopilotBtn).toBeInTheDocument();

    const settingsLink = screen.getByTestId("navbar-settings-link");
    expect(settingsLink).toBeInTheDocument();
    expect(settingsLink).toHaveAttribute("href", `/books/${bookId}/settings`);
    expect(settingsLink).not.toHaveAttribute("aria-current");
  });

  it("does not render relocated book switcher, back button, sync pill, theme toggle, or privacy toggle in top navbar", () => {
    renderLayout();

    expect(
      screen.queryByLabelText("Pemilih Buku Aktif")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Kembali ke Daftar Buku")
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("sync-status-pill")).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText(/Ganti ke mode/i)
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("navbar-privacy-toggle")
    ).not.toBeInTheDocument();
  });

  it("marks settings link as current page when on settings route", () => {
    mockUseLocation.mockReturnValue({ pathname: `/books/${bookId}/settings` });
    renderLayout();

    const settingsLink = screen.getByTestId("navbar-settings-link");
    expect(settingsLink).toHaveAttribute("aria-current", "page");
  });
});

