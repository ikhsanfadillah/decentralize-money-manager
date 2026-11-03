import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { SyncPage } from "../components/sync/SyncPage";
import {
  RouteErrorView,
  RoutePendingView,
} from "../components/layout/RouteStateViews";

const SyncRouteComponent: React.FC = () => {
  const { bookId } = Route.useParams();
  return <SyncPage bookId={bookId} />;
};

export const Route = createFileRoute("/books/$bookId/sync")({
  component: SyncRouteComponent,
  pendingComponent: RoutePendingView,
  errorComponent: RouteErrorView,
});

