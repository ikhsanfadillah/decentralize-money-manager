import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { SyncPage } from "../components/sync/SyncPage";
import { bookQueryKeys } from "../hooks/useBookFinance";
import { tauriApi } from "../lib/tauri-api";
import {
  RouteErrorView,
  RoutePendingView,
} from "../components/layout/RouteStateViews";

const SyncRouteComponent: React.FC = () => {
  const { bookId } = Route.useParams();
  return <SyncPage bookId={bookId} />;
};

export const Route = createFileRoute("/books/$bookId/sync")({
  loader: async ({ context, params }) => {
    await Promise.allSettled([
      context.queryClient.ensureQueryData({
        queryKey: bookQueryKeys.peers(params.bookId),
        queryFn: () => tauriApi.listPeers(params.bookId),
      }),
      context.queryClient.ensureQueryData({
        queryKey: bookQueryKeys.syncTopology(params.bookId),
        queryFn: () => tauriApi.getSyncTopology(params.bookId),
      }),
    ]);
  },
  component: SyncRouteComponent,
  pendingComponent: RoutePendingView,
  errorComponent: RouteErrorView,
});

