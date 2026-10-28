import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { BookSwitcherPage } from "../components/books/BookSwitcherPage";
import {
  RouteErrorView,
  RoutePendingView,
} from "../components/layout/RouteStateViews";

const BookSwitcherRouteComponent: React.FC = () => {
  return <BookSwitcherPage />;
};

export const Route = createFileRoute("/")({
  component: BookSwitcherRouteComponent,
  pendingComponent: RoutePendingView,
  errorComponent: RouteErrorView,
});
