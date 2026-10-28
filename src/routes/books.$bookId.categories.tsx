import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { CategoriesPage } from "../components/categories/CategoriesPage";
import {
  RouteErrorView,
  RoutePendingView,
} from "../components/layout/RouteStateViews";

const CategoriesRouteComponent: React.FC = () => {
  const { bookId } = Route.useParams();
  return <CategoriesPage bookId={bookId} />;
};

export const Route = createFileRoute("/books/$bookId/categories")({
  component: CategoriesRouteComponent,
  pendingComponent: RoutePendingView,
  errorComponent: RouteErrorView,
});
