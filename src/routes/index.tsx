import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { BookSwitcherPage } from "../components/books/BookSwitcherPage";
import { bookQueryKeys } from "../hooks/useBookFinance";
import { tauriApi } from "../lib/tauri-api";
import {
  RouteErrorView,
  RoutePendingView,
} from "../components/layout/RouteStateViews";

const BookSwitcherRouteComponent: React.FC = () => {
  return <BookSwitcherPage />;
};

export const Route = createFileRoute("/")({
  loader: async ({ context }) => {
    await context.queryClient
      .ensureQueryData({
        queryKey: bookQueryKeys.allBooks,
        queryFn: () => tauriApi.listBooks(),
      })
      .catch(() => {});
  },
  component: BookSwitcherRouteComponent,
  pendingComponent: RoutePendingView,
  errorComponent: RouteErrorView,
});
