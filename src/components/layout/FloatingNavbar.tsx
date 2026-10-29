import * as React from "react";
import { Link, useLocation } from "@tanstack/react-router";
import {
  ArrowLeftRight,
  BarChart3,
  Home,
  Plus,
  Settings,
} from "lucide-react";

export interface FloatingNavbarProps {
  bookId: string;
  onAddTransaction: () => void;
  className?: string;
}

export interface NavItemConfig {
  to:
    | "/books/$bookId/dashboard"
    | "/books/$bookId/transactions"
    | "/books/$bookId/reports"
    | "/books/$bookId/settings";
  label: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  isActive: (pathname: string) => boolean;
}

export const FloatingNavbar: React.FC<FloatingNavbarProps> = ({
  bookId,
  onAddTransaction,
  className = "",
}) => {
  const location = useLocation();

  const navItems: NavItemConfig[] = React.useMemo(
    () => [
      {
        to: "/books/$bookId/dashboard",
        label: "Home",
        icon: Home,
        isActive: (p: string) => p.endsWith("/dashboard"),
      },
      {
        to: "/books/$bookId/transactions",
        label: "Transactions",
        icon: ArrowLeftRight,
        isActive: (p: string) => p.endsWith("/transactions"),
      },
      {
        to: "/books/$bookId/reports",
        label: "Reports",
        icon: BarChart3,
        isActive: (p: string) => p.endsWith("/reports"),
      },
      {
        to: "/books/$bookId/settings",
        label: "Settings",
        icon: Settings,
        isActive: (p: string) =>
          p.endsWith("/settings") ||
          p.endsWith("/accounts") ||
          p.endsWith("/categories") ||
          p.endsWith("/budgets"),
      },
    ],
    []
  );

  return (
    <div
      className={`pointer-events-none fixed inset-x-0 bottom-3.5 z-40 mx-auto flex w-[calc(100%-1.5rem)] max-w-md items-center justify-center sm:bottom-4 ${className}`}
    >
      {/* Unified Rounded Pill Navbar (Clean, Flat Surface, No Protrusions) */}
      <nav
        aria-label="Navigasi Buku"
        className="floating-navbar-pill pointer-events-auto flex w-full items-center justify-between rounded-full border border-zinc-200/80 bg-white/95 p-1.5 pl-2 pr-1.5 backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-900/95"
      >
        {/* Navigation Items (Home, Transactions, Reports, Settings) */}
        <div className="grid flex-1 grid-cols-4 items-center gap-0.5 sm:gap-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active = item.isActive(location.pathname);

            return (
              <Link
                key={item.to}
                to={item.to}
                params={{ bookId }}
                className={`group first:rounded-l-full relative flex flex-col items-center justify-center rounded-2xl px-1 py-1 transition-all duration-200 ${
                  active
                    ? "bg-emerald-50/80 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                    : "text-zinc-600 hover:bg-zinc-100/70 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-200"
                }`}
              >
                <Icon
                  className={`h-5 w-5 transition-transform duration-200 group-active:scale-90 ${
                    active
                      ? "scale-105 text-emerald-600 dark:text-emerald-400"
                      : "text-zinc-600 group-hover:text-zinc-900 dark:text-zinc-400 dark:group-hover:text-zinc-200"
                  }`}
                  strokeWidth={active ? 2.3 : 2}
                />
                <span
                  className={`mt-0.5 truncate text-[10px] leading-tight tracking-tight sm:text-[10.5px] ${
                    active
                      ? "font-semibold text-emerald-800 dark:text-emerald-300"
                      : "font-medium text-zinc-600 group-hover:text-zinc-900 dark:text-zinc-400 dark:group-hover:text-zinc-200"
                  }`}
                >
                  {item.label}
                </span>

                {/* Subtitle active pill indicator bar underneath label */}
                <span
                  className={`mt-0.5 h-[3px] rounded-full transition-all duration-200 ${
                    active
                      ? "w-4 scale-100 bg-gradient-to-r from-emerald-600 via-emerald-500 to-green-400 opacity-100"
                      : "w-0 scale-75 opacity-0"
                  }`}
                />
              </Link>
            );
          })}
        </div>

        {/* Action Button: Level Circular + Button with Money Green Gradient */}
        <div className="ml-1 flex shrink-0 items-center">
          <button
            type="button"
            data-testid="fab-add-transaction"
            aria-label="Tambah Transaksi Baru"
            title="Tambah Transaksi Baru"
            onClick={onAddTransaction}
            className="floating-navbar-fab group relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-emerald-600 via-emerald-500 to-green-400 text-white transition-all duration-200 hover:scale-105 active:scale-95 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500 sm:h-11 sm:w-11"
          >
            <Plus
              className="h-5 w-5 text-white transition-transform duration-200 group-hover:rotate-90 group-active:scale-90"
              strokeWidth={2.6}
            />
          </button>
        </div>
      </nav>
    </div>
  );
};

