import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { MonthlyReportPage } from "../components/reports/MonthlyReportPage";
import {
  RouteErrorView,
  RoutePendingView,
} from "../components/layout/RouteStateViews";

const MonthlyReportRouteComponent: React.FC = () => {
  const { bookId } = Route.useParams();
  return <MonthlyReportPage bookId={bookId} />;
};

export const Route = createFileRoute("/books/$bookId/reports")({
  component: MonthlyReportRouteComponent,
  pendingComponent: RoutePendingView,
  errorComponent: RouteErrorView,
});
