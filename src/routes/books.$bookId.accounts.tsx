import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AccountsPage } from "../components/accounts/AccountsPage";
import {
  RouteErrorView,
  RoutePendingView,
} from "../components/layout/RouteStateViews";

const AccountsRouteComponent: React.FC = () => {
  const { bookId } = Route.useParams();
  return <AccountsPage bookId={bookId} />;
};

export const Route = createFileRoute("/books/$bookId/accounts")({
  component: AccountsRouteComponent,
  pendingComponent: RoutePendingView,
  errorComponent: RouteErrorView,
});
