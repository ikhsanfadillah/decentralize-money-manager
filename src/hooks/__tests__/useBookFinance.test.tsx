import { describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import {
  applyCrdtSyncedInvalidation,
  bookQueryKeys,
} from "../useBookFinance";

describe("useBookFinance query keys & selective crdt:synced invalidation", () => {
  const bookA = "018f0000-0000-7000-8000-00000000000a";
  const bookB = "018f0000-0000-7000-8000-00000000000b";

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
});

