import * as React from "react";
import { Link, Outlet, useLocation, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { tauriApi, type BookMetadata } from "../../lib/tauri-api";
import {
  bookQueryKeys,
  useBookFinance,
  useBookSyncEvents,
} from "../../hooks/useBookFinance";
import { useUiStore } from "../../stores/ui-store";
import {
  applyTheme,
  formatBookKindLabel,
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
    return "Ringkasan";
  }, [location.pathname]);

  // Friendly sync status with compact mobile summary
  const syncPillMeta = React.useMemo(() => {
    switch (syncStatus.state) {
      case "syncing":
        return {
          dotClass: "bg-primary animate-pulse",
          text: `Menyinkronkan (${syncStatus.peers} perangkat)`,
          shortText: "Menyinkronkan",
          borderClass: "border-primary/40 text-primary",
        };
      case "connecting":
        return {
          dotClass: "bg-amber-500 animate-pulse",
          text: "Menghubungkan perangkat...",
          shortText: "Menghubungkan...",
          borderClass: "border-amber-500/40 text-amber-500",
        };
      case "error":
        return {
          dotClass: "bg-rose-500",
          text: "Sinkronisasi terkendala",
          shortText: "Kendala Sinkron",
          borderClass: "border-rose-500/40 text-rose-500",
        };
      case "idle":
      default:
        if (syncStatus.peers > 0) {
          return {
            dotClass: "bg-emerald-500",
            text: `Terhubung (${syncStatus.peers} perangkat)`,
            shortText: `${syncStatus.peers} Terhubung`,
            borderClass: "border-border text-foreground",
          };
        }
        return {
          dotClass: "bg-emerald-500",
          text: "Tersimpan di perangkat ini",
          shortText: "Tersimpan",
          borderClass: "border-border text-muted-foreground",
        };
    }
  }, [syncStatus]);

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      {/* Compact Mobile-First Top Bar (Zero Double Border) */}
      <header className="sticky top-0 z-30 border-b border-border bg-card/95 backdrop-blur-sm">
        <div className="flex items-center justify-between gap-1.5 px-2.5 py-2">
          {/* Left: Back Button + Active Book Switcher + Section */}
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <Link
              to="/"
              title="Kembali ke Daftar Buku Lokal"
              onClick={() => {
                void tauriApi.closeBook(bookId).catch(() => {});
              }}
              className="nav-touch-item inline-flex h-7 shrink-0 items-center justify-center rounded border border-border bg-background px-2 font-mono text-[11px] font-medium text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
            >
              ← Buku
            </Link>

            <select
              aria-label="Pemilih Buku Aktif"
              value={bookId}
              onChange={(e) => void handleSwitchBook(e.target.value)}
              className="h-7 min-w-0 flex-1 truncate rounded border border-border bg-background px-2 text-xs font-semibold text-foreground focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary sm:max-w-[220px] sm:flex-initial"
            >
              {allBooks.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({formatBookKindLabel(b.kind)})
                </option>
              ))}
              <option value="__HOME__">── Lihat Semua Buku ──</option>
            </select>

            <span className="hidden truncate font-mono text-[11px] text-muted-foreground md:inline">
              / {currentSectionLabel}
            </span>
          </div>

          {/* Right: Sync Pill + Theme Toggle */}
          <div className="flex shrink-0 items-center gap-1.5">
            <div
              data-testid="sync-status-pill"
              title={syncPillMeta.text}
              className={`inline-flex h-7 items-center gap-1.5 rounded border bg-background px-2 font-mono text-[10px] ${syncPillMeta.borderClass}`}
            >
              <span
                className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${syncPillMeta.dotClass}`}
              />
              <span className="truncate sm:hidden">{syncPillMeta.shortText}</span>
              <span className="hidden truncate sm:inline">
                {syncPillMeta.text}
              </span>
            </div>

            <button
              type="button"
              onClick={handleToggleTheme}
              aria-label="Ganti Tema Warna"
              title="Ganti Tema Gelap / Terang"
              className="nav-touch-item inline-flex h-7 items-center justify-center rounded border border-border bg-background px-2 font-mono text-[10px] font-medium text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
            >
              {theme === "dark" ? "GELAP" : "TERANG"}
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Container: Zero Outer Padding, Compact, Animated Page & Card Transitions */}
      <main className="w-full flex-1 p-0 pb-24">
        <div
          key={location.pathname}
          className="page-transition-wrapper animate-page-in"
        >
          <Outlet />
        </div>
      </main>

      {/* Floating Bottom Navigation Bar (Home, Transactions, Reports, Settings + Add FAB) */}
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
