import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BudgetsPage } from "../BudgetsPage";
import {
  tauriApi,
  type BudgetProgressItem,
  type CategoryView,
  type CrdtSyncedPayload,
} from "../../../lib/tauri-api";

type EventCallback<T> = (event: { payload: T }) => void;
const eventListeners = new Map<string, Set<EventCallback<unknown>>>();

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((eventName: string, handler: EventCallback<unknown>) => {
    let set = eventListeners.get(eventName);
    if (!set) {
      set = new Set();
      eventListeners.set(eventName, set);
    }
    set.add(handler);
    return Promise.resolve(() => {
      set?.delete(handler);
    });
  }),
}));

function emitMockTauriEvent<T>(eventName: string, payload: T): void {
  const listeners = eventListeners.get(eventName);
  if (!listeners) return;
  for (const fn of listeners) {
    fn({ payload });
  }
}

describe("BudgetsPage (Section 8.2 & 10.2)", () => {
  const bookId = "018f0000-0000-7000-8000-000000000001";

  const mockCategories: CategoryView[] = [
    {
      id: "cat-food",
      name: "Makan & Minum",
      normalized_name: "makan & minum",
      kind: "EXPENSE",
      merged_into_id: null,
      canonical_id: "cat-food",
      is_deleted: 0,
      updated_hlc: "1700000000000:00000001:dev1",
    },
    {
      id: "cat-transport",
      name: "Transportasi",
      normalized_name: "transportasi",
      kind: "EXPENSE",
      merged_into_id: null,
      canonical_id: "cat-transport",
      is_deleted: 0,
      updated_hlc: "1700000000000:00000002:dev1",
    },
  ];

  const initialBudgets: BudgetProgressItem[] = [
    {
      id: "b-all",
      category_id: null,
      category_name: "Total Pengeluaran",
      period: "MONTHLY",
      amount_limit: 5_000_000,
      alert_threshold_pct: 80,
      spent: 2_000_000,
      remaining: 3_000_000,
      pct: 40,
      status: "OK",
      updated_hlc: "1700000000000:00000001:dev1",
    },
    {
      id: "b-food",
      category_id: "cat-food",
      category_name: "Makan & Minum",
      period: "MONTHLY",
      amount_limit: 1_500_000,
      alert_threshold_pct: 80,
      spent: 1_275_000,
      remaining: 225_000,
      pct: 85,
      status: "WARNING",
      updated_hlc: "1700000000000:00000002:dev1",
    },
    {
      id: "b-transport",
      category_id: "cat-transport",
      category_name: "Transportasi",
      period: "MONTHLY",
      amount_limit: 500_000,
      alert_threshold_pct: 80,
      spent: 650_000,
      remaining: -150_000,
      pct: 130,
      status: "OVER",
      updated_hlc: "1700000000000:00000003:dev1",
    },
  ];

  beforeEach(() => {
    eventListeners.clear();
    vi.restoreAllMocks();

    vi.spyOn(tauriApi, "listAccounts").mockResolvedValue([]);
    vi.spyOn(tauriApi, "listCategories").mockResolvedValue(mockCategories);
    vi.spyOn(tauriApi, "listTransactions").mockResolvedValue({
      items: [],
      total: 0,
      limit: 25,
      offset: 0,
    });
    vi.spyOn(tauriApi, "getAccountBalances").mockResolvedValue([]);
    vi.spyOn(tauriApi, "getCashFlowSummary").mockResolvedValue([]);
    vi.spyOn(tauriApi, "listPeers").mockResolvedValue([]);
    vi.spyOn(tauriApi, "getSyncStatus").mockResolvedValue({
      book_id: bookId,
      state: "idle",
      peers: 0,
      last_synced_at: null,
    });
  });

  function createTestQueryClient(): QueryClient {
    return new QueryClient({
      defaultOptions: {
        queries: {
          retry: false,
          staleTime: 60_000,
        },
      },
    });
  }

  it("renders status colors paired with explicit accessibility text labels (OK, WARNING, OVER)", async () => {
    vi.spyOn(tauriApi, "getBudgetProgress").mockResolvedValue(initialBudgets);
    const queryClient = createTestQueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <BudgetsPage bookId={bookId} />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByText("Total Pengeluaran")).toBeInTheDocument();
    });

    // Verify explicit text labels accompany each status color
    const okLabel = screen.getByTestId("budget-status-label-OK");
    expect(okLabel).toHaveTextContent("AMAN (OK)");
    expect(okLabel.className).toContain("text-primary");

    const warningLabel = screen.getByTestId("budget-status-label-WARNING");
    expect(warningLabel).toHaveTextContent("PERINGATAN (WARNING)");
    expect(warningLabel.className).toContain("text-amber-500");

    const overLabel = screen.getByTestId("budget-status-label-OVER");
    expect(overLabel).toHaveTextContent("MELEBIHI BATAS (OVER)");
    expect(overLabel.className).toContain("text-rose-500");

    // Verify progress bar fill colors
    expect(screen.getByTestId("budget-progress-fill-OK").className).toContain(
      "bg-primary"
    );
    expect(
      screen.getByTestId("budget-progress-fill-WARNING").className
    ).toContain("bg-amber-500");
    expect(screen.getByTestId("budget-progress-fill-OVER").className).toContain(
      "bg-rose-500"
    );
  });

  it("automatically refetches budget progress when crdt:synced arrives with transactions for active bookId", async () => {
    let callCount = 0;
    const getBudgetProgressSpy = vi
      .spyOn(tauriApi, "getBudgetProgress")
      .mockImplementation(async () => {
        callCount += 1;
        if (callCount === 1) {
          return [initialBudgets[0]];
        }
        return [
          {
            ...initialBudgets[0],
            spent: 4_800_000,
            remaining: 200_000,
            pct: 96,
            status: "WARNING",
          },
        ];
      });

    const queryClient = createTestQueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <BudgetsPage bookId={bookId} />
      </QueryClientProvider>
    );

    await waitFor(() => {
      expect(screen.getByTestId("budget-status-label-OK")).toHaveTextContent(
        "AMAN (OK)"
      );
    });
    expect(getBudgetProgressSpy).toHaveBeenCalledTimes(1);

    // Emit crdt:synced for a different book -> should NOT trigger refetch
    act(() => {
      emitMockTauriEvent<CrdtSyncedPayload>("crdt:synced", {
        book_id: "other-book-id",
        tables: ["transactions"],
      });
    });
    expect(getBudgetProgressSpy).toHaveBeenCalledTimes(1);

    // Emit crdt:synced for active bookId with transactions -> MUST invalidate & refetch budgets
    act(() => {
      emitMockTauriEvent<CrdtSyncedPayload>("crdt:synced", {
        book_id: bookId,
        tables: ["transactions"],
      });
    });

    await waitFor(() => {
      expect(getBudgetProgressSpy).toHaveBeenCalledTimes(2);
      expect(
        screen.getByTestId("budget-status-label-WARNING")
      ).toHaveTextContent("PERINGATAN (WARNING)");
    });
  });
});
