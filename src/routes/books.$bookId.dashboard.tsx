import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { DashboardPage } from "../components/dashboard/DashboardPage";
import {
  RouteErrorView,
  RoutePendingView,
} from "../components/layout/RouteStateViews";

const DashboardRouteComponent: React.FC = () => {
  const { bookId } = Route.useParams();
  return <DashboardPage bookId={bookId} />;
};

export const Route = createFileRoute("/books/$bookId/dashboard")({
  component: DashboardRouteComponent,
  pendingComponent: RoutePendingView,
  errorComponent: RouteErrorView,
});
