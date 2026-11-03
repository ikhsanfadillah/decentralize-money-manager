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
import { tauriApi, type BookKind } from "../../lib/tauri-api";
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

  const [selectedKind, setSelectedKind] = React.useState<BookKind>("PERSONAL");
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
      return await tauriApi.joinBookFromInvite(rawToken, selectedKind);
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
        <div className="flex flex-col items-center gap-3 text-slate-500">
          <RefreshCw className="h-8 w-8 animate-spin text-emerald-500" />
          <p className="text-sm">Memvalidasi kode undangan P2P...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex min-h-[75vh] w-full max-w-lg items-center justify-center p-4">
      <div className="w-full rounded-2xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900 sm:p-8">
        {existingBook ? (
          /* State 1: Buku sudah ada di perangkat ini */
          <div className="flex flex-col items-center text-center">
            <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-400">
              <CheckCircle2 className="h-8 w-8" />
            </div>

            <span className="mb-2 inline-flex items-center rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300">
              Buku Sudah Terdaftar
            </span>

            <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
              {existingBook.name}
            </h1>

            <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
              Buku keuangan ini sudah tersimpan dan aktif di perangkat Anda. Anda dapat langsung membukanya atau menjalankan sinkronisasi data terbaru.
            </p>

            <div className="mt-6 flex w-full flex-col gap-3">
              <button
                type="button"
                onClick={handleOpenExistingBook}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 font-medium text-white shadow transition hover:bg-emerald-700 active:scale-[0.99]"
              >
                <BookOpen className="h-4 w-4" />
                Buka Buku Sekarang
              </button>

              <button
                type="button"
                onClick={handleResyncExistingBook}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                <RefreshCw className="h-4 w-4" />
                Sinkronkan Ulang & Buka
              </button>
            </div>
          </div>
        ) : (
          /* State 2: Buku baru, konfirmasi bergabung */
          <div className="flex flex-col">
            <div className="mb-6 flex items-center justify-between border-b border-slate-100 pb-4 dark:border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500 text-white shadow-md">
                  <Users className="h-5 w-5" />
                </div>
                <div>
                  <span className="text-xs font-semibold tracking-wider text-emerald-600 uppercase dark:text-emerald-400">
                    Undangan Kolaborasi P2P
                  </span>
                  <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                    Gabung ke Buku Keuangan
                  </h2>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-4 dark:border-emerald-950 dark:bg-emerald-950/20">
              <span className="text-xs text-slate-500 dark:text-slate-400">Nama Buku:</span>
              <p className="text-xl font-bold text-slate-900 dark:text-white">
                {parsedPayload.book_name}
              </p>
              <div className="mt-2 flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-300">
                <Clock className="h-3.5 w-3.5" />
                <span>Berlaku hingga {formatExpiryTime(parsedPayload.expires_at)}</span>
              </div>
            </div>

            {/* Pilihan kategori buku */}
            <div className="mt-5 space-y-2">
              <label
                htmlFor="book-kind-select"
                className="text-xs font-medium text-slate-700 dark:text-slate-300"
              >
                Kategori Buku di Perangkat Anda:
              </label>
              <select
                id="book-kind-select"
                value={selectedKind}
                onChange={(e) => setSelectedKind(e.target.value as BookKind)}
                className="w-full rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-800 shadow-sm focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              >
                <option value="PERSONAL">Pribadi (Personal)</option>
                <option value="BUSINESS">Bisnis / Usaha</option>
                <option value="OFFICE">Kantor / Organisasi</option>
                <option value="OTHER">Lainnya</option>
              </select>
            </div>

            {/* Zero-Knowledge Security Notice */}
            <div className="mt-5 flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50/60 p-3 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <span>
                Sinkronisasi berjalan langsung antar-perangkat secara <strong>End-to-End Encrypted</strong>. Server Cloudflare tidak dapat membaca catatan transaksi Anda.
              </span>
            </div>

            <div className="mt-6 flex flex-col gap-2.5">
              <button
                type="button"
                disabled={joinMutation.isPending}
                onClick={() => joinMutation.mutate()}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-3 font-medium text-white shadow-md transition hover:bg-emerald-700 active:scale-[0.99] disabled:opacity-50"
              >
                {joinMutation.isPending ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    Menyambungkan & Menyinkronkan...
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
                className="w-full py-2 text-center text-sm text-slate-500 transition hover:text-slate-800 dark:hover:text-slate-300"
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
