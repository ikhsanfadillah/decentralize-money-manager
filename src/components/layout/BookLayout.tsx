import * as React from "react";
import { Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { ArrowLeft, ChevronDown, Moon, Settings, Sun } from "lucide-react";
import { tauriApi, type BookMetadata } from "../../lib/tauri-api";
import {
  bookQueryKeys,
  useBookFinance,
  useBookSyncEvents,
} from "../../hooks/useBookFinance";
import { useUiStore } from "../../stores/ui-store";
import {
  applyTheme,
  getStoredTheme,
  type ThemeMode,
} from "../../lib/utils";
import { TransactionDialog } from "../transactions/TransactionDialog";
import { FloatingNavbar } from "./FloatingNavbar";

export interface BookLayoutProps {
  bookId: string;
  bookMeta: BookMetadata;
}

export const BookLayout: React.FC<BookLayoutProps> = ({ bookId, bookMeta }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const syncStatus = useBookSyncEvents(bookId);

  const [theme, setTheme] = React.useState<ThemeMode>(() => getStoredTheme());
  const shouldReduceMotion = useReducedMotion();

  React.useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [location.pathname]);

  const isNewTransactionModalOpen = useUiStore(
    (s) => s.isNewTransactionModalOpen
  );
  const setNewTransactionModalOpen = useUiStore(
    (s) => s.setNewTransactionModalOpen
  );

  const booksQuery = useQuery({
    queryKey: bookQueryKeys.allBooks,
    queryFn: () => tauriApi.listBooks(),
  });

  const {
    accountsQuery,
    categoriesQuery,
    deviceIdentityQuery,
    addTransactionMutation,
    updateTransactionMutation,
    transferBetweenBooksMutation,
  } = useBookFinance({ bookId });

  const allBooks = booksQuery.data ?? [bookMeta];

  const handleToggleTheme = () => {
    const next: ThemeMode = theme === "dark" ? "light" : "dark";
    setTheme(next);
    applyTheme(next);
  };

  const handleSwitchBook = async (targetBookId: string) => {
    if (targetBookId === "__HOME__") {
      await tauriApi.closeBook(bookId).catch(() => {});
      void navigate({ to: "/" });
      return;
    }
    if (targetBookId && targetBookId !== bookId) {
      await tauriApi.closeBook(bookId).catch(() => {});
      void navigate({
        to: "/books/$bookId/dashboard",
        params: { bookId: targetBookId },
      });
    }
  };

  const currentSectionLabel = React.useMemo(() => {
    const p = location.pathname;
    if (p.endsWith("/transactions")) return "Catatan Transaksi";
    if (p.endsWith("/accounts")) return "Rekening & Dompet";
    if (p.endsWith("/categories")) return "Kategori";
    if (p.endsWith("/budgets")) return "Anggaran Bulanan";
    if (p.endsWith("/reports")) return "Laporan Keuangan";
    if (p.endsWith("/settings")) return "Pengaturan";
    if (p.endsWith("/sync")) return "Sinkronisasi";
    if (p.endsWith("/backup")) return "Cadangan Data";
    return "Ringkasan";
  }, [location.pathname]);

  const deviceInitial = React.useMemo(() => {
    const raw =
      deviceIdentityQuery.data?.device_name?.trim() ||
      bookMeta.name.trim() ||
      "P";
    return raw.charAt(0).toUpperCase();
  }, [deviceIdentityQuery.data?.device_name, bookMeta.name]);

  const syncPillMeta = React.useMemo(() => {
    switch (syncStatus.state) {
      case "syncing":
        return {
          dotClass: "bg-primary animate-pulse",
          text: `Menyinkronkan (${syncStatus.peers} perangkat)`,
          shortText: "Sync",
          borderClass: "border-primary/40 text-foreground",
        };
      case "connecting":
        return {
          dotClass: "bg-amber-400 animate-pulse",
          text: "Menghubungkan perangkat...",
          shortText: "Menghubungkan",
          borderClass: "border-amber-400/40 text-amber-400",
        };
      case "error":
        return {
          dotClass: "bg-rose-400",
          text: "Sinkronisasi terkendala",
          shortText: "Kendala",
          borderClass: "border-rose-400/40 text-rose-400",
        };
      case "idle":
      default:
        if (syncStatus.peers > 0) {
          return {
            dotClass: "bg-emerald-400",
            text: `Terhubung (${syncStatus.peers} perangkat)`,
            shortText: `${syncStatus.peers} Peer`,
            borderClass: "border-border text-foreground",
          };
        }
        return {
          dotClass: "bg-emerald-400",
          text: "Tersimpan lokal",
          shortText: "Lokal",
          borderClass: "border-border text-muted-foreground",
        };
    }
  }, [syncStatus]);

  return (
    <div className="flex min-h-screen flex-col text-foreground">
      {/* Warm Glass Top App Bar */}
      <header className="sticky top-0 z-30 border-b border-border/70 bg-background/75 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-2 px-4 py-2.5 sm:px-6">
          {/* Left: Back to Books + Book Title Switcher + Section */}
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Link
              to="/"
              title="Kembali ke Daftar Buku Lokal"
              aria-label="Kembali ke Daftar Buku"
              onClick={() => {
                void tauriApi.closeBook(bookId).catch(() => {});
              }}
              className="nav-touch-item inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-card text-foreground backdrop-blur-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
            </Link>

            <div className="relative min-w-0 flex-1 sm:max-w-[240px] sm:flex-initial">
              <select
                aria-label="Pemilih Buku Aktif"
                value={bookId}
                onChange={(e) => void handleSwitchBook(e.target.value)}
                className="h-9 w-full appearance-none truncate rounded-full border border-border bg-card pl-3.5 pr-8 text-sm font-bold tracking-tight text-foreground backdrop-blur-sm transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
              >
                {allBooks.map((b) => (
                  <option
                    key={b.id}
                    value={b.id}
                    className="bg-zinc-900 text-white"
                  >
                    {b.name}
                  </option>
                ))}
                <option value="__HOME__" className="bg-zinc-900 text-white">
                  ── Lihat Semua Buku ──
                </option>
              </select>
              <ChevronDown
                className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
            </div>

            <span className="hidden truncate text-xs font-medium text-muted-foreground md:inline">
              / {currentSectionLabel}
            </span>
          </div>

          {/* Right: Sync Status Pill + Theme Toggle + Settings/Device Avatar */}
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
            <Link
              to="/books/$bookId/sync"
              params={{ bookId }}
              data-testid="sync-status-pill"
              title={`${syncPillMeta.text} — Buka Sinkronisasi`}
              className={`nav-touch-item inline-flex h-9 items-center gap-1.5 rounded-full border bg-card px-2.5 text-[11px] font-medium backdrop-blur-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary ${syncPillMeta.borderClass}`}
            >
              <span
                className={`inline-block h-2 w-2 shrink-0 rounded-full ${syncPillMeta.dotClass}`}
              />
              <span className="truncate sm:hidden">{syncPillMeta.shortText}</span>
              <span className="hidden truncate sm:inline">
                {syncPillMeta.text}
              </span>
            </Link>

            <button
              type="button"
              onClick={handleToggleTheme}
              aria-label={
                theme === "dark"
                  ? "Ganti ke mode terang"
                  : "Ganti ke mode gelap"
              }
              title={theme === "dark" ? "Mode Terang" : "Mode Gelap"}
              className="nav-touch-item inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card text-foreground backdrop-blur-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
            >
              {theme === "dark" ? (
                <Sun className="h-4 w-4 text-amber-400" aria-hidden="true" />
              ) : (
                <Moon className="h-4 w-4 text-zinc-700" aria-hidden="true" />
              )}
            </button>

            <Link
              to="/books/$bookId/settings"
              params={{ bookId }}
              aria-label="Pengaturan & Perangkat"
              title="Pengaturan, Rekening, Kategori & Perangkat"
              className="nav-touch-item relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-primary text-xs font-extrabold text-primary-foreground transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              <span>{deviceInitial}</span>
              <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full border border-border bg-background text-foreground">
                <Settings className="h-2.5 w-2.5" aria-hidden="true" />
              </span>
            </Link>
          </div>
        </div>
      </header>

      {/* Main Content Container: Centered Responsive Shell with Safe Dock Clearance */}
      <main
        className="mx-auto w-full max-w-5xl flex-1 px-4 pt-4 sm:px-6 sm:pt-5"
        style={{
          paddingBottom:
            "calc(6.5rem + env(safe-area-inset-bottom, 24px))",
        }}
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={location.pathname}
            initial={{
              opacity: 0,
              y: shouldReduceMotion ? 0 : 6,
            }}
            animate={{
              opacity: 1,
              y: 0,
            }}
            exit={{
              opacity: 0,
              y: shouldReduceMotion ? 0 : -4,
            }}
            transition={{
              duration: shouldReduceMotion ? 0.08 : 0.16,
              ease: [0.22, 1, 0.36, 1],
            }}
            className="w-full"
          >
            <Outlet />
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Floating Pill Bottom Navigation Bar (Home, Transaksi, [+], Laporan, Anggaran) */}
      <FloatingNavbar
        bookId={bookId}
        onAddTransaction={() => setNewTransactionModalOpen(true)}
      />

      <TransactionDialog
        isOpen={isNewTransactionModalOpen}
        onClose={() => setNewTransactionModalOpen(false)}
        bookId={bookId}
        accounts={accountsQuery.data ?? []}
        categories={categoriesQuery.data ?? []}
        editingTx={null}
        onAddTransaction={(input) => addTransactionMutation.mutateAsync(input)}
        onUpdateTransaction={(input) =>
          updateTransactionMutation.mutateAsync(input)
        }
        onTransferBetweenBooks={(input) =>
          transferBetweenBooksMutation.mutateAsync(input)
        }
      />
    </div>
  );
};
