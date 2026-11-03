import { createFileRoute } from "@tanstack/react-router";
import { InviteAcceptPage } from "../components/sync/InviteAcceptPage";
import {
  RouteErrorView,
  RoutePendingView,
} from "../components/layout/RouteStateViews";

export const Route = createFileRoute("/invite")({
  validateSearch: (search: Record<string, unknown>) => ({
    d: typeof search.d === "string" ? search.d : "",
  }),
  component: () => <InviteAcceptPage />,
  pendingComponent: RoutePendingView,
  errorComponent: RouteErrorView,
});
