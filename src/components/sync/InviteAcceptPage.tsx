import * as React from "react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BookOpen,
  CheckCircle2,
  Clock,
  RefreshCw,
  ShieldCheck,
  Users,
} from "lucide-react";
import { tauriApi } from "../../lib/tauri-api";
import { decodeInviteToken, type InviteTokenPayload } from "../../lib/web-core";
import { pushToast } from "../../lib/toast";
import { formatExpiryTime } from "../../lib/date";

export const InviteAcceptPage: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const search = useSearch({ strict: false }) as { d?: string };

  const [rawToken] = React.useState<string>(() => {
    if (search?.d && typeof search.d === "string" && search.d.trim().length > 0) {
      return search.d.trim();
    }
    // Fallback: check hash parameters if search didn't catch ?d=
    if (typeof window !== "undefined" && window.location.hash.includes("d=")) {
      try {
        const qIdx = window.location.hash.indexOf("?");
        if (qIdx >= 0) {
          const params = new URLSearchParams(window.location.hash.slice(qIdx));
          const val = params.get("d");
          if (val) return val.trim();
        }
      } catch {
        // Ignore
      }
    }
    return "";
  });

  const [parsedPayload, setParsedPayload] = React.useState<InviteTokenPayload | null>(null);

  // Parse and validate token on mount
  React.useEffect(() => {
    if (!rawToken) {
      pushToast("Link undangan tidak memiliki parameter data yang valid", {
        variant: "error",
      });
      void navigate({ to: "/" });
      return;
    }

    try {
      const decoded = decodeInviteToken(rawToken);
      if (new Date(decoded.expires_at).getTime() < Date.now()) {
        pushToast("Kode undangan telah kedaluwarsa (>10 menit)", {
          description: "Minta pengundang untuk membuat link undangan baru.",
          variant: "error",
        });
        void navigate({ to: "/" });
        return;
      }
      setParsedPayload(decoded);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Format link undangan tidak valid";
      pushToast("Link undangan tidak valid", {
        description: msg,
        variant: "error",
      });
      void navigate({ to: "/" });
    }
  }, [rawToken, navigate]);

  // Query existing books to check for duplicate
  const booksQuery = useQuery({
    queryKey: ["books"],
    queryFn: () => tauriApi.listBooks(),
  });

  const existingBook = React.useMemo(() => {
    if (!parsedPayload || !booksQuery.data) return null;
    return booksQuery.data.find((b) => b.id === parsedPayload.book_id) ?? null;
  }, [parsedPayload, booksQuery.data]);

  const joinMutation = useMutation({
    mutationFn: async () => {
      if (!parsedPayload) throw new Error("Undangan belum siap");
      return await tauriApi.joinBookFromInvite(rawToken, "PERSONAL");
    },
    onSuccess: (meta) => {
      void queryClient.invalidateQueries({ queryKey: ["books"] });
      pushToast(`Berhasil bergabung ke buku '${meta.name}'!`, {
        variant: "success",
      });
      void navigate({
        to: "/books/$bookId/dashboard",
        params: { bookId: meta.id },
      });
    },
    onError: (err: unknown) => {
      const msg =
        err instanceof Error ? err.message : "Gagal memproses undangan buku";
      pushToast("Gagal bergabung ke buku", {
        description: msg,
        variant: "error",
      });
    },
  });

  const handleOpenExistingBook = () => {
    if (!existingBook) return;
    void navigate({
      to: "/books/$bookId/dashboard",
      params: { bookId: existingBook.id },
    });
  };

  const handleResyncExistingBook = async () => {
    if (!existingBook) return;
    try {
      await tauriApi.triggerManualSync(existingBook.id);
      pushToast("Sinkronisasi instan dipicu", { variant: "info" });
      void navigate({
        to: "/books/$bookId/dashboard",
        params: { bookId: existingBook.id },
      });
    } catch {
      handleOpenExistingBook();
    }
  };

  if (!parsedPayload) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center p-4">
        <div className="glass-card flex flex-col items-center gap-3 px-8 py-6 text-muted-foreground">
          <RefreshCw className="h-7 w-7 animate-spin text-primary" />
          <p className="text-sm font-medium text-foreground">
            Memvalidasi kode undangan P2P...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-[75vh] w-full max-w-lg items-center justify-center p-4">
      <div className="glass-card w-full p-6 sm:p-8">
        {existingBook ? (
          /* State 1: Buku sudah ada di perangkat ini */
          <div className="flex flex-col items-center text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full border border-emerald-500/30 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-8 w-8" />
            </div>

            <span className="mb-2 inline-flex items-center rounded-full border border-emerald-500/35 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
              Buku Sudah Terdaftar
            </span>

            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              {existingBook.name}
            </h1>

            <p className="mt-2 text-sm text-muted-foreground">
              Buku keuangan ini sudah tersimpan dan aktif di perangkat Anda. Anda dapat langsung membukanya atau menjalankan sinkronisasi data terbaru.
            </p>

            <div className="mt-6 flex w-full flex-col gap-3">
              <button
                type="button"
                onClick={handleOpenExistingBook}
                className="nav-touch-item flex w-full items-center justify-center gap-2 rounded-full bg-cta-surface px-5 py-3 text-sm font-semibold text-cta-foreground transition-opacity hover:opacity-90 active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
              >
                <BookOpen className="h-4 w-4" />
                Buka Buku Sekarang
              </button>

              <button
                type="button"
                onClick={handleResyncExistingBook}
                className="nav-touch-item flex w-full items-center justify-center gap-2 rounded-full border border-border bg-black/[0.04] px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted dark:bg-white/[0.06] focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
              >
                <RefreshCw className="h-4 w-4" />
                Sinkronkan Ulang &amp; Buka
              </button>
            </div>
          </div>
        ) : (
          /* State 2: Buku baru, konfirmasi bergabung */
          <div className="flex flex-col">
            <div className="mb-5 flex items-center justify-between border-b border-border/70 pb-4">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-cta-surface text-cta-foreground">
                  <Users className="h-5 w-5" />
                </div>
                <div>
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-primary">
                    Undangan Kolaborasi P2P
                  </span>
                  <h2 className="text-lg font-bold tracking-tight text-foreground">
                    Gabung ke Buku Keuangan
                  </h2>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-primary/30 bg-primary/10 p-4">
              <span className="text-xs text-muted-foreground">Nama Buku:</span>
              <p className="mt-0.5 text-xl font-bold text-foreground">
                {parsedPayload.book_name}
              </p>
              <div className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-black/[0.05] px-2.5 py-0.5 font-mono text-[11px] text-primary dark:bg-white/[0.06]">
                <Clock className="h-3 w-3" />
                <span>Berlaku hingga {formatExpiryTime(parsedPayload.expires_at)}</span>
              </div>
            </div>

            {/* Zero-Knowledge Security Notice */}
            <div className="contrast-card mt-4 flex items-start gap-3 p-3.5 text-xs text-white/85">
              <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-zinc-950">
                <ShieldCheck className="h-4 w-4" />
              </div>
              <span className="leading-relaxed">
                Sinkronisasi berjalan langsung antar-perangkat secara{" "}
                <strong className="text-amber-300">End-to-End Encrypted</strong>. Server relay tidak dapat membaca catatan transaksi Anda.
              </span>
            </div>

            <div className="mt-6 flex flex-col gap-2.5">
              <button
                type="button"
                disabled={joinMutation.isPending}
                onClick={() => joinMutation.mutate()}
                className="nav-touch-item flex w-full items-center justify-center gap-2 rounded-full bg-cta-surface px-5 py-3 text-sm font-semibold text-cta-foreground transition-opacity hover:opacity-90 active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary disabled:opacity-50"
              >
                {joinMutation.isPending ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    Menyambungkan &amp; Menyinkronkan...
                  </>
                ) : (
                  <>
                    <Users className="h-4 w-4" />
                    Gabung ke Buku Ini
                  </>
                )}
              </button>

              <button
                type="button"
                disabled={joinMutation.isPending}
                onClick={() => void navigate({ to: "/" })}
                className="w-full rounded-full py-2.5 text-center text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                Batal
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
