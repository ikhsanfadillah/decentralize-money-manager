import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SettingsPage } from "../SettingsPage";
import { SyncPage } from "../../sync/SyncPage";
import { BackupPage } from "../../backup/BackupPage";
import { tauriApi } from "../../../lib/tauri-api";

describe("Settings, Sync, and Backup Pages", () => {
  const bookId = "test-book-123";

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(tauriApi, "listPeers").mockResolvedValue([]);
    vi.spyOn(tauriApi, "listAccounts").mockResolvedValue([]);
    vi.spyOn(tauriApi, "getAccountBalances").mockResolvedValue([]);
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

  it("renders Settings Hub cards with Links for Accounts, Categories, Budgets, Sync, and Backup", () => {
    render(
      <QueryClientProvider client={createQueryClient()}>
        <SettingsPage bookId={bookId} />
      </QueryClientProvider>
    );

    expect(
      screen.getByText("Pusat Pengaturan & Konfigurasi Buku")
    ).toBeInTheDocument();
    expect(screen.getByTestId("settings-cta-sync")).toBeInTheDocument();
    expect(screen.getByTestId("settings-cta-backup")).toBeInTheDocument();
    expect(screen.getByText("Manajemen Akun Keuangan")).toBeInTheDocument();
    expect(screen.getByText("Kategori Transaksi")).toBeInTheDocument();
    expect(screen.getByText("Anggaran Bulanan")).toBeInTheDocument();
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
