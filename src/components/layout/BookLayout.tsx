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
import { applyTheme, getStoredTheme, type ThemeMode } from "../../lib/utils";
import { TransactionDialog } from "../transactions/TransactionDialog";

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
    if (p.endsWith("/transactions")) return "Transaksi";
    if (p.endsWith("/accounts")) return "Akun";
    if (p.endsWith("/categories")) return "Kategori";
    if (p.endsWith("/budgets")) return "Anggaran Bulanan";
    if (p.endsWith("/reports")) return "Laporan Bulanan";
    if (p.endsWith("/settings")) return "Pengaturan & Sync P2P";
    return "Dashboard";
  }, [location.pathname]);

  // Honest sync pill status (Section 6.5) with compact mobile summary
  const syncPillMeta = React.useMemo(() => {
    switch (syncStatus.state) {
      case "syncing":
        return {
          dotClass: "bg-primary animate-pulse",
          text: `Sinkronisasi aktif (${syncStatus.peers} peer)`,
          shortText: `Sync (${syncStatus.peers})`,
          borderClass: "border-primary/40 text-primary",
        };
      case "connecting":
        return {
          dotClass: "bg-amber-500 animate-pulse",
          text: "Menghubungkan ke peer...",
          shortText: "Menghubungkan...",
          borderClass: "border-amber-500/40 text-amber-500",
        };
      case "error":
        return {
          dotClass: "bg-rose-500",
          text: "Galat sinkronisasi (periksa jam perangkat)",
          shortText: "Galat Sync",
          borderClass: "border-rose-500/40 text-rose-500",
        };
      case "idle":
      default:
        if (syncStatus.peers > 0) {
          return {
            dotClass: "bg-emerald-500",
            text: `Tersinkron (${syncStatus.peers} peer online)`,
            shortText: `${syncStatus.peers} Peer Online`,
            borderClass: "border-border text-foreground",
          };
        }
        return {
          dotClass: "bg-muted-foreground",
          text: "Tidak ada perangkat lain yang online",
          shortText: "0 Peer Online",
          borderClass: "border-border text-muted-foreground",
        };
    }
  }, [syncStatus]);

  const navItems = [
    {
      to: "/books/$bookId/dashboard" as const,
      label: "Dashboard",
      shortLabel: "Dashboard",
    },
    {
      to: "/books/$bookId/transactions" as const,
      label: "Transaksi",
      shortLabel: "Transaksi",
    },
    {
      to: "/books/$bookId/accounts" as const,
      label: "Akun",
      shortLabel: "Akun",
    },
    {
      to: "/books/$bookId/categories" as const,
      label: "Kategori",
      shortLabel: "Kategori",
    },
    {
      to: "/books/$bookId/budgets" as const,
      label: "Anggaran",
      shortLabel: "Anggaran",
    },
    {
      to: "/books/$bookId/reports" as const,
      label: "Laporan Bulanan",
      shortLabel: "Laporan",
    },
    {
      to: "/books/$bookId/settings" as const,
      label: "Pengaturan & Sync",
      shortLabel: "Sync & Opsi",
    },
  ];

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      {/* Top Enterprise Emerald Tabular Header (Mobile & Desktop Optimized) */}
      <header className="border-b border-border bg-card">
        <div className="mx-auto max-w-7xl px-3 py-2.5 sm:px-4 sm:py-3">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            {/* Row 1 (Mobile) / Left Side (Desktop): Back Button + Book Switcher + Active Section */}
            <div className="flex min-w-0 items-center gap-1.5 sm:gap-2">
              <Link
                to="/"
                title="Kembali ke Daftar Buku Lokal"
                onClick={() => {
                  void tauriApi.closeBook(bookId).catch(() => {});
                }}
                className="inline-flex h-8 shrink-0 items-center justify-center rounded border border-border bg-background px-2.5 font-mono text-xs font-medium text-foreground shadow-none hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
              >
                <span className="sm:hidden">← Buku</span>
                <span className="hidden sm:inline">← Buku Lokal</span>
              </Link>

              <span className="hidden font-mono text-xs text-muted-foreground sm:inline">
                /
              </span>

              <select
                aria-label="Pemilih Buku Aktif"
                value={bookId}
                onChange={(e) => void handleSwitchBook(e.target.value)}
                className="h-8 min-w-0 flex-1 truncate rounded border border-border bg-background px-2.5 text-xs font-semibold text-foreground shadow-none focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary sm:max-w-[240px] sm:flex-initial"
              >
                {allBooks.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({b.kind})
                  </option>
                ))}
                <option value="__HOME__">── Kembali ke Daftar Buku ──</option>
              </select>

              <span className="hidden font-mono text-xs text-muted-foreground lg:inline">
                /
              </span>
              <span className="hidden truncate text-xs font-medium text-foreground lg:inline">
                {currentSectionLabel}
              </span>
            </div>

            {/* Row 2 (Mobile) / Right Side (Desktop): Sync Pill, Theme Toggle, Quick Add Tx */}
            <div className="flex items-center justify-between gap-1.5 sm:justify-end sm:gap-2">
              <div
                data-testid="sync-status-pill"
                title={syncPillMeta.text}
                className={`inline-flex h-8 min-w-0 items-center gap-1.5 rounded border bg-background px-2.5 font-mono text-[11px] shadow-none ${syncPillMeta.borderClass}`}
              >
                <span
                  className={`inline-block h-2 w-2 shrink-0 rounded-full ${syncPillMeta.dotClass}`}
                />
                <span className="truncate md:hidden">
                  {syncPillMeta.shortText}
                </span>
                <span className="hidden truncate md:inline">
                  {syncPillMeta.text}
                </span>
              </div>

              <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
                <button
                  type="button"
                  onClick={handleToggleTheme}
                  aria-label="Ganti Tema Warna"
                  title="Ganti Tema Gelap / Terang"
                  className="inline-flex h-8 items-center justify-center rounded border border-border bg-background px-2.5 font-mono text-[11px] font-medium text-foreground shadow-none hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
                >
                  <span className="sm:hidden">
                    {theme === "dark" ? "GELAP" : "TERANG"}
                  </span>
                  <span className="hidden sm:inline">
                    {theme === "dark" ? "TEMA: GELAP" : "TEMA: TERANG"}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setNewTransactionModalOpen(true)}
                  className="inline-flex h-8 items-center justify-center rounded-md border border-border bg-primary px-3 text-xs font-semibold text-primary-foreground shadow-none hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
                >
                  <span className="sm:hidden">+ Transaksi</span>
                  <span className="hidden sm:inline">+ Transaksi Baru</span>
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Navigation Strip: Tabular Grid on Mobile (Zero Scrollbar), Horizontal Strip on Desktop */}
        <nav
          aria-label="Navigasi Buku"
          className="mx-auto grid max-w-7xl grid-cols-4 border-t border-border bg-border gap-px sm:grid-cols-7 md:flex md:gap-0 md:bg-card md:px-4"
        >
          {navItems.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              params={{ bookId }}
              className="flex items-center justify-center bg-card px-2 py-2 text-center text-[11px] font-medium text-muted-foreground transition-colors last:col-span-2 hover:bg-muted/50 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary sm:last:col-span-1 md:whitespace-nowrap md:border-r md:border-border md:px-4 md:py-2.5 md:text-xs [&.active]:bg-background [&.active]:font-semibold [&.active]:text-primary [&.active]:underline [&.active]:decoration-primary [&.active]:decoration-2 [&.active]:underline-offset-4"
            >
              <span className="md:hidden">{item.shortLabel}</span>
              <span className="hidden md:inline">{item.label}</span>
            </Link>
          ))}
        </nav>
      </header>

      <main className="mx-auto w-full max-w-7xl flex-1 p-3 sm:p-4 md:p-6">
        <Outlet />
      </main>

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
