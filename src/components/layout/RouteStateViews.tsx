import * as React from "react";
import type { ErrorComponentProps } from "@tanstack/react-router";

export const RoutePendingView: React.FC = () => {
  return (
    <div className="flex min-h-[240px] w-full items-center justify-center p-6">
      <div className="tabular-grid-container grid grid-cols-1">
        <div className="tabular-grid-cell flex items-center gap-3 px-4 py-3 text-sm text-muted-foreground">
          <span className="inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-primary" />
          <span>Memuat data lokal...</span>
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
    error instanceof Error ? error.message : "Terjadi kesalahan tidak terduga";

  return (
    <div className="p-6">
      <div className="tabular-grid-container grid grid-cols-1">
        <div className="tabular-grid-cell space-y-3 p-5">
          <div className="flex items-center gap-2 text-rose-500">
            <span className="font-mono text-xs font-semibold uppercase tracking-wider">
              [GALAT SISTEM]
            </span>
            <h2 className="text-base font-semibold text-foreground">
              Gagal Memuat Halaman
            </h2>
          </div>
          <p className="font-mono text-xs text-muted-foreground">{message}</p>
          <div>
            <button
              type="button"
              onClick={() => reset()}
              className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground shadow-none hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
            >
              Coba Lagi
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

