import * as React from "react";
import { Link, Outlet, useLocation } from "@tanstack/react-router";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { Eye, EyeOff, Settings } from "lucide-react";
import { type BookMetadata } from "../../lib/tauri-api";
import { useBookFinance, useBookSyncEvents } from "../../hooks/useBookFinance";
import { useUiStore } from "../../stores/ui-store";
import { TransactionDialog } from "../transactions/TransactionDialog";
import { FloatingNavbar } from "./FloatingNavbar";

export interface BookLayoutProps {
  bookId: string;
  bookMeta: BookMetadata;
}

export const BookLayout: React.FC<BookLayoutProps> = ({ bookId }) => {
  const location = useLocation();
  useBookSyncEvents(bookId);

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
  const isBalanceHidden = useUiStore((s) => s.isBalanceHidden);
  const toggleBalanceHidden = useUiStore((s) => s.toggleBalanceHidden);

  const {
    accountsQuery,
    categoriesQuery,
    addTransactionMutation,
    updateTransactionMutation,
    transferBetweenBooksMutation,
  } = useBookFinance({ bookId });

  const isSettingsActive = location.pathname.endsWith("/settings");

  return (
    <div className="flex min-h-screen flex-col text-foreground">
      {/* Minimalist Top App Bar */}
      <motion.header
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{
          duration: shouldReduceMotion ? 0.08 : 0.22,
          ease: [0.22, 1, 0.36, 1],
        }}
        className="sticky top-0 z-30 border-b border-border/70 bg-background/75 backdrop-blur-md"
      >
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
          {/* Left: Brand Logo + Title & Subtitle */}
          <Link
            to="/books/$bookId/dashboard"
            params={{ bookId }}
            className="flex min-w-0 items-center gap-3 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <svg
              viewBox="0 0 32 32"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              className="h-8 w-8 shrink-0 text-foreground"
              aria-hidden="true"
            >
              <path
                d="M3 13.5C3 8.80558 6.80558 5 11.5 5H13C14.1046 5 15 5.89543 15 7V24C15 25.1046 14.1046 26 13 26H7C4.79086 26 3 24.2091 3 22V13.5Z"
                fill="currentColor"
                fillOpacity="0.9"
              />
              <path
                d="M17 12.5C17 7.80558 20.8056 4 25.5 4H27C28.1046 4 29 4.89543 29 6V19.5C29 24.1944 25.1944 28 20.5 28H19C17.8954 28 17 27.1046 17 26V12.5Z"
                fill="currentColor"
              />
            </svg>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold leading-tight tracking-tight text-foreground sm:text-base">
                Money Manager
              </p>
              <p className="truncate text-[11px] leading-tight text-muted-foreground sm:text-xs">
                Take control of your money
              </p>
            </div>
          </Link>

          {/* Right: Privacy Eye Toggle + Settings Action */}
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              data-testid="navbar-privacy-toggle"
              onClick={toggleBalanceHidden}
              aria-label={
                isBalanceHidden ? "Tampilkan saldo" : "Sembunyikan saldo"
              }
              title={
                isBalanceHidden ? "Tampilkan nominal" : "Sembunyikan nominal"
              }
              className="nav-touch-item inline-flex h-10 w-10 items-center justify-center rounded-full border border-border/60 bg-black/[0.05] text-foreground transition-colors hover:bg-black/[0.1] dark:bg-white/[0.09] dark:hover:bg-white/[0.15] focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
            >
              {isBalanceHidden ? (
                <EyeOff className="h-[18px] w-[18px]" aria-hidden="true" />
              ) : (
                <Eye className="h-[18px] w-[18px]" aria-hidden="true" />
              )}
            </button>

            <Link
              to="/books/$bookId/settings"
              params={{ bookId }}
              data-testid="navbar-settings-link"
              aria-label="Pengaturan"
              aria-current={isSettingsActive ? "page" : undefined}
              title="Pengaturan"
              className={`nav-touch-item inline-flex h-10 w-10 items-center justify-center rounded-full border transition-colors focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary ${
                isSettingsActive
                  ? "border-transparent bg-cta-surface text-cta-foreground"
                  : "border-border/60 bg-black/[0.05] text-foreground hover:bg-black/[0.1] dark:bg-white/[0.09] dark:hover:bg-white/[0.15]"
              }`}
            >
              <Settings className="h-[18px] w-[18px]" aria-hidden="true" />
            </Link>
          </div>
        </div>
      </motion.header>

      {/* Main Content Container: Centered Responsive Shell with Safe Dock Clearance */}
      <main
        className="mx-auto w-full max-w-5xl flex-1 px-4 pt-4 sm:px-6 sm:pt-5"
        style={{
          paddingBottom:
            "calc(6.5rem + env(safe-area-inset-bottom, 24px))",
        }}
      >
        <AnimatePresence mode="wait">
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
              duration: shouldReduceMotion ? 0.08 : 0.22,
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
