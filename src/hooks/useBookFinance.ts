import { useEffect, useState } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  tauriApi,
  type AddTransactionInput,
  type CrdtSyncedPayload,
  type SyncStatusPayload,
  type TransactionFilter,
  type TransferBetweenBooksInput,
  type UpdateTransactionInput,
  type UpsertAccountInput,
  type UpsertBudgetInput,
  type UpsertCategoryInput,
} from "../lib/tauri-api";
import { currentYearMonth } from "../lib/utils";

export const bookQueryKeys = {
  allBooks: ["books"] as const,
  bookRoot: (bookId: string) => ["books", bookId] as const,
  accounts: (bookId: string) => ["books", bookId, "accounts"] as const,
  categories: (bookId: string) => ["books", bookId, "categories"] as const,
  transactionsAll: (bookId: string) =>
    ["books", bookId, "transactions"] as const,
  transactions: (bookId: string, filters: TransactionFilter) =>
    ["books", bookId, "transactions", filters] as const,
  balances: (bookId: string) => ["books", bookId, "balances"] as const,
  summary: (bookId: string) => ["books", bookId, "summary"] as const,
  budgetsAll: (bookId: string) => ["books", bookId, "budgets"] as const,
  budgets: (bookId: string, month: string) =>
    ["books", bookId, "budgets", month] as const,
  monthlyReportsAll: (bookId: string) =>
    ["books", bookId, "monthlyReport"] as const,
  monthlyReport: (bookId: string, month: string) =>
    ["books", bookId, "monthlyReport", month] as const,
  peers: (bookId: string) => ["books", bookId, "peers"] as const,
  syncStatus: (bookId: string) => ["books", bookId, "syncStatus"] as const,
};

/**
 * Selective invalidation handler for `crdt:synced` events (Section 3.3 & 9.2).
 * Only invalidates queries belonging to `activeBookId` and only for affected tables.
 * Changes to `transactions`, `categories`, or `budgets` always invalidate `budgets`.
 */
export function applyCrdtSyncedInvalidation(
  queryClient: QueryClient,
  activeBookId: string,
  payload: CrdtSyncedPayload
): void {
  if (!activeBookId || payload.book_id !== activeBookId) {
    return;
  }

  const tableSet = new Set(payload.tables);
  let shouldInvalidateBudgets = false;

  if (tableSet.has("accounts")) {
    void queryClient.invalidateQueries({
      queryKey: bookQueryKeys.accounts(activeBookId),
    });
    void queryClient.invalidateQueries({
      queryKey: bookQueryKeys.balances(activeBookId),
    });
    void queryClient.invalidateQueries({
      queryKey: bookQueryKeys.transactionsAll(activeBookId),
    });
    void queryClient.invalidateQueries({
      queryKey: bookQueryKeys.monthlyReportsAll(activeBookId),
    });
  }

  if (tableSet.has("categories")) {
    void queryClient.invalidateQueries({
      queryKey: bookQueryKeys.categories(activeBookId),
    });
    void queryClient.invalidateQueries({
      queryKey: bookQueryKeys.transactionsAll(activeBookId),
    });
    shouldInvalidateBudgets = true;
  }

  if (tableSet.has("transactions")) {
    void queryClient.invalidateQueries({
      queryKey: bookQueryKeys.transactionsAll(activeBookId),
    });
    void queryClient.invalidateQueries({
      queryKey: bookQueryKeys.balances(activeBookId),
    });
    void queryClient.invalidateQueries({
      queryKey: bookQueryKeys.summary(activeBookId),
    });
    shouldInvalidateBudgets = true;
  }

  if (tableSet.has("budgets")) {
    shouldInvalidateBudgets = true;
  }

  if (shouldInvalidateBudgets) {
    void queryClient.invalidateQueries({
      queryKey: bookQueryKeys.budgetsAll(activeBookId),
    });
    void queryClient.invalidateQueries({
      queryKey: bookQueryKeys.monthlyReportsAll(activeBookId),
    });
  }
}

/**
 * Subscribes to `crdt:synced` and `sync:status` Tauri events for `bookId`
 * with StrictMode-safe cleanup (Section 3.3 & 9.2).
 */
export function useBookSyncEvents(bookId: string): SyncStatusPayload {
  const queryClient = useQueryClient();
  const [liveStatus, setLiveStatus] = useState<SyncStatusPayload>({
    book_id: bookId,
    state: "idle",
    peers: 0,
    last_synced_at: null,
  });

  const initialStatusQuery = useQuery({
    queryKey: bookQueryKeys.syncStatus(bookId),
    queryFn: () => tauriApi.getSyncStatus(bookId),
    enabled: Boolean(bookId),
    staleTime: Infinity,
  });

  useEffect(() => {
    if (initialStatusQuery.data && initialStatusQuery.data.book_id === bookId) {
      setLiveStatus(initialStatusQuery.data);
    }
  }, [bookId, initialStatusQuery.data]);

  useEffect(() => {
    if (!bookId) {
      return;
    }

    let disposed = false;
    let unlistenSynced: UnlistenFn | null = null;
    let unlistenStatus: UnlistenFn | null = null;

    listen<CrdtSyncedPayload>("crdt:synced", (event) => {
      if (!disposed) {
        applyCrdtSyncedInvalidation(queryClient, bookId, event.payload);
      }
    })
      .then((fn) => {
        if (disposed) {
          fn();
        } else {
          unlistenSynced = fn;
        }
      })
      .catch(() => {
        // Ignore in non-Tauri test environments unless mocked
      });

    listen<SyncStatusPayload>("sync:status", (event) => {
      if (!disposed && event.payload.book_id === bookId) {
        setLiveStatus(event.payload);
        queryClient.setQueryData(
          bookQueryKeys.syncStatus(bookId),
          event.payload
        );
        void queryClient.invalidateQueries({
          queryKey: bookQueryKeys.peers(bookId),
        });
      }
    })
      .then((fn) => {
        if (disposed) {
          fn();
        } else {
          unlistenStatus = fn;
        }
      })
      .catch(() => {});

    return () => {
      disposed = true;
      if (unlistenSynced) {
        unlistenSynced();
      }
      if (unlistenStatus) {
        unlistenStatus();
      }
    };
  }, [bookId, queryClient]);

  return liveStatus;
}

export interface UseBookFinanceOptions {
  bookId: string;
  transactionFilter?: TransactionFilter;
  budgetMonth?: string;
}

export function useBookFinance({
  bookId,
  transactionFilter = { limit: 25, offset: 0, sort_by: "tx_date", sort_dir: "desc" },
  budgetMonth = currentYearMonth(),
}: UseBookFinanceOptions) {
  const queryClient = useQueryClient();

  const accountsQuery = useQuery({
    queryKey: bookQueryKeys.accounts(bookId),
    queryFn: () => tauriApi.listAccounts(bookId),
    enabled: Boolean(bookId),
  });

  const categoriesQuery = useQuery({
    queryKey: bookQueryKeys.categories(bookId),
    queryFn: () => tauriApi.listCategories(bookId),
    enabled: Boolean(bookId),
  });

  const transactionsQuery = useQuery({
    queryKey: bookQueryKeys.transactions(bookId, transactionFilter),
    queryFn: () => tauriApi.listTransactions(bookId, transactionFilter),
    enabled: Boolean(bookId),
  });

  const balancesQuery = useQuery({
    queryKey: bookQueryKeys.balances(bookId),
    queryFn: () => tauriApi.getAccountBalances(bookId),
    enabled: Boolean(bookId),
  });

  const summaryQuery = useQuery({
    queryKey: bookQueryKeys.summary(bookId),
    queryFn: () => tauriApi.getCashFlowSummary(bookId, 6),
    enabled: Boolean(bookId),
  });

  const budgetProgressQuery = useQuery({
    queryKey: bookQueryKeys.budgets(bookId, budgetMonth),
    queryFn: () => tauriApi.getBudgetProgress(bookId, budgetMonth),
    enabled: Boolean(bookId) && Boolean(budgetMonth),
  });

  const monthlyReportQuery = useQuery({
    queryKey: bookQueryKeys.monthlyReport(bookId, budgetMonth),
    queryFn: () => tauriApi.getMonthlyReport(bookId, budgetMonth),
    enabled: Boolean(bookId) && Boolean(budgetMonth),
  });

  const peersQuery = useQuery({
    queryKey: bookQueryKeys.peers(bookId),
    queryFn: () => tauriApi.listPeers(bookId),
    enabled: Boolean(bookId),
  });

  const invalidateBookFinancials = (targetBookId: string) => {
    void queryClient.invalidateQueries({
      queryKey: bookQueryKeys.accounts(targetBookId),
    });
    void queryClient.invalidateQueries({
      queryKey: bookQueryKeys.categories(targetBookId),
    });
    void queryClient.invalidateQueries({
      queryKey: bookQueryKeys.transactionsAll(targetBookId),
    });
    void queryClient.invalidateQueries({
      queryKey: bookQueryKeys.balances(targetBookId),
    });
    void queryClient.invalidateQueries({
      queryKey: bookQueryKeys.summary(targetBookId),
    });
    void queryClient.invalidateQueries({
      queryKey: bookQueryKeys.budgetsAll(targetBookId),
    });
    void queryClient.invalidateQueries({
      queryKey: bookQueryKeys.monthlyReportsAll(targetBookId),
    });
  };

  const upsertAccountMutation = useMutation({
    mutationFn: (input: UpsertAccountInput) =>
      tauriApi.upsertAccount(bookId, input),
    onSuccess: () => invalidateBookFinancials(bookId),
  });

  const deleteAccountMutation = useMutation({
    mutationFn: (accountId: string) =>
      tauriApi.deleteAccount(bookId, accountId),
    onSuccess: () => invalidateBookFinancials(bookId),
  });

  const mergeAccountsMutation = useMutation({
    mutationFn: ({
      sourceId,
      targetId,
    }: {
      sourceId: string;
      targetId: string;
    }) => tauriApi.mergeAccounts(bookId, sourceId, targetId),
    onSuccess: () => invalidateBookFinancials(bookId),
  });

  const upsertCategoryMutation = useMutation({
    mutationFn: (input: UpsertCategoryInput) =>
      tauriApi.upsertCategory(bookId, input),
    onSuccess: () => invalidateBookFinancials(bookId),
  });

  const deleteCategoryMutation = useMutation({
    mutationFn: (categoryId: string) =>
      tauriApi.deleteCategory(bookId, categoryId),
    onSuccess: () => invalidateBookFinancials(bookId),
  });

  const addTransactionMutation = useMutation({
    mutationFn: (input: AddTransactionInput) =>
      tauriApi.addTransaction(bookId, input),
    onSuccess: () => invalidateBookFinancials(bookId),
  });

  const updateTransactionMutation = useMutation({
    mutationFn: (input: UpdateTransactionInput) =>
      tauriApi.updateTransaction(bookId, input),
    onSuccess: () => invalidateBookFinancials(bookId),
  });

  const deleteTransactionMutation = useMutation({
    mutationFn: (txId: string) => tauriApi.deleteTransaction(bookId, txId),
    onSuccess: () => invalidateBookFinancials(bookId),
  });

  const transferBetweenBooksMutation = useMutation({
    mutationFn: (input: TransferBetweenBooksInput) =>
      tauriApi.transferBetweenBooks(input),
    onSuccess: (_data, variables) => {
      for (const targetBook of [variables.from_book_id, variables.to_book_id]) {
        invalidateBookFinancials(targetBook);
      }
    },
  });

  const upsertBudgetMutation = useMutation({
    mutationFn: (input: UpsertBudgetInput) =>
      tauriApi.upsertBudget(bookId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: bookQueryKeys.budgetsAll(bookId),
      });
      void queryClient.invalidateQueries({
        queryKey: bookQueryKeys.monthlyReportsAll(bookId),
      });
    },
  });

  const deleteBudgetMutation = useMutation({
    mutationFn: (budgetId: string) =>
      tauriApi.deleteBudget(bookId, budgetId),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: bookQueryKeys.budgetsAll(bookId),
      });
      void queryClient.invalidateQueries({
        queryKey: bookQueryKeys.monthlyReportsAll(bookId),
      });
    },
  });

  return {
    accountsQuery,
    categoriesQuery,
    transactionsQuery,
    balancesQuery,
    summaryQuery,
    budgetProgressQuery,
    monthlyReportQuery,
    peersQuery,
    upsertAccountMutation,
    deleteAccountMutation,
    mergeAccountsMutation,
    upsertCategoryMutation,
    deleteCategoryMutation,
    addTransactionMutation,
    updateTransactionMutation,
    deleteTransactionMutation,
    transferBetweenBooksMutation,
    upsertBudgetMutation,
    deleteBudgetMutation,
  };
}

