import * as React from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion, useReducedMotion } from "motion/react";
import {
  AlertTriangle,
  BookOpen,
  ChevronRight,
  Clock,
  Moon,
  Plus,
  RefreshCw,
  ScanLine,
  Sun,
  X,
} from "lucide-react";
import { tauriApi, type BookKind } from "../../lib/tauri-api";
import { bookQueryKeys } from "../../hooks/useBookFinance";
import { useSmoothReady } from "../../hooks/useSmoothReady";
import { Input } from "../ui/input";
import {
  ButtonSlideToConfirm,
  type SlideConfirmResult,
} from "../ui/ButtonSlideToConfirm";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerTitle,
} from "../ui/drawer";
import { BarcodeScannerModal } from "./BarcodeScannerModal";
import { pushToast } from "../../lib/toast";
import {
  formatDateShort,
  formatDateTime,
  formatRelativeTime,
} from "../../lib/date";
import {
  applyTheme,
  formatBookKindLabel,
  getStoredTheme,
  type ThemeMode,
} from "../../lib/utils";

export const BookSwitcherPage: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [theme, setTheme] = React.useState<ThemeMode>(() => getStoredTheme());
  const [isCreateBookDrawerOpen, setIsCreateBookDrawerOpen] =
    React.useState(false);
  const [newBookName, setNewBookName] = React.useState("");
  const [isScanModalOpen, setIsScanModalOpen] = React.useState(false);

  const booksQuery = useQuery({
    queryKey: bookQueryKeys.allBooks,
    queryFn: () => tauriApi.listBooks(),
  });

  const createBookMutation = useMutation({
    mutationFn: ({ name, kind }: { name: string; kind: BookKind }) =>
      tauriApi.createBook(name, kind),
    onSuccess: (created) => {
      void queryClient.invalidateQueries({ queryKey: bookQueryKeys.allBooks });
      setNewBookName("");
      pushToast(`Buku "${created.name}" berhasil dibuat`, {
        variant: "success",
      });
    },
  });

  const joinBookMutation = useMutation({
    mutationFn: ({ qr, kind }: { qr: string; kind: BookKind }) =>
      tauriApi.joinBookFromInvite(qr, kind),
    onSuccess: (joinedBook) => {
      void queryClient.invalidateQueries({ queryKey: bookQueryKeys.allBooks });
      pushToast(`Berhasil bergabung ke buku "${joinedBook.name}"`, {
        variant: "success",
      });
      void navigate({
        to: "/books/$bookId/dashboard",
        params: { bookId: joinedBook.id },
      });
    },
  });

  const handleToggleTheme = () => {
    const next: ThemeMode = theme === "dark" ? "light" : "dark";
    setTheme(next);
    applyTheme(next);
  };

  const handleSlideConfirmCreateBook = async (): Promise<SlideConfirmResult> => {
    const trimmed = newBookName.trim();
    if (!trimmed) {
      pushToast("Nama buku tidak boleh kosong", { variant: "warning" });
      return { ok: false, message: "Nama buku tidak boleh kosong" };
    }
    try {
      await createBookMutation.mutateAsync({
        name: trimmed,
        kind: "PERSONAL",
      });
      return { ok: true };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Gagal membuat buku";
      pushToast("Gagal membuat buku", { description: msg, variant: "error" });
      return { ok: false, message: "Gagal Membuat Buku" };
    }
  };

  const shouldReduceMotion = useReducedMotion();
  const { isReady, showSkeleton } = useSmoothReady(booksQuery.isPending);
  const books = booksQuery.data ?? [];

  if (!isReady) {
    return (
      <div className="min-h-screen text-foreground" aria-busy="true">
        {showSkeleton && (
          <div className="animate-page-in mx-auto w-full max-w-3xl space-y-6 px-4 py-6 sm:px-6 sm:py-9">
            <div className="space-y-3 px-1">
              <div className="h-6 w-44 rounded-full bg-muted animate-pulse" />
              <div className="h-8 w-64 rounded-full bg-muted animate-pulse" />
              <div className="h-4 w-80 max-w-full rounded-full bg-muted/70 animate-pulse" />
            </div>
            <div className="space-y-3" aria-label="Memuat daftar buku">
              {[0, 1].map((idx) => (
                <div
                  key={idx}
                  className="glass-card flex items-center justify-between gap-3.5 p-4 sm:p-5 animate-pulse"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-3.5">
                    <div className="h-12 w-12 shrink-0 rounded-2xl bg-muted" />
                    <div className="min-w-0 flex-1 space-y-2">
                      <div className="h-4 w-44 max-w-full rounded-full bg-muted" />
                      <div className="h-3 w-56 max-w-full rounded-full bg-muted/70" />
                    </div>
                  </div>
                  <div className="h-8 w-16 shrink-0 rounded-full bg-muted" />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="min-h-screen text-foreground">
      <motion.main
        initial={{ opacity: 0, y: shouldReduceMotion ? 0 : 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{
          duration: shouldReduceMotion ? 0.08 : 0.22,
          ease: [0.22, 1, 0.36, 1],
        }}
        className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6 sm:px-6 sm:py-9"
      >
        {/* Top Utility Strip & Hero Header */}
        <header className="space-y-4 px-1">
          <div className="flex items-center justify-between gap-2">
            <div className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-[10px] font-medium text-muted-foreground backdrop-blur-sm">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              <span>Local-First · Offline · P2P Sync</span>
            </div>

            <button
              type="button"
              onClick={handleToggleTheme}
              aria-label={
                theme === "dark"
                  ? "Ganti ke mode terang"
                  : "Ganti ke mode gelap"
              }
              title={theme === "dark" ? "Mode Terang" : "Mode Gelap"}
              className="nav-touch-item inline-flex h-8 w-8 items-center justify-center rounded-full border border-border bg-card text-foreground backdrop-blur-sm transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
            >
              {theme === "dark" ? (
                <Sun className="h-3.5 w-3.5 text-amber-400" aria-hidden="true" />
              ) : (
                <Moon
                  className="h-3.5 w-3.5 text-zinc-700"
                  aria-hidden="true"
                />
              )}
            </button>
          </div>

          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2.5">
                <h1 className="text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">
                  Daftar Buku Keuangan
                </h1>
                {!booksQuery.isPending && (
                  <span className="inline-flex items-center rounded-full border border-border bg-card px-2.5 py-0.5 font-mono text-xs font-semibold tabular-nums text-muted-foreground">
                    {books.length}
                  </span>
                )}
              </div>
              <p className="text-xs text-muted-foreground sm:text-sm">
                Pilih buku untuk mulai mencatat atau hubungkan perangkat baru
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={() => setIsCreateBookDrawerOpen(true)}
                className="nav-touch-item inline-flex items-center gap-1.5 rounded-full bg-cta-surface px-4 py-2 text-xs font-bold text-cta-foreground transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Buat Buku</span>
              </button>
              <button
                type="button"
                onClick={() => setIsScanModalOpen(true)}
                title="Scan Barcode / QR untuk Gabung Buku"
                className="nav-touch-item inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3.5 py-2 text-xs font-semibold text-foreground backdrop-blur-sm transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
              >
                <ScanLine className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                <span>Scan QR</span>
              </button>
            </div>
          </div>
        </header>

        {/* Books Glass Cards List */}
        {booksQuery.isPending ? (
          <div className="space-y-3" aria-label="Memuat daftar buku">
            {[0, 1].map((idx) => (
              <div
                key={idx}
                className="glass-card flex items-center justify-between gap-3.5 p-4 sm:p-5 animate-pulse"
              >
                <div className="flex min-w-0 flex-1 items-center gap-3.5">
                  <div className="h-12 w-12 shrink-0 rounded-2xl bg-muted" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="h-4 w-44 max-w-full rounded-full bg-muted" />
                    <div className="h-3 w-56 max-w-full rounded-full bg-muted/70" />
                  </div>
                </div>
                <div className="h-8 w-16 shrink-0 rounded-full bg-muted" />
              </div>
            ))}
          </div>
        ) : booksQuery.isError ? (
          <div className="glass-card p-6 text-center sm:p-8">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-rose-500/30 bg-rose-500/10 text-rose-500">
              <AlertTriangle className="h-6 w-6" aria-hidden="true" />
            </div>
            <p className="text-sm font-bold text-foreground">
              Gagal memuat daftar buku
            </p>
            <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
              {booksQuery.error instanceof Error
                ? booksQuery.error.message
                : "Terjadi kendala saat membaca penyimpanan lokal perangkat."}
            </p>
            <button
              type="button"
              onClick={() => void booksQuery.refetch()}
              className="nav-touch-item mt-4 inline-flex items-center gap-1.5 rounded-full bg-cta-surface px-4 py-2 text-xs font-bold text-cta-foreground hover:opacity-90"
            >
              <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Coba Lagi</span>
            </button>
          </div>
        ) : books.length === 0 ? (
          <div className="glass-card p-8 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-cta-surface text-cta-foreground">
              <BookOpen className="h-6 w-6" aria-hidden="true" />
            </div>
            <p className="text-sm font-bold text-foreground">
              Belum ada buku keuangan
            </p>
            <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
              Buat buku baru untuk catatan pribadi/usaha atau pindai QR dari
              perangkat lain.
            </p>
            <div className="mt-5 flex flex-wrap items-center justify-center gap-2.5">
              <button
                type="button"
                onClick={() => setIsCreateBookDrawerOpen(true)}
                className="nav-touch-item rounded-full bg-cta-surface px-4 py-2 text-xs font-bold text-cta-foreground hover:opacity-90"
              >
                + Buat Buku Baru
              </button>
              <button
                type="button"
                onClick={() => setIsScanModalOpen(true)}
                className="nav-touch-item inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-4 py-2 text-xs font-semibold text-foreground hover:bg-muted"
              >
                <ScanLine className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
                <span>Scan QR untuk Gabung</span>
              </button>
            </div>
          </div>
        ) : (
          <section aria-label="Daftar Buku Tersimpan" className="space-y-3">
            <div className="flex items-center justify-between px-1">
              <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Buku Tersimpan
              </p>
              <p className="text-[11px] text-muted-foreground">
                {books.length} buku di perangkat ini
              </p>
            </div>

            <div className="space-y-3">
              {books.map((book, idx) => (
                <Link
                  key={book.id}
                  to="/books/$bookId/dashboard"
                  params={{ bookId: book.id }}
                  data-testid={`book-item-${book.id}`}
                  className="group glass-card flex items-center justify-between gap-3.5 p-4 transition-colors hover:bg-white/95 dark:hover:bg-white/[0.13] active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary sm:p-5"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-3.5">
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-cta-surface text-cta-foreground transition-transform group-hover:scale-[1.03]">
                      <BookOpen className="h-5 w-5" aria-hidden="true" />
                    </div>

                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-bold tracking-tight text-foreground sm:text-base">
                          {book.name}
                        </span>
                        <span className="shrink-0 rounded-full border border-border bg-muted px-2.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                          {formatBookKindLabel(book.kind)}
                        </span>
                        {idx === 0 && books.length > 1 && (
                          <span className="shrink-0 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                            Terbaru
                          </span>
                        )}
                        {!book.file_exists && (
                          <span className="shrink-0 rounded-full border border-amber-500/35 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                            File Lokal Hilang
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                        <span
                          className="inline-flex items-center gap-1"
                          title={`Terakhir dibuka: ${formatDateTime(book.last_opened_at)}`}
                        >
                          <Clock
                            className="h-3 w-3 shrink-0 opacity-75"
                            aria-hidden="true"
                          />
                          <span>
                            Dibuka {formatRelativeTime(book.last_opened_at)}
                          </span>
                        </span>
                        <span aria-hidden="true">·</span>
                        <span title={`Dibuat: ${formatDateTime(book.created_at)}`}>
                          Dibuat {formatDateShort(book.created_at)}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center">
                    <span className="hidden items-center gap-1 rounded-full bg-cta-surface px-3.5 py-1.5 text-xs font-bold text-cta-foreground transition-opacity group-hover:opacity-90 sm:inline-flex">
                      <span>Buka</span>
                      <ChevronRight
                        className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5"
                        aria-hidden="true"
                      />
                    </span>
                    <span
                      aria-hidden="true"
                      className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-muted text-foreground transition-colors group-hover:bg-cta-surface group-hover:text-cta-foreground sm:hidden"
                    >
                      <ChevronRight className="h-4 w-4" />
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}
      </motion.main>

      {/* Create New Book Drawer with ButtonSlideToConfirm */}
      <Drawer
        open={isCreateBookDrawerOpen}
        onOpenChange={setIsCreateBookDrawerOpen}
        shouldScaleBackground={false}
      >
        <DrawerContent className="fixed inset-x-0 bottom-0 z-50 flex h-[100dvh] max-h-[100dvh] w-full flex-col rounded-none border-t border-border p-0 focus:outline-none sm:mx-auto sm:h-auto sm:max-h-[90vh] sm:max-w-xl sm:rounded-t-3xl">
          <form
            onSubmit={(e) => e.preventDefault()}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
              }
            }}
            className="flex h-full flex-1 flex-col overflow-hidden sm:h-auto"
          >
            <div className="flex shrink-0 items-center justify-between border-b border-border px-5 py-4">
              <div>
                <DrawerTitle
                  id="create-book-drawer-title"
                  className="text-sm font-bold text-foreground"
                >
                  Buat Buku Keuangan Baru
                </DrawerTitle>
                <DrawerDescription className="mt-0.5 text-xs text-muted-foreground">
                  Pisahkan catatan uang harian, tabungan keluarga, atau usaha
                  Anda.
                </DrawerDescription>
              </div>
              <button
                type="button"
                onClick={() => setIsCreateBookDrawerOpen(false)}
                aria-label="Tutup"
                className="nav-touch-item inline-flex h-8 w-8 items-center justify-center rounded-full border border-border bg-muted text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
              <div className="space-y-1.5">
                <label
                  htmlFor="new-book-name"
                  className="block text-xs font-medium text-foreground"
                >
                  Nama Buku Keuangan
                </label>
                <Input
                  id="new-book-name"
                  value={newBookName}
                  onChange={(e) => setNewBookName(e.target.value)}
                  placeholder="Contoh: Uang Rumah Tangga, Tabungan, Usaha..."
                  autoFocus
                />
              </div>
            </div>

            <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border p-3.5 sm:px-5">
              <ButtonSlideToConfirm
                key={isCreateBookDrawerOpen ? "book-open" : "book-closed"}
                disabled={createBookMutation.isPending}
                label="Geser untuk Buat Buku"
                readyLabel="Lepas untuk Buat Buku"
                loadingLabel="Menyiapkan Buku..."
                successLabel="Buku Berhasil Dibuat!"
                onConfirm={handleSlideConfirmCreateBook}
                onSuccessComplete={() => {
                  setIsCreateBookDrawerOpen(false);
                }}
              />
            </div>
          </form>
        </DrawerContent>
      </Drawer>

      {/* Barcode & QR Scanner Modal */}
      <BarcodeScannerModal
        open={isScanModalOpen}
        onOpenChange={setIsScanModalOpen}
        onJoinBook={async (payload) => {
          await joinBookMutation.mutateAsync({ qr: payload, kind: "PERSONAL" });
        }}
        isJoining={joinBookMutation.isPending}
      />
    </div>
  );
};
