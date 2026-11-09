import * as React from "react";
import {
  createRootRouteWithContext,
  Outlet,
  ScrollRestoration,
} from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { applyTheme, getStoredTheme } from "../lib/utils";
import { tauriApi } from "../lib/tauri-api";
import {
  RouteErrorView,
  RoutePendingView,
} from "../components/layout/RouteStateViews";
import { Toaster } from "../components/ui/sonner";

export interface RouterAppContext {
  queryClient: QueryClient;
}

const RootLayout: React.FC = () => {
  React.useEffect(() => {
    applyTheme(getStoredTheme());
  }, []);

  // Foreground-only sync lifecycle (Section 6.5)
  React.useEffect(() => {
    const handleVisibilityChange = () => {
      const isForeground = document.visibilityState === "visible";
      void tauriApi.setAppForeground(isForeground).catch(() => {});
    };
    const handleWindowFocus = () => {
      if (document.visibilityState === "visible") {
        void tauriApi.setAppForeground(true).catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleWindowFocus);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleWindowFocus);
    };
  }, []);

  return (
    <div className="min-h-screen text-foreground">
      <Outlet />
      <ScrollRestoration />
      <Toaster />
    </div>
  );
};

export const Route = createRootRouteWithContext<RouterAppContext>()({
  component: RootLayout,
  pendingComponent: RoutePendingView,
  errorComponent: RouteErrorView,
});
