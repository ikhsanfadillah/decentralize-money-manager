import * as React from "react";
import { createRootRouteWithContext, Outlet } from "@tanstack/react-router";
import type { QueryClient } from "@tanstack/react-query";
import { applyTheme, getStoredTheme } from "../lib/utils";
import {
  dismissToast,
  subscribeToasts,
  type ToastItem,
} from "../lib/toast";
import { tauriApi } from "../lib/tauri-api";
import {
  RouteErrorView,
  RoutePendingView,
} from "../components/layout/RouteStateViews";

export interface RouterAppContext {
  queryClient: QueryClient;
}

const RootLayout: React.FC = () => {
  const [toasts, setToasts] = React.useState<ToastItem[]>([]);

  React.useEffect(() => {
    applyTheme(getStoredTheme());
  }, []);

  React.useEffect(() => {
    return subscribeToasts(setToasts);
  }, []);

  // Foreground-only sync lifecycle (Section 6.5)
  React.useEffect(() => {
    const handleVisibilityChange = () => {
      const isForeground = document.visibilityState === "visible";
      void tauriApi.setAppForeground(isForeground).catch(() => {});
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Outlet />

      {toasts.length > 0 && (
        <div
          aria-live="polite"
          className="fixed bottom-4 right-4 z-50 flex w-full max-w-sm flex-col gap-2"
        >
          {toasts.map((t) => {
            const badgeText =
              t.variant === "error"
                ? "Gagal"
                : t.variant === "warning"
                  ? "Perhatian"
                  : t.variant === "success"
                    ? "Berhasil"
                    : "Info";
            const badgeColor =
              t.variant === "error"
                ? "text-rose-500"
                : t.variant === "warning"
                  ? "text-amber-500"
                  : t.variant === "success"
                    ? "text-emerald-500"
                    : "text-sky-500";

            return (
              <div
                key={t.id}
                className="tabular-grid-container grid grid-cols-1 shadow-none"
              >
                <div className="tabular-grid-cell flex items-start justify-between gap-3 p-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`font-mono text-xs font-semibold ${badgeColor}`}
                      >
                        {badgeText}
                      </span>
                      <span className="text-xs font-semibold text-foreground">
                        {t.title}
                      </span>
                    </div>
                    {t.description && (
                      <p className="text-xs text-muted-foreground">
                        {t.description}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => dismissToast(t.id)}
                    className="rounded border border-border px-1.5 py-0.5 font-mono text-xs text-muted-foreground shadow-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
                  >
                    ×
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export const Route = createRootRouteWithContext<RouterAppContext>()({
  component: RootLayout,
  pendingComponent: RoutePendingView,
  errorComponent: RouteErrorView,
});

