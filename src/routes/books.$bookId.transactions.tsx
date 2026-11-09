import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  bookQueryKeys,
  useBookFinance,
  useInfiniteTransactions,
} from "../hooks/useBookFinance";
import { useUiStore } from "../stores/ui-store";
import { tauriApi, type PaginatedTransactions, type TransactionView } from "../lib/tauri-api";
import { TransactionTable } from "../components/transactions/TransactionTable";
import { TransactionDialog } from "../components/transactions/TransactionDialog";
import { pushToast } from "../lib/toast";
import {
  RouteErrorView,
  RoutePendingView,
} from "../components/layout/RouteStateViews";

const TransactionsRouteComponent: React.FC = () => {
  const { bookId } = Route.useParams();
  const activeFilterDraft = useUiStore((s) => s.activeFilterDraft);
  const setActiveFilterDraft = useUiStore((s) => s.setActiveFilterDraft);
  const resetActiveFilterDraft = useUiStore((s) => s.resetActiveFilterDraft);
  const setNewTransactionModalOpen = useUiStore(
    (s) => s.setNewTransactionModalOpen
  );

  const [editingTx, setEditingTx] = React.useState<TransactionView | null>(
    null
  );

  const {
    accountsQuery,
    categoriesQuery,
    addTransactionMutation,
    updateTransactionMutation,
    deleteTransactionMutation,
    transferBetweenBooksMutation,
  } = useBookFinance({
    bookId,
    enableTransactionsQuery: false,
  });

  const infiniteTxQuery = useInfiniteTransactions(bookId, activeFilterDraft);

  const handleDeleteTx = async (txId: string) => {
    try {
      await deleteTransactionMutation.mutateAsync(txId);
      pushToast("Transaksi berhasil dihapus", { variant: "info" });
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Gagal menghapus transaksi";
      pushToast("Gagal menghapus transaksi", {
        description: msg,
        variant: "error",
      });
    }
  };

  return (
    <div className="w-full">
      <TransactionTable
        items={infiniteTxQuery.items}
        total={infiniteTxQuery.total}
        filter={activeFilterDraft}
        accounts={accountsQuery.data ?? []}
        categories={categoriesQuery.data ?? []}
        isLoading={infiniteTxQuery.isLoading}
        hasNextPage={Boolean(infiniteTxQuery.hasNextPage)}
        isFetchingNextPage={infiniteTxQuery.isFetchingNextPage}
        isLoadMoreError={infiniteTxQuery.isFetchNextPageError}
        onLoadMore={() => {
          if (infiniteTxQuery.hasNextPage && !infiniteTxQuery.isFetchingNextPage) {
            void infiniteTxQuery.fetchNextPage();
          }
        }}
        onFilterChange={setActiveFilterDraft}
        onResetFilter={resetActiveFilterDraft}
        onEditTx={(tx) => setEditingTx(tx)}
        onDeleteTx={(txId) => void handleDeleteTx(txId)}
        onOpenNewTx={() => setNewTransactionModalOpen(true)}
      />

      <TransactionDialog
        isOpen={editingTx !== null}
        onClose={() => setEditingTx(null)}
        bookId={bookId}
        accounts={accountsQuery.data ?? []}
        categories={categoriesQuery.data ?? []}
        editingTx={editingTx}
        onAddTransaction={(input) => addTransactionMutation.mutateAsync(input)}
        onUpdateTransaction={(input) =>
          updateTransactionMutation.mutateAsync(input)
        }
        onTransferBetweenBooks={(input) =>
          transferBetweenBooksMutation.mutateAsync(input)
        }
        onDeleteTransaction={(txId) =>
          deleteTransactionMutation.mutateAsync(txId)
        }
      />
    </div>
  );
};

export const Route = createFileRoute("/books/$bookId/transactions")({
  loader: async ({ context, params }) => {
    const filter = useUiStore.getState().activeFilterDraft;
    const pageSize = Math.max(1, filter.limit ?? 25);
    const { offset: _ignoredOffset, ...filterWithoutOffset } = filter;

    await context.queryClient
      .ensureInfiniteQueryData({
        queryKey: bookQueryKeys.transactionsInfinite(
          params.bookId,
          filterWithoutOffset
        ),
        queryFn: ({ pageParam }) =>
          tauriApi.listTransactions(params.bookId, {
            ...filterWithoutOffset,
            limit: pageSize,
            offset: pageParam,
          }),
        initialPageParam: 0,
        getNextPageParam: (
          lastPage: PaginatedTransactions,
          allPages: PaginatedTransactions[]
        ) => {
          const loadedCount = allPages.reduce(
            (sum, page) => sum + page.items.length,
            0
          );
          if (lastPage.items.length === 0 || loadedCount >= lastPage.total) {
            return undefined;
          }
          return loadedCount;
        },
      })
      .catch(() => {});
  },
  component: TransactionsRouteComponent,
  pendingComponent: RoutePendingView,
  errorComponent: RouteErrorView,
});
