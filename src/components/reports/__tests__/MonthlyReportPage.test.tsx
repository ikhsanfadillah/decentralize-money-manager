import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MonthlyReportPage } from "../MonthlyReportPage";
import {
  tauriApi,
  type MonthlyReportResponse,
} from "../../../lib/tauri-api";

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
}));

describe("MonthlyReportPage & Interactive Charts", () => {
  const bookId = "018f0000-0000-7000-8000-000000000099";

  const mockReport: MonthlyReportResponse = {
    month: "2026-10",
    prev_month: "2026-09",
    days_in_month: 31,
    elapsed_days: 27,
    no_spend_days: 15,
    tx_count: 8,
    operational_income: 12_000_000,
    operational_expense: 3_000_000,
    operational_net: 9_000_000,
    prev_operational_income: 10_000_000,
    prev_operational_expense: 2_500_000,
    capital_injection: 1_000_000,
    capital_withdrawal: 500_000,
    savings_rate_bps: 7500,
    daily_burn_rate: 111_111,
    projected_month_expense: 3_444_441,
    total_budget_limit: 5_000_000,
    daily_series: Array.from({ length: 31 }, (_, idx) => {
      const day = idx + 1;
      const inc = day === 1 ? 12_000_000 : 0;
      const exp = day === 5 ? 1_800_000 : day === 12 ? 1_200_000 : 0;
      return {
        date: `2026-10-${String(day).padStart(2, "0")}`,
        day,
        income: inc,
        expense: exp,
        net: inc - exp,
        cumulative_income: 12_000_000,
        cumulative_expense: day < 5 ? 0 : day < 12 ? 1_800_000 : 3_000_000,
        tx_count: inc > 0 || exp > 0 ? 1 : 0,
      };
    }),
    category_breakdown: [
      {
        category_id: "cat-makan",
        category_name: "Makan & Minum",
        kind: "EXPENSE",
        is_system: false,
        current_amount: 1_800_000,
        prev_amount: 1_500_000,
        delta_amount: 300_000,
        delta_pct: 20,
        share_bps: 6000,
        tx_count: 5,
      },
      {
        category_id: "cat-trans",
        category_name: "Transportasi",
        kind: "EXPENSE",
        is_system: false,
        current_amount: 1_200_000,
        prev_amount: 1_000_000,
        delta_amount: 200_000,
        delta_pct: 20,
        share_bps: 4000,
        tx_count: 3,
      },
    ],
    account_reconciliation: [
      {
        account_id: "acc-bca",
        account_name: "BCA Utama",
        account_type: "BANK",
        opening_balance: 5_000_000,
        month_inflow: 13_000_000,
        month_outflow: 3_500_000,
        net_change: 9_500_000,
        closing_balance: 14_500_000,
        tx_count: 8,
      },
    ],
    device_contributions: [
      {
        device_id: "dev-alpha",
        tx_count: 8,
        total_income: 13_000_000,
        total_expense: 3_500_000,
        share_bps: 10000,
      },
    ],
    top_expenses: [
      {
        id: "tx-1",
        account_id: "acc-bca",
        account_name: "BCA Utama",
        to_account_id: null,
        to_account_name: null,
        category_id: "cat-makan",
        category_name: "Makan & Minum",
        amount: -1_800_000,
        tx_type: "EXPENSE",
        note: "Katering Kantor",
        tx_date: "2026-10-05",
        created_by_device: "dev-alpha",
        link_id: null,
        updated_hlc: "1700000000000:00001:dev-alpha",
      },
    ],
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(tauriApi, "listAccounts").mockResolvedValue([]);
    vi.spyOn(tauriApi, "listCategories").mockResolvedValue([]);
    vi.spyOn(tauriApi, "listTransactions").mockResolvedValue({
      items: mockReport.top_expenses,
      total: 1,
      limit: 15,
      offset: 0,
    });
    vi.spyOn(tauriApi, "getAccountBalances").mockResolvedValue([]);
    vi.spyOn(tauriApi, "getCashFlowSummary").mockResolvedValue([]);
    vi.spyOn(tauriApi, "getBudgetProgress").mockResolvedValue([]);
    vi.spyOn(tauriApi, "listPeers").mockResolvedValue([]);
    vi.spyOn(tauriApi, "getSyncStatus").mockResolvedValue({
      book_id: bookId,
      state: "idle",
      peers: 0,
      last_synced_at: null,
    });
    vi.spyOn(tauriApi, "getMonthlyReport").mockResolvedValue(mockReport);
  });

  it("renders KPIs, interactive charts, account reconciliation, and supports category drill-down", async () => {
    const user = userEvent.setup();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <MonthlyReportPage bookId={bookId} />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(
        screen.getByTestId("report-operational-income")
      ).toHaveTextContent("Rp 12.000.000");
    });

    expect(screen.getByTestId("report-savings-rate-badge")).toHaveTextContent(
      "SAVINGS RATE: 75.0%"
    );
    expect(
      screen.getByTestId("interactive-cashflow-chart")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("interactive-category-chart")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("account-reconciliation-table")
    ).toHaveTextContent("Rp 14.500.000");

    // Switch cashflow chart to Cumulative Burn mode
    await user.click(
      screen.getByRole("button", { name: "Akumulasi & Laju Anggaran" })
    );
    expect(screen.getByTestId("cashflow-hud-readout")).toHaveTextContent(
      "Kumulatif Keluar:"
    );

    // Click on category row to trigger interactive drill-down filter
    await user.click(screen.getByTestId("report-category-row-cat-makan"));
    await waitFor(() => {
      expect(
        screen.getByText("Hasil Filter Interaktif Grafik (Drill-Down Transaksi)")
      ).toBeInTheDocument();
    });
  });
});
