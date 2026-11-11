import { Link, useLocation } from "@tanstack/react-router";
import {
  ArrowLeftRight,
  DollarSign,
  Home,
  Target,
  TrendingUp,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import * as React from "react";

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
    | "/books/$bookId/budgets";
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
  const shouldReduceMotion = useReducedMotion();

  const leftNavItems: NavItemConfig[] = React.useMemo(
    () => [
      {
        to: "/books/$bookId/dashboard",
        label: "Home",
        icon: Home,
        isActive: (p: string) => p.endsWith("/dashboard"),
      },
      {
        to: "/books/$bookId/transactions",
        label: "Transaksi",
        icon: ArrowLeftRight,
        isActive: (p: string) => p.endsWith("/transactions"),
      },
    ],
    []
  );

  const rightNavItems: NavItemConfig[] = React.useMemo(
    () => [
      {
        to: "/books/$bookId/reports",
        label: "Laporan",
        icon: TrendingUp,
        isActive: (p: string) => p.endsWith("/reports"),
      },
      {
        to: "/books/$bookId/budgets",
        label: "Anggaran",
        icon: Target,
        isActive: (p: string) => p.endsWith("/budgets"),
      },
    ],
    []
  );

  const renderNavItem = (item: NavItemConfig) => {
    const Icon = item.icon;
    const active = item.isActive(location.pathname);

    return (
      <Link
        key={item.to}
        to={item.to}
        params={{ bookId }}
        aria-current={active ? "page" : undefined}
        className={`group relative flex flex-col items-center justify-center rounded-full px-1 py-1.5 transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary ${
          active
            ? "text-foreground"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        <Icon
          className={`h-5 w-5 transition-transform duration-200 group-active:scale-90 ${
            active
              ? "scale-105 text-foreground"
              : "text-muted-foreground group-hover:text-foreground"
          }`}
          strokeWidth={active ? 2.25 : 1.75}
        />
        <span
          className={`mt-0.5 truncate text-[10.5px] leading-tight tracking-tight ${
            active
              ? "font-semibold text-foreground"
              : "font-medium text-muted-foreground group-hover:text-foreground"
          }`}
        >
          {item.label}
        </span>

        {active ? (
          <motion.span
            layoutId="floating-navbar-active-bar"
            className="mt-0.5 h-[3px] w-4 rounded-full bg-cta-surface"
            transition={{
              type: "spring",
              stiffness: 450,
              damping: 35,
            }}
          />
        ) : (
          <span className="mt-0.5 h-[3px] w-0 opacity-0" />
        )}
      </Link>
    );
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{
        duration: shouldReduceMotion ? 0.08 : 0.22,
        ease: [0.22, 1, 0.36, 1],
      }}
      className={`pointer-events-none fixed inset-x-0 bottom-3.5 z-40 mx-auto flex w-[calc(100%-1.75rem)] max-w-md items-center justify-center sm:bottom-4 ${className}`}
    >
      {/* Floating Capsule Dock with Centered Neutral CTA FAB (+) */}
      <nav
        aria-label="Navigasi Buku"
        className="floating-navbar-pill pointer-events-auto grid w-full grid-cols-5 items-center gap-1 rounded-full border border-border/70 bg-dock/70 backdrop-blur-md px-2.5 py-1.5"
      >
        {leftNavItems.map(renderNavItem)}

        {/* Center Action Button: Circular High-Contrast + FAB */}
        <div className="flex items-center justify-center">
          <button
            type="button"
            data-testid="fab-add-transaction"
            aria-label="Tambah Transaksi Baru"
            title="Tambah Transaksi Baru"
            onClick={onAddTransaction}
            className="floating-navbar-fab group relative flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-cta-surface text-cta-foreground transition-transform duration-200 hover:scale-105 active:scale-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            <DollarSign
              className="h-5 w-5 transition-transform duration-200 group-hover:rotate-90"
              strokeWidth={2.4}
            />
          </button>
        </div>

        {rightNavItems.map(renderNavItem)}
      </nav>
    </motion.div>
  );
};
