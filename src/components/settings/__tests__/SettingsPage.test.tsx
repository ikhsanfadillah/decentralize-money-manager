import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SettingsPage } from "../SettingsPage";
import { SyncPage } from "../../sync/SyncPage";
import { BackupPage } from "../../backup/BackupPage";
import { tauriApi, type BookMetadata } from "../../../lib/tauri-api";
import { applyTheme } from "../../../lib/utils";

const mockNavigate = vi.fn();

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, ...props }: any) => (
    <a href={typeof to === "string" ? to : "#"} {...props}>
      {children}
    </a>
  ),
  useNavigate: () => mockNavigate,
  useRouter: () => ({
    state: { location: { pathname: "/" } },
    navigate: mockNavigate,
  }),
}));

describe("Settings, Sync, and Backup Pages", () => {
  const bookId = "test-book-123";
  const mockBook: BookMetadata = {
    id: bookId,
    name: "Kas Pribadi",
    kind: "PERSONAL",
    created_at: "2026-11-01T08:00:00.000Z",
    last_opened_at: "2026-11-09T09:00:00.000Z",
    file_exists: true,
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    mockNavigate.mockReset();

    vi.spyOn(tauriApi, "listBooks").mockResolvedValue([mockBook]);
    vi.spyOn(tauriApi, "listPeers").mockResolvedValue([]);
    vi.spyOn(tauriApi, "getDeviceIdentity").mockResolvedValue({
      device_id: "dev-01",
      device_name: "Windows PC",
    });
    vi.spyOn(tauriApi, "listAccounts").mockResolvedValue([
      {
        id: "acc-1",
        name: "Kas Tunai",
        account_type: "CASH",
        initial_balance: 500000,
        merged_into_id: null,
        root_id: "acc-1",
        is_deleted: 0,
        updated_hlc: "1:1:1",
      },
    ]);
    vi.spyOn(tauriApi, "getAccountBalances").mockResolvedValue([
      {
        account_id: "acc-1",
        name: "Kas Tunai",
        account_type: "CASH",
        initial_balance: 500000,
        current_balance: 1250000,
        merged_member_ids: [],
      },
    ]);
    vi.spyOn(tauriApi, "listCategories").mockResolvedValue([]);
    vi.spyOn(tauriApi, "getBudgetProgress").mockResolvedValue([]);
    vi.spyOn(tauriApi, "getSyncTopology").mockResolvedValue({
      book_id: bookId,
      local_node_id: "local-node-1",
      preferred_hub_node_id: null,
      active_streams: 0,
    });
    vi.spyOn(tauriApi, "getSyncStatus").mockResolvedValue({
      book_id: bookId,
      state: "idle",
      peers: 0,
      last_synced_at: null,
    });
  });

  const createQueryClient = () =>
    new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

  it("renders Settings Hub cards with active book section, Accounts, Categories, Budgets, Sync, and Backup", async () => {
    render(
      <QueryClientProvider client={createQueryClient()}>
        <SettingsPage bookId={bookId} />
      </QueryClientProvider>
    );

    expect(
      screen.getByRole("heading", { name: "Pengaturan" })
    ).toBeInTheDocument();
    expect(await screen.findByText("Kas Pribadi")).toBeInTheDocument();
    expect(screen.getByTestId("active-book-name")).toHaveTextContent(
      "Kas Pribadi"
    );
    expect(screen.getByTestId("btn-rename-book")).toBeInTheDocument();
    expect(screen.getByTestId("btn-switch-book")).toBeInTheDocument();
    expect(screen.getByTestId("settings-theme-toggle")).toBeInTheDocument();
    expect(screen.getByTestId("btn-delete-book")).toBeInTheDocument();
    expect(screen.getByTestId("settings-cta-sync")).toBeInTheDocument();
    expect(screen.getByTestId("settings-cta-backup")).toBeInTheDocument();
    expect(screen.getByText("Accounts")).toBeInTheDocument();
    expect(screen.getByText("Categories")).toBeInTheDocument();
    expect(screen.getByText("Budgets")).toBeInTheDocument();
    expect(screen.getByTestId("local-device-name")).toBeInTheDocument();
    expect(screen.getByTestId("btn-edit-device-name")).toBeInTheDocument();
  });

  it("allows renaming the active book from Settings via bottom drawer", async () => {
    const renameSpy = vi.spyOn(tauriApi, "renameBook").mockResolvedValue({
      ...mockBook,
      name: "Kas Keluarga",
    });

    render(
      <QueryClientProvider client={createQueryClient()}>
        <SettingsPage bookId={bookId} />
      </QueryClientProvider>
    );

    expect(await screen.findByText("Kas Pribadi")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("btn-rename-book"));

    const input = await screen.findByLabelText("Nama Buku Keuangan Baru");
    expect(input).toHaveValue("Kas Pribadi");

    // Submitting blank name does not call renameBook
    fireEvent.change(input, { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Simpan Perubahan" }));
    expect(renameSpy).not.toHaveBeenCalled();

    // Valid name calls renameBook with trimmed value and closes drawer
    fireEvent.change(input, { target: { value: "  Kas Keluarga  " } });
    fireEvent.click(screen.getByRole("button", { name: "Simpan Perubahan" }));

    await waitFor(() => {
      expect(renameSpy).toHaveBeenCalledWith(bookId, "Kas Keluarga");
      expect(
        screen.queryByRole("heading", { name: "Ubah Nama Buku Keuangan" })
      ).not.toBeInTheDocument();
    });
  });

  it("opens Delete Book confirmation drawer matching app pattern and cancels or confirms deleteBook", async () => {
    const deleteSpy = vi
      .spyOn(tauriApi, "deleteBook")
      .mockResolvedValue(undefined);

    render(
      <QueryClientProvider client={createQueryClient()}>
        <SettingsPage bookId={bookId} />
      </QueryClientProvider>
    );

    expect(await screen.findByText("Kas Pribadi")).toBeInTheDocument();

    // Open Delete Book confirmation dialog
    fireEvent.click(screen.getByTestId("btn-delete-book"));

    expect(await screen.findByText("Hapus Buku Ini?")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Konfirmasi Hapus Buku" })).toBeInTheDocument();
    expect(screen.getByTestId("confirm-delete-book-button")).toBeInTheDocument();

    // Cancel closes confirmation drawer without deleting
    fireEvent.click(screen.getByRole("button", { name: "Batal" }));
    await waitFor(() => {
      expect(screen.queryByText("Hapus Buku Ini?")).not.toBeInTheDocument();
    });
    expect(deleteSpy).not.toHaveBeenCalled();

    // Re-open and confirm delete
    fireEvent.click(screen.getByTestId("btn-delete-book"));
    const confirmBtn = await screen.findByTestId("confirm-delete-book-button");
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(deleteSpy).toHaveBeenCalledWith(bookId);
      expect(mockNavigate).toHaveBeenCalledWith({ to: "/" });
    });
  });

  it("relocates Switch Book to Settings drawer and allows switching books or opening all books list", async () => {
    const secondBook: BookMetadata = {
      id: "book-456",
      name: "Kas Usaha",
      kind: "BUSINESS",
      created_at: "2026-11-02T08:00:00.000Z",
      last_opened_at: "2026-11-08T09:00:00.000Z",
      file_exists: true,
    };
    vi.spyOn(tauriApi, "listBooks").mockResolvedValue([mockBook, secondBook]);
    const closeSpy = vi
      .spyOn(tauriApi, "closeBook")
      .mockResolvedValue(undefined);

    render(
      <QueryClientProvider client={createQueryClient()}>
        <SettingsPage bookId={bookId} />
      </QueryClientProvider>
    );

    expect(await screen.findByText("Kas Pribadi")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("btn-switch-book"));

    expect(
      await screen.findByRole("heading", { name: "Ganti Buku Keuangan" })
    ).toBeInTheDocument();
    expect(screen.getByTestId(`switch-book-item-${bookId}`)).toBeInTheDocument();
    expect(
      screen.getByTestId(`switch-book-item-${secondBook.id}`)
    ).toBeInTheDocument();

    // Switch to second book
    fireEvent.click(screen.getByTestId(`switch-book-item-${secondBook.id}`));

    await waitFor(() => {
      expect(closeSpy).toHaveBeenCalledWith(bookId);
      expect(mockNavigate).toHaveBeenCalledWith({
        to: "/books/$bookId/dashboard",
        params: { bookId: secondBook.id },
      });
    });

    // Re-open drawer and navigate to all books list ("/")
    fireEvent.click(screen.getByTestId("btn-switch-book"));
    const allBooksBtn = await screen.findByTestId("btn-view-all-books");
    fireEvent.click(allBooksBtn);

    await waitFor(() => {
      expect(mockNavigate).toHaveBeenCalledWith({ to: "/" });
    });
  });

  it("relocates Dark Mode toggle to Settings and persists theme changes", () => {
    window.localStorage.removeItem("dmm-theme-mode");
    applyTheme("dark");

    render(
      <QueryClientProvider client={createQueryClient()}>
        <SettingsPage bookId={bookId} />
      </QueryClientProvider>
    );

    const toggle = screen.getByTestId("settings-theme-toggle");
    expect(toggle).toHaveAttribute("role", "switch");
    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(window.localStorage.getItem("dmm-theme-mode")).toBe("light");

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-checked", "true");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(window.localStorage.getItem("dmm-theme-mode")).toBe("dark");
  });

  it("renders SyncPage with connected peer label and opens edit alias dialog", async () => {
    vi.spyOn(tauriApi, "listPeers").mockResolvedValue([
      {
        node_id: "node-alpha-123456",
        device_id: "dev-05817910",
        last_seen_at: new Date().toISOString(),
        device_name: "Laptop Kantor Budi",
        custom_alias: null,
        is_online: true,
        is_preferred_hub: false,
      },
    ]);

    render(
      <QueryClientProvider client={createQueryClient()}>
        <SyncPage bookId={bookId} />
      </QueryClientProvider>
    );

    expect(await screen.findByText("Laptop Kantor Budi")).toBeInTheDocument();
    expect(screen.getByText("ID: dev-0581")).toBeInTheDocument();
    expect(
      screen.getByTestId("btn-edit-alias-node-alpha-123456")
    ).toBeInTheDocument();
  });

  it("renders SyncPage as an independent page for P2P synchronization", () => {
    render(
      <QueryClientProvider client={createQueryClient()}>
        <SyncPage bookId={bookId} />
      </QueryClientProvider>
    );

    expect(screen.getByText("Sinkronisasi Antar-Perangkat")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Buat Kode Undangan/i })
    ).toBeInTheDocument();
    expect(screen.getByTestId("btn-manual-sync")).toBeInTheDocument();
  });

  it("renders BackupPage as an independent page with encrypted backup form", () => {
    render(
      <QueryClientProvider client={createQueryClient()}>
        <BackupPage bookId={bookId} />
      </QueryClientProvider>
    );

    expect(screen.getByText("Cadangan Buku Terenkripsi")).toBeInTheDocument();
    expect(
      screen.getByLabelText("Lokasi & Nama File Cadangan")
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Kata Sandi Cadangan")).toBeInTheDocument();
    expect(screen.getByLabelText("Ulangi Kata Sandi")).toBeInTheDocument();
    expect(
      screen.getByTestId("button-slide-to-confirm")
    ).toBeInTheDocument();
  });
});
