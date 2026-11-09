import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  applyCrdtSyncedInvalidation,
  bookQueryKeys,
  useInfiniteTransactions,
} from "../useBookFinance";
import { tauriApi, type TransactionView } from "../../lib/tauri-api";

function makeTx(id: string, amount = -10000): TransactionView {
  return {
    id,
    account_id: "acc-1",
    account_name: "BCA",
    category_id: "cat-1",
    category_name: "Jajan",
    tx_date: "2026-10-27",
    tx_type: "EXPENSE",
    amount,
    note: null,
    to_account_id: null,
    to_account_name: null,
    link_id: null,
    created_by_device: "dev-1",
    updated_hlc: "1:1:1",
  };
}

describe("useBookFinance query keys & selective crdt:synced invalidation", () => {
  const bookA = "018f0000-0000-7000-8000-00000000000a";
  const bookB = "018f0000-0000-7000-8000-00000000000b";

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("includes bookId in every domain query key", () => {
    expect(bookQueryKeys.accounts(bookA)).toEqual(["books", bookA, "accounts"]);
    expect(bookQueryKeys.categories(bookA)).toEqual([
      "books",
      bookA,
      "categories",
    ]);
    expect(bookQueryKeys.transactions(bookA, { limit: 10 })).toEqual([
      "books",
      bookA,
      "transactions",
      { limit: 10 },
    ]);
    expect(bookQueryKeys.transactionsInfinite(bookA, { limit: 25 })).toEqual([
      "books",
      bookA,
      "transactions",
      "infinite",
      { limit: 25 },
    ]);
    expect(bookQueryKeys.balances(bookA)).toEqual(["books", bookA, "balances"]);
    expect(bookQueryKeys.summary(bookA)).toEqual(["books", bookA, "summary"]);
    expect(bookQueryKeys.budgets(bookA, "2026-10")).toEqual([
      "books",
      bookA,
      "budgets",
      "2026-10",
    ]);
  });

  it("ignores crdt:synced events from a different book_id", () => {
    const queryClient = new QueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    applyCrdtSyncedInvalidation(queryClient, bookA, {
      book_id: bookB,
      tables: ["transactions", "accounts", "categories", "budgets"],
    });

    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it("invalidates budget queries when crdt:synced includes transactions", () => {
    const queryClient = new QueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    applyCrdtSyncedInvalidation(queryClient, bookA, {
      book_id: bookA,
      tables: ["transactions"],
    });

    const invalidatedKeys = invalidateSpy.mock.calls.map(
      (call) => call[0]?.queryKey
    );
    expect(invalidatedKeys).toContainEqual(["books", bookA, "transactions"]);
    expect(invalidatedKeys).toContainEqual(["books", bookA, "balances"]);
    expect(invalidatedKeys).toContainEqual(["books", bookA, "summary"]);
    expect(invalidatedKeys).toContainEqual(["books", bookA, "budgets"]);
  });

  it("loads incremental pages and deduplicates overlapping transaction IDs", async () => {
    const listSpy = vi
      .spyOn(tauriApi, "listTransactions")
      .mockResolvedValueOnce({
        items: [makeTx("tx-1"), makeTx("tx-2")],
        total: 3,
        limit: 2,
        offset: 0,
      })
      .mockResolvedValueOnce({
        items: [makeTx("tx-2"), makeTx("tx-3")],
        total: 3,
        limit: 2,
        offset: 2,
      });

    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );

    const { result } = renderHook(
      () =>
        useInfiniteTransactions(bookA, {
          limit: 2,
          offset: 99,
          sort_by: "tx_date",
          sort_dir: "desc",
        }),
      { wrapper }
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.items.map((t) => t.id)).toEqual(["tx-1", "tx-2"]);
    expect(result.current.total).toBe(3);
    expect(result.current.hasNextPage).toBe(true);
    expect(listSpy).toHaveBeenNthCalledWith(1, bookA, {
      limit: 2,
      offset: 0,
      sort_by: "tx_date",
      sort_dir: "desc",
    });

    await act(async () => {
      await result.current.fetchNextPage();
    });

    expect(listSpy).toHaveBeenNthCalledWith(2, bookA, {
      limit: 2,
      offset: 2,
      sort_by: "tx_date",
      sort_dir: "desc",
    });
    await waitFor(() =>
      expect(result.current.items.map((t) => t.id)).toEqual([
        "tx-1",
        "tx-2",
        "tx-3",
      ])
    );
    expect(result.current.hasNextPage).toBe(false);
  });
});

