import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { SettingsPage } from "../components/settings/SettingsPage";
import {
  RouteErrorView,
  RoutePendingView,
} from "../components/layout/RouteStateViews";

const SettingsRouteComponent: React.FC = () => {
  const { bookId } = Route.useParams();
  return <SettingsPage bookId={bookId} />;
};

export const Route = createFileRoute("/books/$bookId/settings")({
  component: SettingsRouteComponent,
  pendingComponent: RoutePendingView,
  errorComponent: RouteErrorView,
});
