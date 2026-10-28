import * as React from "react";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { tauriApi } from "../lib/tauri-api";
import { pushToast } from "../lib/toast";
import { BookLayout } from "../components/layout/BookLayout";
import {
  RouteErrorView,
  RoutePendingView,
} from "../components/layout/RouteStateViews";

const BookActiveLayoutComponent: React.FC = () => {
  const { bookId } = Route.useParams();
  const { bookMeta } = Route.useRouteContext();

  return <BookLayout bookId={bookId} bookMeta={bookMeta} />;
};

export const Route = createFileRoute("/books/$bookId")({
  beforeLoad: async ({ params }) => {
    try {
      const bookMeta = await tauriApi.openBook(params.bookId);
      return { bookMeta };
    } catch (err: unknown) {
      const msg =
        err instanceof Error
          ? err.message
          : "Buku tidak ditemukan atau ID buku tidak valid";
      pushToast("Tidak dapat membuka buku", {
        description: msg,
        variant: "error",
      });
      throw redirect({ to: "/" });
    }
  },
  component: BookActiveLayoutComponent,
  pendingComponent: RoutePendingView,
  errorComponent: RouteErrorView,
});
