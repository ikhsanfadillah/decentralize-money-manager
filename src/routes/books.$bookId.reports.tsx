import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { MonthlyReportPage } from "../components/reports/MonthlyReportPage";
import { bookQueryKeys } from "../hooks/useBookFinance";
import { tauriApi } from "../lib/tauri-api";
import { currentYearMonth } from "../lib/utils";
import {
  RouteErrorView,
  RoutePendingView,
} from "../components/layout/RouteStateViews";

const MonthlyReportRouteComponent: React.FC = () => {
  const { bookId } = Route.useParams();
  return <MonthlyReportPage bookId={bookId} />;
};

export const Route = createFileRoute("/books/$bookId/reports")({
  loader: async ({ context, params }) => {
    const month = currentYearMonth();
    await context.queryClient
      .ensureQueryData({
        queryKey: bookQueryKeys.monthlyReport(params.bookId, month),
        queryFn: () => tauriApi.getMonthlyReport(params.bookId, month),
      })
      .catch(() => {});
  },
  component: MonthlyReportRouteComponent,
  pendingComponent: RoutePendingView,
  errorComponent: RouteErrorView,
});
