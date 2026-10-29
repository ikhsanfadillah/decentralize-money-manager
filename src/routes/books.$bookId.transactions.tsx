import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useBookFinance } from "../hooks/useBookFinance";
import { useUiStore } from "../stores/ui-store";
import type { TransactionView } from "../lib/tauri-api";
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
    transactionsQuery,
    addTransactionMutation,
    updateTransactionMutation,
    deleteTransactionMutation,
    transferBetweenBooksMutation,
  } = useBookFinance({
    bookId,
    transactionFilter: activeFilterDraft,
  });

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
        items={transactionsQuery.data?.items ?? []}
        total={transactionsQuery.data?.total ?? 0}
        filter={activeFilterDraft}
        accounts={accountsQuery.data ?? []}
        categories={categoriesQuery.data ?? []}
        isLoading={transactionsQuery.isLoading}
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
      />
    </div>
  );
};

export const Route = createFileRoute("/books/$bookId/transactions")({
  component: TransactionsRouteComponent,
  pendingComponent: RoutePendingView,
  errorComponent: RouteErrorView,
});
