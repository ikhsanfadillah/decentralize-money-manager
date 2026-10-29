import * as React from "react";
import type { ErrorComponentProps } from "@tanstack/react-router";

export const RoutePendingView: React.FC = () => {
  return (
    <div className="flex min-h-[240px] w-full items-center justify-center p-4">
      <div className="tabular-grid-container grid grid-cols-1">
        <div className="tabular-grid-cell flex items-center gap-2.5 px-4 py-3 text-xs text-muted-foreground">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-primary" />
          <span>Menyiapkan halaman...</span>
        </div>
      </div>
    </div>
  );
};

export const RouteErrorView: React.FC<ErrorComponentProps> = ({
  error,
  reset,
}) => {
  const message =
    error instanceof Error ? error.message : "Terjadi kendala saat membuka halaman ini.";

  return (
    <div className="p-4">
      <div className="tabular-grid-container grid grid-cols-1">
        <div className="tabular-grid-cell space-y-2.5 p-4">
          <div className="flex items-center gap-2 text-rose-500">
            <span className="rounded border border-rose-500/40 px-1.5 py-0.5 text-[10px] font-semibold uppercase">
              Kendala
            </span>
            <h2 className="text-sm font-semibold text-foreground">
              Halaman Belum Dapat Dibuka
            </h2>
          </div>
          <p className="text-xs text-muted-foreground">{message}</p>
          <div>
            <button
              type="button"
              onClick={() => reset()}
              className="rounded border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
            >
              Muat Ulang
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

