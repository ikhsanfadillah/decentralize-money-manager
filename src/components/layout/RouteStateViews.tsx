import * as React from "react";
import type { ErrorComponentProps } from "@tanstack/react-router";

export const RoutePendingView: React.FC = () => {
  return (
    <div className="flex min-h-[240px] w-full items-center justify-center p-4">
      <div className="glass-card flex items-center gap-2.5 px-5 py-3 text-xs text-muted-foreground">
        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-primary" />
        <span>Menyiapkan halaman...</span>
      </div>
    </div>
  );
};

export const RouteErrorView: React.FC<ErrorComponentProps> = ({
  error,
  reset,
}) => {
  const message =
    error instanceof Error
      ? error.message
      : "Terjadi kendala saat membuka halaman ini.";

  return (
    <div className="mx-auto max-w-lg p-4">
      <div className="contrast-card space-y-3 p-5">
        <div className="flex items-center gap-2 text-rose-400">
          <span className="rounded-full border border-rose-400/40 px-2 py-0.5 text-[10px] font-semibold uppercase">
            Kendala
          </span>
          <h2 className="text-sm font-semibold text-white">
            Halaman Belum Dapat Dibuka
          </h2>
        </div>
        <p className="text-xs leading-relaxed text-white/75">{message}</p>
        <div>
          <button
            type="button"
            onClick={() => reset()}
            className="rounded-full bg-white px-4 py-1.5 text-xs font-semibold text-zinc-950 transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            Muat Ulang
          </button>
        </div>
      </div>
    </div>
  );
};
