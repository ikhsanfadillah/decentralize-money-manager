import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DashboardPage } from "../DashboardPage";
import { tauriApi, type TransactionView } from "../../../lib/tauri-api";
import { currentYearMonth } from "../../../lib/utils";

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

const bookId = "018f0000-0000-7000-8000-000000000055";

const sampleTransaction: TransactionView = {
  id: "tx-1",
  account_id: "acc-1",
  account_name: "BCA",
  to_account_id: null,
  to_account_name: null,
  category_id: "cat-1",
  category_name: "Gaji",
  amount: 5_000_000,
  tx_type: "INCOME",
  note: "Gaji bulanan",
  tx_date: `${currentYearMonth()}-01`,
  created_by_device: "dev-1",
  link_id: null,
  updated_hlc: "1700000000000:00001:dev-1",
};

function renderDashboard() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <DashboardPage bookId={bookId} />
    </QueryClientProvider>
  );
}

describe("DashboardPage contextual insight card", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(tauriApi, "listAccounts").mockResolvedValue([]);
    vi.spyOn(tauriApi, "listCategories").mockResolvedValue([]);
    vi.spyOn(tauriApi, "getAccountBalances").mockResolvedValue([]);
    vi.spyOn(tauriApi, "getCashFlowSummary").mockResolvedValue([]);
    vi.spyOn(tauriApi, "getBudgetProgress").mockResolvedValue([]);
    vi.spyOn(tauriApi, "listTransactions").mockResolvedValue({
      items: [],
      total: 0,
      limit: 6,
      offset: 0,
    });
    vi.spyOn(tauriApi, "listPeers").mockResolvedValue([]);
    vi.spyOn(tauriApi, "getSyncStatus").mockResolvedValue({
      book_id: bookId,
      state: "idle",
      peers: 0,
      last_synced_at: null,
    });
  });

  it("encourages adding first transaction when book has no transactions", async () => {
    renderDashboard();

    await waitFor(() => {
      expect(
        screen.getByText("Yuk, catat transaksi pertamamu")
      ).toBeInTheDocument();
    });
    expect(screen.queryByText(/SQLite|Sync P2P/i)).not.toBeInTheDocument();
  });

  it("suggests setting a budget when transactions exist but no budgets are configured", async () => {
    vi.spyOn(tauriApi, "listTransactions").mockResolvedValue({
      items: [sampleTransaction],
      total: 1,
      limit: 6,
      offset: 0,
    });

    renderDashboard();

    await waitFor(() => {
      expect(
        screen.getByText("Atur batas belanja biar lebih tenang")
      ).toBeInTheDocument();
    });
  });

  it("shows positive financial health insight when net cashflow is positive and budgets are OK", async () => {
    const month = currentYearMonth();
    vi.spyOn(tauriApi, "listTransactions").mockResolvedValue({
      items: [sampleTransaction],
      total: 1,
      limit: 6,
      offset: 0,
    });
    vi.spyOn(tauriApi, "getCashFlowSummary").mockResolvedValue([
      { month, income: 5_000_000, expense: 1_000_000, net: 4_000_000 },
    ]);
    vi.spyOn(tauriApi, "getBudgetProgress").mockResolvedValue([
      {
        id: "b-1",
        category_id: null,
        category_name: "Total Pengeluaran",
        period: "MONTHLY",
        amount_limit: 3_000_000,
        alert_threshold_pct: 80,
        spent: 1_000_000,
        remaining: 2_000_000,
        pct: 33,
        status: "OK",
        updated_hlc: "1700000000000:00001:dev-1",
      },
    ]);

    renderDashboard();

    await waitFor(() => {
      expect(
        screen.getByText("Keuangan bulan ini dalam kondisi sehat")
      ).toBeInTheDocument();
    });
  });

  it("renders non-technical privacy fallback when net is zero with existing transactions and budgets", async () => {
    const month = currentYearMonth();
    vi.spyOn(tauriApi, "listTransactions").mockResolvedValue({
      items: [sampleTransaction],
      total: 1,
      limit: 6,
      offset: 0,
    });
    vi.spyOn(tauriApi, "getCashFlowSummary").mockResolvedValue([
      { month, income: 1_000_000, expense: 1_000_000, net: 0 },
    ]);
    vi.spyOn(tauriApi, "getBudgetProgress").mockResolvedValue([
      {
        id: "b-1",
        category_id: null,
        category_name: "Total Pengeluaran",
        period: "MONTHLY",
        amount_limit: 3_000_000,
        alert_threshold_pct: 80,
        spent: 1_000_000,
        remaining: 2_000_000,
        pct: 33,
        status: "OK",
        updated_hlc: "1700000000000:00001:dev-1",
      },
    ]);

    renderDashboard();

    await waitFor(() => {
      expect(
        screen.getByText("Catatanmu hanya tersimpan di perangkat ini")
      ).toBeInTheDocument();
    });
    expect(screen.queryByText(/SQLite|Sync P2P/i)).not.toBeInTheDocument();
  });

  it("does not flash empty states or Rp 0 while initial dashboard queries are pending", async () => {
    let resolveBalances!: (v: []) => void;
    vi.spyOn(tauriApi, "getAccountBalances").mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveBalances = resolve;
        })
    );

    renderDashboard();

    expect(
      screen.queryByTestId("dashboard-total-balance")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Belum ada transaksi tercatat.")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Belum ada anggaran bulanan")
    ).not.toBeInTheDocument();

    resolveBalances([]);
    await waitFor(() => {
      expect(
        screen.getByTestId("dashboard-total-balance")
      ).toBeInTheDocument();
    });
  });
});

