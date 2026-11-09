import * as React from "react";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { bookQueryKeys } from "../hooks/useBookFinance";
import { tauriApi } from "../lib/tauri-api";
import { pushToast } from "../lib/toast";
import { currentYearMonth } from "../lib/utils";
import { BookLayout } from "../components/layout/BookLayout";
import {
  RouteErrorView,
  RoutePendingView,
} from "../components/layout/RouteStateViews";

const BookActiveLayoutComponent: React.FC = () => {
  const { bookId } = Route.useParams();
  const { bookMeta } = Route.useRouteContext();

  return <BookLayout bookId={bookId} bookMeta={bookMeta} />;
};

export const Route = createFileRoute("/books/$bookId")({
  beforeLoad: async ({ params }) => {
    try {
      const bookMeta = await tauriApi.openBook(params.bookId);
      return { bookMeta };
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : "Buku tidak ditemukan atau ID buku tidak valid";
      pushToast("Tidak dapat membuka buku", {
        description: msg,
        variant: "error",
      });
      throw redirect({ to: "/" });
    }
  },
  loader: async ({ context, params }) => {
    const bookId = params.bookId;
    const month = currentYearMonth();
    const dashboardTxFilter = {
      limit: 6,
      offset: 0,
      sort_by: "tx_date" as const,
      sort_dir: "desc" as const,
    };

    await Promise.allSettled([
      context.queryClient.ensureQueryData({
        queryKey: bookQueryKeys.allBooks,
        queryFn: () => tauriApi.listBooks(),
      }),
      context.queryClient.ensureQueryData({
        queryKey: bookQueryKeys.deviceIdentity(bookId),
        queryFn: () => tauriApi.getDeviceIdentity(bookId),
      }),
      context.queryClient.ensureQueryData({
        queryKey: bookQueryKeys.syncStatus(bookId),
        queryFn: () => tauriApi.getSyncStatus(bookId),
      }),
      context.queryClient.ensureQueryData({
        queryKey: bookQueryKeys.accounts(bookId),
        queryFn: () => tauriApi.listAccounts(bookId),
      }),
      context.queryClient.ensureQueryData({
        queryKey: bookQueryKeys.categories(bookId),
        queryFn: () => tauriApi.listCategories(bookId),
      }),
      context.queryClient.ensureQueryData({
        queryKey: bookQueryKeys.balances(bookId),
        queryFn: () => tauriApi.getAccountBalances(bookId),
      }),
      context.queryClient.ensureQueryData({
        queryKey: bookQueryKeys.summary(bookId),
        queryFn: () => tauriApi.getCashFlowSummary(bookId, 6),
      }),
      context.queryClient.ensureQueryData({
        queryKey: bookQueryKeys.budgets(bookId, month),
        queryFn: () => tauriApi.getBudgetProgress(bookId, month),
      }),
      context.queryClient.ensureQueryData({
        queryKey: bookQueryKeys.transactions(bookId, dashboardTxFilter),
        queryFn: () => tauriApi.listTransactions(bookId, dashboardTxFilter),
      }),
    ]);
  },
  component: BookActiveLayoutComponent,
  pendingComponent: RoutePendingView,
  errorComponent: RouteErrorView,
});
