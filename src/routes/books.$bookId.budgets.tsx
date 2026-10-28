import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { BudgetsPage } from "../components/budgets/BudgetsPage";
import {
  RouteErrorView,
  RoutePendingView,
} from "../components/layout/RouteStateViews";

const BudgetsRouteComponent: React.FC = () => {
  const { bookId } = Route.useParams();
  return <BudgetsPage bookId={bookId} />;
};

export const Route = createFileRoute("/books/$bookId/budgets")({
  component: BudgetsRouteComponent,
  pendingComponent: RoutePendingView,
  errorComponent: RouteErrorView,
});
