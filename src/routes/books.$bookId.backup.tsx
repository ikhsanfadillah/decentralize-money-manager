import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { BackupPage } from "../components/backup/BackupPage";
import {
  RouteErrorView,
  RoutePendingView,
} from "../components/layout/RouteStateViews";

const BackupRouteComponent: React.FC = () => {
  const { bookId } = Route.useParams();
  return <BackupPage bookId={bookId} />;
};

export const Route = createFileRoute("/books/$bookId/backup")({
  component: BackupRouteComponent,
  pendingComponent: RoutePendingView,
  errorComponent: RouteErrorView,
});

