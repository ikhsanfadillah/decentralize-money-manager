import * as React from "react";
import { flexRender } from "@tanstack/react-table";
import {
  getCoreRowModel,
  legacyCreateColumnHelper as createColumnHelper,
  useLegacyTable as useReactTable,
} from "@tanstack/react-table/legacy";
import { CurrencyInput } from "../ui/currency-input";
import { EmptyStateIllustration } from "../ui/EmptyStateIllustration";
import { Input } from "../ui/input";
import { useMediaQuery } from "../../hooks/useMediaQuery";
import {
  ArrowUpDown,
  Check,
  Filter,
  Loader2,
  Plus,
  RotateCcw,
  TrendingDown,
  TrendingUp,
  X,
} from "lucide-react";
import {
  DeleteTransactionDrawer,
  DeleteTransactionIllustration,
} from "./DeleteTransactionDrawer";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "../ui/drawer";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import type {
  AccountView,
  CategoryView,
  TransactionFilter,
  TransactionView,
} from "../../lib/tauri-api";
import {
  formatSignedRupiah,
  formatTxTypeLabel,
} from "../../lib/utils";
import { formatDateReadable } from "../../lib/date";

interface FilterFormProps {
  filter: TransactionFilter;
  accounts: AccountView[];
  categories: CategoryView[];
  onFilterChange: (
    updater:
      | TransactionFilter
      | ((prev: TransactionFilter) => TransactionFilter)
  ) => void;
}

const FilterForm: React.FC<FilterFormProps> = ({
  filter,
  accounts,
  categories,
  onFilterChange,
}) => (
  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
    {/* 1. Pencarian Kata Kunci */}
    <div className="space-y-1 sm:col-span-2">
      <label className="block font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
        Pencarian Kata Kunci
      </label>
      <Input
        placeholder="Cari catatan / akun / kategori..."
        value={filter.search ?? ""}
        onChange={(e) =>
          onFilterChange((prev) => ({
            ...prev,
            search: e.target.value || null,
            offset: 0,
          }))
        }
      />
    </div>

    {/* 2. Filter Akun */}
    <div className="space-y-1.5">
      <label className="block font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
        Filter Akun
      </label>
      <select
        value={filter.account_id ?? ""}
        onChange={(e) =>
          onFilterChange((prev) => ({
            ...prev,
            account_id: e.target.value || null,
            offset: 0,
          }))
        }
        className="flex h-10 w-full rounded-xl border border-border bg-black/[0.03] dark:bg-white/[0.06] px-3.5 py-2 text-xs text-foreground shadow-none focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
      >
        <option value="">Semua Akun</option>
        {accounts
          .filter((a) => a.merged_into_id === null)
          .map((acc) => (
            <option key={acc.id} value={acc.id}>
              {acc.name}
            </option>
          ))}
      </select>
    </div>

    {/* 3. Filter Kategori */}
    <div className="space-y-1.5">
      <label className="block font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
        Filter Kategori
      </label>
      <select
        value={filter.category_id ?? ""}
        onChange={(e) =>
          onFilterChange((prev) => ({
            ...prev,
            category_id: e.target.value || null,
            offset: 0,
          }))
        }
        className="flex h-10 w-full rounded-xl border border-border bg-black/[0.03] dark:bg-white/[0.06] px-3.5 py-2 text-xs text-foreground shadow-none focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
      >
        <option value="">Semua Kategori</option>
        {categories
          .filter((c) => c.merged_into_id === null)
          .map((cat) => (
            <option key={cat.id} value={cat.id}>
              {cat.name} ({cat.kind === "EXPENSE" ? "Pengeluaran" : "Pemasukan"})
            </option>
          ))}
      </select>
    </div>

    {/* 4. Tipe Transaksi */}
    <div className="space-y-1.5 sm:col-span-2">
      <label className="block font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
        Jenis Transaksi
      </label>
      <select
        value={filter.tx_type ?? ""}
        onChange={(e) =>
          onFilterChange((prev) => ({
            ...prev,
            tx_type:
              (e.target.value as TransactionFilter["tx_type"]) || null,
            offset: 0,
          }))
        }
        className="flex h-10 w-full rounded-xl border border-border bg-black/[0.03] dark:bg-white/[0.06] px-3.5 py-2 text-xs text-foreground shadow-none focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
      >
        <option value="">Semua Jenis Transaksi</option>
        <option value="EXPENSE">Pengeluaran</option>
        <option value="INCOME">Pemasukan</option>
        <option value="TRANSFER">Pindah Saldo Antar Rekening</option>
      </select>
    </div>

    {/* 5. Dari Tanggal */}
    <div className="space-y-1">
      <label className="block font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
        Dari Tanggal
      </label>
      <Input
        type="date"
        value={filter.start_date ?? ""}
        onChange={(e) =>
          onFilterChange((prev) => ({
            ...prev,
            start_date: e.target.value || null,
            offset: 0,
          }))
        }
        className="font-mono tabular-nums tracking-tight"
      />
    </div>

    {/* 6. Sampai Tanggal */}
    <div className="space-y-1">
      <label className="block font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
        Sampai Tanggal
      </label>
      <Input
        type="date"
        value={filter.end_date ?? ""}
        onChange={(e) =>
          onFilterChange((prev) => ({
            ...prev,
            end_date: e.target.value || null,
            offset: 0,
          }))
        }
        className="font-mono tabular-nums tracking-tight"
      />
    </div>

    {/* 7. Nominal Minimum */}
    <div className="space-y-1">
      <label className="block font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
        Nominal Minimum
      </label>
      <CurrencyInput
        aria-label="Filter Nominal Minimum"
        placeholder="Rp Min"
        value={filter.min_amount ?? null}
        onValueChange={(val) =>
          onFilterChange((prev) => ({
            ...prev,
            min_amount: val,
            offset: 0,
          }))
        }
      />
    </div>

    {/* 8. Nominal Maksimum */}
    <div className="space-y-1">
      <label className="block font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
        Nominal Maksimum
      </label>
      <CurrencyInput
        aria-label="Filter Nominal Maksimum"
        placeholder="Rp Maks"
        value={filter.max_amount ?? null}
        onValueChange={(val) =>
          onFilterChange((prev) => ({
            ...prev,
            max_amount: val,
            offset: 0,
          }))
        }
      />
    </div>
  </div>
);

export { DeleteTransactionIllustration };

export interface TransactionItemProps {
  tx: TransactionView;
  onEdit: (tx: TransactionView) => void;
}

export const TransactionItem: React.FC<TransactionItemProps> = ({
  tx,
  onEdit,
}) => {
  const isExpense = tx.tx_type === "EXPENSE";
  const isIncome = tx.tx_type === "INCOME";
  const isTransfer = tx.tx_type === "TRANSFER";

  const dotColor = isExpense
    ? "bg-rose-500"
    : isIncome
      ? "bg-emerald-500"
      : "bg-sky-500";

  const amountColor = isExpense
    ? "text-rose-500"
    : isIncome
      ? "text-emerald-500"
      : "text-sky-500";

  const title = isTransfer
    ? `${tx.account_name} → ${tx.to_account_name ?? "-"}`
    : (tx.category_name ?? "Tanpa Kategori");

  const accountDisplay = isTransfer ? "Pindah Saldo" : tx.account_name;

  return (
    <div
      data-testid={`tx-mobile-card-${tx.id}`}
      role="button"
      tabIndex={0}
      aria-label={`Detail dan edit transaksi ${title}`}
      onClick={() => onEdit(tx)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onEdit(tx);
        }
      }}
      className="group cursor-pointer bg-card px-4 py-3 transition-colors hover:bg-black/[0.03] active:bg-black/[0.05] dark:hover:bg-white/[0.04] dark:active:bg-white/[0.07] focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
    >
      {/* Row 1: Category (+ inline note) & Nominal */}
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          {isExpense ? (
            <TrendingDown
              className="h-3.5 w-3.5 shrink-0 self-center text-rose-400"
              aria-hidden="true"
            />
          ) : isIncome ? (
            <TrendingUp
              className="h-3.5 w-3.5 shrink-0 self-center text-emerald-400"
              aria-hidden="true"
            />
          ) : (
            <span
              className={`h-2 w-2 shrink-0 self-center rounded-full ${dotColor}`}
              aria-hidden="true"
            />
          )}
          <span className="truncate text-xs font-semibold text-foreground">
            {title}
          </span>
          {tx.note && (
            <span className="truncate text-[11px] text-muted-foreground">
              · {tx.note}
            </span>
          )}
          {tx.link_id && (
            <span className="shrink-0 rounded-full border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[9px] font-medium text-primary">
              Pindah Buku
            </span>
          )}
        </div>

        <span
          className={`shrink-0 font-mono text-xs font-bold tabular-nums tracking-tight ${amountColor}`}
        >
          {formatSignedRupiah(tx.amount, tx.tx_type)}
        </span>
      </div>

      {/* Row 2: Date, Account, Device */}
      <div className="mt-1 flex items-center justify-between gap-2 pl-5">
        <p
          title={`Tanggal: ${tx.tx_date} · Rekening: ${accountDisplay} · Dibuat oleh perangkat ID: ${tx.created_by_device.slice(0, 8)}`}
          className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground"
        >
          <span className="font-mono">
            {formatDateReadable(tx.tx_date)}
            <span className="sr-only"> ({tx.tx_date})</span>
          </span>
          <span className="mx-1.5 opacity-50">·</span>
          <span className="font-medium text-foreground/80">
            {accountDisplay}
          </span>
          <span className="sr-only">#{tx.created_by_device.slice(0, 6)}</span>
        </p>
      </div>
    </div>
  );
};

export interface TransactionTableProps {
  items: TransactionView[];
  total: number;
  filter: TransactionFilter;
  accounts: AccountView[];
  categories: CategoryView[];
  isLoading?: boolean;
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  isLoadMoreError?: boolean;
  onLoadMore?: () => void;
  onFilterChange: (
    updater:
      | TransactionFilter
      | ((prev: TransactionFilter) => TransactionFilter)
  ) => void;
  onResetFilter: () => void;
  onEditTx: (tx: TransactionView) => void;
  onDeleteTx: (txId: string) => void;
  onOpenNewTx: () => void;
}

const columnHelper = createColumnHelper<TransactionView>();

export const TransactionTable: React.FC<TransactionTableProps> = ({
  items,
  total,
  filter,
  accounts,
  categories,
  isLoading = false,
  hasNextPage = false,
  isFetchingNextPage = false,
  isLoadMoreError = false,
  onLoadMore,
  onFilterChange,
  onResetFilter,
  onEditTx,
  onDeleteTx,
  onOpenNewTx,
}) => {
  const [txPendingDelete, setTxPendingDelete] =
    React.useState<TransactionView | null>(null);
  const [showDelayedLoading, setShowDelayedLoading] = React.useState(false);

  React.useEffect(() => {
    if (!isLoading) {
      setShowDelayedLoading(false);
      return;
    }
    const timer = window.setTimeout(() => {
      setShowDelayedLoading(true);
    }, 180);
    return () => {
      window.clearTimeout(timer);
    };
  }, [isLoading]);

  const loadMoreSentinelRef = React.useRef<HTMLDivElement | null>(null);
  const inFlightScrollTriggerRef = React.useRef(false);
  const scrollStateRef = React.useRef({
    hasNextPage,
    isFetchingNextPage,
    isLoadMoreError,
    onLoadMore,
  });
  scrollStateRef.current = {
    hasNextPage,
    isFetchingNextPage,
    isLoadMoreError,
    onLoadMore,
  };

  const tryTriggerLoadMore = React.useCallback(() => {
    const state = scrollStateRef.current;
    if (
      state.hasNextPage &&
      !state.isFetchingNextPage &&
      !state.isLoadMoreError &&
      state.onLoadMore &&
      !inFlightScrollTriggerRef.current
    ) {
      inFlightScrollTriggerRef.current = true;
      state.onLoadMore();
    }
  }, []);

  // Reset in-flight lock whenever loaded count settles or fetching completes
  React.useEffect(() => {
    if (!isFetchingNextPage) {
      inFlightScrollTriggerRef.current = false;
    }
  }, [items.length, isFetchingNextPage, filter, isLoadMoreError]);

  // Observe sentinel element with IntersectionObserver when available.
  // Re-observing after items.length or isFetchingNextPage changes ensures
  // the browser re-evaluates fresh viewport geometry (handles tall 4K screens
  // without stale-visibility races when a new page pushes the sentinel offscreen).
  React.useEffect(() => {
    const el = loadMoreSentinelRef.current;
    if (
      !el ||
      !hasNextPage ||
      isFetchingNextPage ||
      isLoadMoreError ||
      !onLoadMore ||
      typeof IntersectionObserver === "undefined"
    ) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          tryTriggerLoadMore();
        }
      },
      { root: null, rootMargin: "240px 0px", threshold: 0 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [
    items.length,
    hasNextPage,
    isFetchingNextPage,
    isLoadMoreError,
    onLoadMore,
    tryTriggerLoadMore,
  ]);

  // Fallback window scroll listener for rapid scrolling and environments without IntersectionObserver
  React.useEffect(() => {
    if (!hasNextPage || isFetchingNextPage || isLoadMoreError || !onLoadMore) {
      return;
    }

    const handleWindowScroll = () => {
      if (inFlightScrollTriggerRef.current) return;
      const el = loadMoreSentinelRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const viewportHeight =
        window.innerHeight || document.documentElement.clientHeight;
      if (rect.top <= viewportHeight + 240) {
        tryTriggerLoadMore();
      }
    };

    window.addEventListener("scroll", handleWindowScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleWindowScroll);
  }, [
    hasNextPage,
    isFetchingNextPage,
    isLoadMoreError,
    onLoadMore,
    tryTriggerLoadMore,
  ]);

  const columns = React.useMemo(
    () =>
      columnHelper.columns([
        columnHelper.accessor("tx_date", {
        header: "Tanggal",
        cell: (info) => (
          <span
            className="text-xs tracking-tight text-foreground"
            title={info.getValue()}
          >
            {formatDateReadable(info.getValue())}
          </span>
        ),
      }),
      columnHelper.accessor("tx_type", {
        header: "Jenis",
        cell: (info) => {
          const val = info.getValue();
          if (val === "EXPENSE") {
            return (
              <span
                title="Pengeluaran"
                className="inline-flex items-center gap-1 rounded-full border border-rose-500/35 bg-rose-500/10 px-2 py-0.5 text-[11px] font-semibold text-rose-500 dark:text-rose-400"
              >
                <TrendingDown className="h-3 w-3 shrink-0" aria-hidden="true" />
                <span>Pengeluaran</span>
              </span>
            );
          }
          if (val === "INCOME") {
            return (
              <span
                title="Pemasukan"
                className="inline-flex items-center gap-1 rounded-full border border-emerald-500/35 bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400"
              >
                <TrendingUp className="h-3 w-3 shrink-0" aria-hidden="true" />
                <span>Pemasukan</span>
              </span>
            );
          }
          return (
            <span className="inline-flex items-center rounded-full border border-sky-500/35 bg-sky-500/10 px-2 py-0.5 text-[11px] font-semibold text-sky-600 dark:text-sky-400">
              Pindah Saldo
            </span>
          );
        },
      }),
      columnHelper.accessor("account_name", {
        header: "Rekening / Dompet",
        cell: (info) => {
          const row = info.row.original;
          return (
            <div className="text-xs">
              <span className="font-medium text-foreground">
                {row.account_name}
              </span>
              {row.tx_type === "TRANSFER" && row.to_account_name && (
                <span className="text-muted-foreground">
                  {" "}
                  → {row.to_account_name}
                </span>
              )}
            </div>
          );
        },
      }),
      columnHelper.accessor("category_name", {
        header: "Kategori & Catatan",
        cell: (info) => {
          const row = info.row.original;
          return (
            <div className="space-y-0.5 text-xs">
              <p className="font-medium text-foreground">
                {row.tx_type === "TRANSFER"
                  ? "Pindah Saldo Antar Rekening"
                  : (info.getValue() ?? "Tanpa Kategori")}
              </p>
              {row.note && (
                <p className="text-[11px] text-muted-foreground">{row.note}</p>
              )}
            </div>
          );
        },
      }),
      columnHelper.accessor("amount", {
        header: () => <div className="text-right">Nominal</div>,
        cell: (info) => {
          const row = info.row.original;
          const color =
            row.tx_type === "EXPENSE"
              ? "text-rose-500 dark:text-rose-400"
              : row.tx_type === "INCOME"
                ? "text-emerald-600 dark:text-emerald-400"
                : "text-sky-600 dark:text-sky-400";
          return (
            <div
              className={`text-right font-mono text-xs font-semibold tabular-nums tracking-tight ${color}`}
            >
              {formatSignedRupiah(row.amount, row.tx_type)}
            </div>
          );
        },
      }),
      columnHelper.display({
        id: "actions",
        header: () => <div className="text-right"></div>,
        cell: (info) => {
          const row = info.row.original;
          return (
            <div className="flex items-center justify-end gap-1.5">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onEditTx(row);
                }}
                className="rounded-full border border-border bg-black/[0.03] px-2.5 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-muted dark:bg-white/[0.05] focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setTxPendingDelete(row);
                }}
                className="rounded-full border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-[11px] font-medium text-rose-600 transition-colors hover:bg-rose-500/20 dark:text-rose-400 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
              >
                Hapus
              </button>
            </div>
          );
        },
      }),
    ]),
    [onEditTx]
  );

  const table = useReactTable({
    data: items,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
    rowCount: total,
  });

  const [isFilterOpen, setIsFilterOpen] = React.useState(false);
  const [isSortOpen, setIsSortOpen] = React.useState(false);
  const isDesktop = useMediaQuery("(min-width: 640px)");

  const activeFilterCount = React.useMemo(() => {
    let count = 0;
    if (filter.search) count++;
    if (filter.account_id) count++;
    if (filter.category_id) count++;
    if (filter.tx_type) count++;
    if (filter.start_date) count++;
    if (filter.end_date) count++;
    if (filter.min_amount !== null && filter.min_amount !== undefined) count++;
    if (filter.max_amount !== null && filter.max_amount !== undefined) count++;
    return count;
  }, [filter]);

  const selectedAccountName = React.useMemo(() => {
    if (!filter.account_id) return null;
    return accounts.find((a) => a.id === filter.account_id)?.name ?? "Akun";
  }, [filter.account_id, accounts]);

  const selectedCategoryName = React.useMemo(() => {
    if (!filter.category_id) return null;
    return (
      categories.find((c) => c.id === filter.category_id)?.name ?? "Kategori"
    );
  }, [filter.category_id, categories]);

  const toggleSort = (col: "tx_date" | "amount" | "updated_hlc") => {
    onFilterChange((prev) => {
      const isSame = prev.sort_by === col;
      const nextDir = isSame && prev.sort_dir === "desc" ? "asc" : "desc";
      return {
        ...prev,
        sort_by: col,
        sort_dir: nextDir,
        offset: 0,
      };
    });
  };

  const isCustomSort = React.useMemo(() => {
    return Boolean(
      (filter.sort_by && filter.sort_by !== "tx_date") ||
      (filter.sort_dir && filter.sort_dir !== "desc")
    );
  }, [filter.sort_by, filter.sort_dir]);

  const hasActiveFilterOrSort = activeFilterCount > 0 || isCustomSort;

  const selectedSortLabel = React.useMemo(() => {
    if (!filter.sort_by || filter.sort_by === "tx_date") {
      return filter.sort_dir === "asc" ? "Tanggal (Terlama)" : "Tanggal (Terbaru)";
    }
    if (filter.sort_by === "amount") {
      return filter.sort_dir === "asc" ? "Nominal (Terkecil)" : "Nominal (Terbesar)";
    }
    if (filter.sort_by === "updated_hlc") {
      return "Terakhir Diperbarui";
    }
    return `${filter.sort_by}`;
  }, [filter.sort_by, filter.sort_dir]);

  const handleResetFilterAndSort = React.useCallback(() => {
    onResetFilter();
    onFilterChange((prev) => ({
      ...prev,
      sort_by: "tx_date",
      sort_dir: "desc",
      offset: 0,
    }));
  }, [onResetFilter, onFilterChange]);

  return (
    <div className="w-full space-y-4">
      {/* Compact Glass Search & Action Toolbar */}
      <div className="glass-card p-3 sm:p-4 space-y-2.5">
        <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
          {/* Row 1 (Mobile) / Left Group (Desktop): Search Input + Filter + Sort */}
          <div className="flex flex-1 items-center gap-2 sm:max-w-md">
            <div className="relative min-w-0 flex-1">
              <Input
                placeholder="Cari catatan / akun / kategori..."
                value={filter.search ?? ""}
                onChange={(e) =>
                  onFilterChange((prev) => ({
                    ...prev,
                    search: e.target.value || null,
                    offset: 0,
                  }))
                }
                className="h-9 pr-7 text-xs"
              />
              {filter.search && (
                <button
                  type="button"
                  onClick={() =>
                    onFilterChange((prev) => ({
                      ...prev,
                      search: null,
                      offset: 0,
                    }))
                  }
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 font-mono text-xs text-muted-foreground hover:text-foreground"
                  title="Hapus kata kunci"
                >
                  ×
                </button>
              )}
            </div>

            {/* Filter Button: Icon only on mobile, icon + text on desktop */}
            <button
              type="button"
              data-testid="filter-open-button"
              onClick={() => setIsFilterOpen(true)}
              aria-label="Filter"
              title="Filter Transaksi"
              className={`nav-touch-item inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary ${
                activeFilterCount > 0
                  ? "border-primary/40 bg-primary/15 text-primary hover:bg-primary/20"
                  : "border-border bg-black/[0.03] text-foreground hover:bg-muted dark:bg-white/[0.05]"
              }`}
            >
              <Filter className="h-3.5 w-3.5 shrink-0" />
              <span className="hidden sm:inline">Filter</span>
              {activeFilterCount > 0 && (
                <span className="inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-cta-surface px-1 font-mono text-[10px] font-bold text-cta-foreground">
                  {activeFilterCount}
                </span>
              )}
            </button>

            {/* Sort Button (Mobile: Icon only opening drawer) */}
            <button
              type="button"
              data-testid="sort-open-button"
              onClick={() => setIsSortOpen(true)}
              aria-label="Urutkan"
              title="Urutkan Transaksi"
              className={`nav-touch-item inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary sm:hidden ${
                isCustomSort
                  ? "border-primary/40 bg-primary/15 text-primary hover:bg-primary/20"
                  : "border-border bg-black/[0.03] text-foreground hover:bg-muted dark:bg-white/[0.05]"
              }`}
            >
              <ArrowUpDown className="h-3.5 w-3.5 shrink-0" />
            </button>

            {/* Reset Filter / Sort Button (Mobile: Icon only when active) */}
            {hasActiveFilterOrSort && (
              <button
                type="button"
                data-testid="reset-filter-sort-mobile-button"
                onClick={handleResetFilterAndSort}
                aria-label="Reset Filter dan Sort"
                title="Reset Filter & Sort"
                className="nav-touch-item inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-black/[0.03] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground dark:bg-white/[0.05] focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary sm:hidden"
              >
                <RotateCcw className="h-3.5 w-3.5 shrink-0" />
              </button>
            )}
          </div>

          {/* Desktop Right Group: Sort Controls + Primary CTA Button */}
          <div className="hidden sm:flex sm:items-center sm:justify-end sm:gap-2">
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => toggleSort("tx_date")}
                className={`nav-touch-item h-8 rounded-full border px-3 font-mono text-[11px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary ${
                  !filter.sort_by || filter.sort_by === "tx_date"
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-border bg-black/[0.03] text-foreground hover:bg-muted dark:bg-white/[0.05]"
                }`}
              >
                Urut Tanggal{" "}
                {!filter.sort_by || filter.sort_by === "tx_date"
                  ? filter.sort_dir === "asc"
                    ? "↑"
                    : "↓"
                  : ""}
              </button>
              <button
                type="button"
                onClick={() => toggleSort("amount")}
                className={`nav-touch-item h-8 rounded-full border px-3 font-mono text-[11px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary ${
                  filter.sort_by === "amount"
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-border bg-black/[0.03] text-foreground hover:bg-muted dark:bg-white/[0.05]"
                }`}
              >
                Urut Nominal{" "}
                {filter.sort_by === "amount"
                  ? filter.sort_dir === "asc"
                    ? "↑"
                    : "↓"
                  : ""}
              </button>

              {hasActiveFilterOrSort && (
                <button
                  type="button"
                  data-testid="reset-filter-sort-desktop-button"
                  onClick={handleResetFilterAndSort}
                  className="inline-flex h-8 items-center gap-1 rounded-full border border-border bg-black/[0.03] px-2.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground dark:bg-white/[0.05] focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
                >
                  <RotateCcw className="h-3 w-3 shrink-0" />
                  <span>Reset Filter / Sort</span>
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={onOpenNewTx}
              className="nav-touch-item inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-full bg-cta-surface px-3.5 text-xs font-semibold text-cta-foreground transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
            >
              <Plus className="h-3.5 w-3.5 shrink-0" />
              <span>Catat Transaksi</span>
            </button>
          </div>

          {/* Row 2 (Mobile only): Tombol Transaksi Full Width */}
          <div className="w-full sm:hidden">
            <button
              type="button"
              onClick={onOpenNewTx}
              className="nav-touch-item flex h-9 w-full items-center justify-center gap-1.5 rounded-full bg-cta-surface px-4 text-xs font-semibold text-cta-foreground transition-all hover:opacity-90 active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
            >
              <Plus size={16} className="shrink-0" />
              <span>Catat Transaksi</span>
            </button>
          </div>
        </div>

        {/* Active Filter & Sort Badges Strip */}
        {hasActiveFilterOrSort && (
          <div className="flex flex-wrap items-center gap-1.5 border-t border-border/60 pt-2.5 text-[11px]">
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Aktif:
            </span>

            {filter.account_id && (
              <span className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 font-mono text-[10px] text-primary">
                Akun: {selectedAccountName}
                <button
                  type="button"
                  onClick={() =>
                    onFilterChange((prev) => ({
                      ...prev,
                      account_id: null,
                      offset: 0,
                    }))
                  }
                  className="hover:text-foreground"
                >
                  ×
                </button>
              </span>
            )}

            {filter.category_id && (
              <span className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 font-mono text-[10px] text-primary">
                Kategori: {selectedCategoryName}
                <button
                  type="button"
                  onClick={() =>
                    onFilterChange((prev) => ({
                      ...prev,
                      category_id: null,
                      offset: 0,
                    }))
                  }
                  className="hover:text-foreground"
                >
                  ×
                </button>
              </span>
            )}

            {filter.tx_type && (
              <span className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 font-mono text-[10px] text-primary">
                {filter.tx_type === "EXPENSE" && (
                  <TrendingDown className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
                )}
                {filter.tx_type === "INCOME" && (
                  <TrendingUp className="h-2.5 w-2.5 shrink-0" aria-hidden="true" />
                )}
                Jenis: {formatTxTypeLabel(filter.tx_type)}
                <button
                  type="button"
                  onClick={() =>
                    onFilterChange((prev) => ({
                      ...prev,
                      tx_type: null,
                      offset: 0,
                    }))
                  }
                  className="hover:text-foreground"
                >
                  ×
                </button>
              </span>
            )}

            {filter.start_date && (
              <span className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 font-mono text-[10px] text-primary">
                Dari: {filter.start_date}
                <button
                  type="button"
                  onClick={() =>
                    onFilterChange((prev) => ({
                      ...prev,
                      start_date: null,
                      offset: 0,
                    }))
                  }
                  className="hover:text-foreground"
                >
                  ×
                </button>
              </span>
            )}

            {filter.end_date && (
              <span className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 font-mono text-[10px] text-primary">
                Sampai: {filter.end_date}
                <button
                  type="button"
                  onClick={() =>
                    onFilterChange((prev) => ({
                      ...prev,
                      end_date: null,
                      offset: 0,
                    }))
                  }
                  className="hover:text-foreground"
                >
                  ×
                </button>
              </span>
            )}

            {filter.min_amount !== null && filter.min_amount !== undefined && (
              <span className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 font-mono text-[10px] text-primary">
                Min: Rp {filter.min_amount.toLocaleString("id-ID")}
                <button
                  type="button"
                  onClick={() =>
                    onFilterChange((prev) => ({
                      ...prev,
                      min_amount: null,
                      offset: 0,
                    }))
                  }
                  className="hover:text-foreground"
                >
                  ×
                </button>
              </span>
            )}

            {filter.max_amount !== null && filter.max_amount !== undefined && (
              <span className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 font-mono text-[10px] text-primary">
                Maks: Rp {filter.max_amount.toLocaleString("id-ID")}
                <button
                  type="button"
                  onClick={() =>
                    onFilterChange((prev) => ({
                      ...prev,
                      max_amount: null,
                      offset: 0,
                    }))
                  }
                  className="hover:text-foreground"
                >
                  ×
                </button>
              </span>
            )}

            {isCustomSort && (
              <span className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 font-mono text-[10px] text-primary">
                Urut: {selectedSortLabel}
                <button
                  type="button"
                  onClick={() =>
                    onFilterChange((prev) => ({
                      ...prev,
                      sort_by: "tx_date",
                      sort_dir: "desc",
                      offset: 0,
                    }))
                  }
                  className="hover:text-foreground"
                  title="Kembalikan urutan default"
                >
                  ×
                </button>
              </span>
            )}

            <button
              type="button"
              onClick={handleResetFilterAndSort}
              className="ml-auto inline-flex items-center gap-1 text-[10px] text-muted-foreground underline hover:text-foreground"
            >
              <RotateCcw className="h-2.5 w-2.5 shrink-0" />
              Reset Filter / Sort
            </button>
          </div>
        )}
      </div>

      {/* Desktop / Tab View: Centered Modal Dialog */}
      {isDesktop ? (
        <Dialog open={isFilterOpen} onOpenChange={setIsFilterOpen}>
          <DialogContent aria-describedby="filter-dialog-desc">
            <DialogHeader>
              <div>
                <DialogTitle>Filter Transaksi</DialogTitle>
                <DialogDescription id="filter-dialog-desc">
                  Saring data berdasarkan akun, kategori, jenis, tanggal, atau
                  nominal.
                </DialogDescription>
              </div>
              <DialogClose asChild>
                <button
                  type="button"
                  aria-label="Tutup"
                  title="Tutup"
                  className="rounded-full border border-border p-1.5 text-muted-foreground shadow-none transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
                >
                  <X className="h-4 w-4" />
                </button>
              </DialogClose>
            </DialogHeader>

            <div className="flex-1 overflow-y-auto p-5">
              <FilterForm
                filter={filter}
                accounts={accounts}
                categories={categories}
                onFilterChange={onFilterChange}
              />
            </div>

            <DialogFooter>
              <button
                type="button"
                onClick={onResetFilter}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-black/[0.04] px-3.5 py-2 font-mono text-xs text-muted-foreground shadow-none transition-colors hover:bg-muted hover:text-foreground dark:bg-white/[0.05] focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>Reset Filter</span>
              </button>

              <DialogClose asChild>
                <button
                  type="button"
                  className="rounded-full bg-cta-surface px-5 py-2 text-xs font-semibold text-cta-foreground shadow-none transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
                >
                  Terapkan & Selesai
                </button>
              </DialogClose>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : (
        /* Mobile View: Shadcn Drawer (Vaul) with native slidedown gesture */
        <Drawer open={isFilterOpen} onOpenChange={setIsFilterOpen}>
          <DrawerContent aria-describedby="filter-drawer-desc">
            <DrawerHeader>
              <div className="flex items-center justify-between">
                <div>
                  <DrawerTitle>Filter Transaksi</DrawerTitle>
                  <DrawerDescription id="filter-drawer-desc">
                    Saring data berdasarkan akun, kategori, jenis, tanggal, atau
                    nominal.
                  </DrawerDescription>
                </div>
                <DrawerClose asChild>
                  <button
                    type="button"
                    aria-label="Tutup"
                    title="Tutup"
                    className="rounded-full border border-border p-1.5 text-muted-foreground shadow-none transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </DrawerClose>
              </div>
            </DrawerHeader>

            <div className="flex-1 overflow-y-auto p-4">
              <FilterForm
                filter={filter}
                accounts={accounts}
                categories={categories}
                onFilterChange={onFilterChange}
              />
            </div>

            <DrawerFooter>
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={onResetFilter}
                  className="inline-flex items-center gap-1.5 rounded-full border border-border bg-black/[0.04] px-3.5 py-2 font-mono text-xs text-muted-foreground shadow-none transition-colors hover:bg-muted hover:text-foreground dark:bg-white/[0.05] focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span>Reset Filter</span>
                </button>

                <DrawerClose asChild>
                  <button
                    type="button"
                    className="rounded-full bg-cta-surface px-5 py-2 text-xs font-semibold text-cta-foreground shadow-none transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
                  >
                    Terapkan & Selesai
                  </button>
                </DrawerClose>
              </div>
            </DrawerFooter>
          </DrawerContent>
        </Drawer>
      )}

      {/* Mobile Sort Options Drawer */}
      <Drawer open={isSortOpen} onOpenChange={setIsSortOpen}>
        <DrawerContent aria-describedby="sort-drawer-desc">
          <DrawerHeader>
            <div className="flex items-center justify-between">
              <div>
                <DrawerTitle>Urutkan Transaksi</DrawerTitle>
                <DrawerDescription id="sort-drawer-desc">
                  Pilih cara pengurutan daftar transaksi.
                </DrawerDescription>
              </div>
              <DrawerClose asChild>
                <button
                  type="button"
                  aria-label="Tutup"
                  title="Tutup"
                  className="rounded-full border border-border p-1.5 text-muted-foreground shadow-none transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
                >
                  <X className="h-4 w-4" />
                </button>
              </DrawerClose>
            </div>
          </DrawerHeader>

          <div className="flex-1 overflow-y-auto p-4 space-y-2">
            {[
              {
                label: "Tanggal Terbaru",
                desc: "Transaksi paling baru di urutan teratas",
                by: "tx_date" as const,
                dir: "desc" as const,
              },
              {
                label: "Tanggal Terlama",
                desc: "Transaksi awal/lama di urutan teratas",
                by: "tx_date" as const,
                dir: "asc" as const,
              },
              {
                label: "Nominal Terbesar",
                desc: "Urutkan dari nilai nominal paling tinggi",
                by: "amount" as const,
                dir: "desc" as const,
              },
              {
                label: "Nominal Terkecil",
                desc: "Urutkan dari nilai nominal paling rendah",
                by: "amount" as const,
                dir: "asc" as const,
              },
              {
                label: "Terakhir Diperbarui",
                desc: "Berdasarkan perubahan data terakhir",
                by: "updated_hlc" as const,
                dir: "desc" as const,
              },
            ].map((opt) => {
              const currentBy = filter.sort_by ?? "tx_date";
              const currentDir = filter.sort_dir ?? "desc";
              const isSelected = currentBy === opt.by && currentDir === opt.dir;

              return (
                <button
                  key={`${opt.by}-${opt.dir}`}
                  type="button"
                  onClick={() => {
                    onFilterChange((prev) => ({
                      ...prev,
                      sort_by: opt.by,
                      sort_dir: opt.dir,
                      offset: 0,
                    }));
                    setIsSortOpen(false);
                  }}
                  className={`flex w-full items-center justify-between rounded-2xl border p-3.5 text-left transition-colors ${
                    isSelected
                      ? "border-primary/50 bg-primary/12 text-primary font-medium"
                      : "border-border bg-black/[0.03] text-foreground hover:bg-muted dark:bg-white/[0.04]"
                  }`}
                >
                  <div>
                    <div className="text-xs font-semibold">{opt.label}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {opt.desc}
                    </div>
                  </div>
                  {isSelected && (
                    <Check className="h-4 w-4 shrink-0 text-primary" />
                  )}
                </button>
              );
            })}
          </div>

          <DrawerFooter>
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => {
                  onFilterChange((prev) => ({
                    ...prev,
                    sort_by: "tx_date",
                    sort_dir: "desc",
                    offset: 0,
                  }));
                  setIsSortOpen(false);
                }}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-black/[0.04] px-3.5 py-2 font-mono text-xs text-muted-foreground shadow-none transition-colors hover:bg-muted hover:text-foreground dark:bg-white/[0.05] focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>Reset Urutan</span>
              </button>

              <DrawerClose asChild>
                <button
                  type="button"
                  className="rounded-full bg-cta-surface px-5 py-2 text-xs font-semibold text-cta-foreground shadow-none transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
                >
                  Selesai
                </button>
              </DrawerClose>
            </div>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      {/* Main Container: Mobile Card-List (md:hidden) & Desktop Table (md:block) */}
      <div className="glass-card overflow-hidden">
        {/* Mobile View: Clickable transaction card list */}
        <div className="divide-y divide-border/70 md:hidden">
          {isLoading ? (
            showDelayedLoading ? (
              <div className="animate-page-in p-6 text-center text-xs text-muted-foreground">
                Memuat daftar transaksi...
              </div>
            ) : (
              <div className="min-h-[160px]" aria-busy="true" />
            )
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-6 text-center text-xs text-muted-foreground">
              <EmptyStateIllustration variant="transaction-filter" />
              <span>Tidak ada transaksi yang cocok dengan filter saat ini.</span>
            </div>
          ) : (
            items.map((tx) => (
              <TransactionItem
                key={tx.id}
                tx={tx}
                onEdit={onEditTx}
              />
            ))
          )}
        </div>

        {/* Desktop View: Multi-column TanStack Table (hidden on mobile) */}
        <div className="hidden overflow-x-auto md:block">
          <table className="w-full min-w-[640px] border-collapse text-left">
            <thead>
              {table.getHeaderGroups().map((headerGroup) => (
                <tr
                  key={headerGroup.id}
                  className="border-b border-border/70 bg-black/[0.03] dark:bg-white/[0.04]"
                >
                  {headerGroup.headers.map((header) => (
                    <th
                      key={header.id}
                      className="px-4 py-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
                    >
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody className="divide-y divide-border/70">
              {isLoading ? (
                <tr>
                  <td
                    colSpan={columns.length}
                    className="px-4 py-8 text-center text-xs text-muted-foreground"
                  >
                    {showDelayedLoading ? (
                      <span className="animate-page-in">
                        Memuat daftar transaksi...
                      </span>
                    ) : (
                      <span className="inline-block h-24" aria-busy="true" />
                    )}
                  </td>
                </tr>
              ) : table.getRowModel().rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={columns.length}
                    className="px-4 py-8 text-center text-xs text-muted-foreground"
                  >
                    <div className="flex flex-col items-center justify-center">
                      <EmptyStateIllustration variant="transaction-filter" />
                      <span>Tidak ada transaksi yang cocok dengan filter saat ini.</span>
                    </div>
                  </td>
                </tr>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <tr
                    key={row.id}
                    data-testid={`tx-desktop-row-${row.original.id}`}
                    onClick={() => onEditTx(row.original)}
                    className="cursor-pointer transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="px-4 py-2.5 align-middle">
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext()
                        )}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Scroll Pagination Sentinel & Status Footer */}
        {(items.length > 0 || isFetchingNextPage) && (
          <div
            ref={loadMoreSentinelRef}
            data-testid="tx-scroll-sentinel"
            className="flex flex-col items-center justify-between gap-2 border-t border-border/70 bg-black/[0.02] px-4 py-3 text-xs dark:bg-white/[0.02] sm:flex-row"
          >
            <span className="text-center font-mono text-[11px] text-muted-foreground sm:text-left">
              Menampilkan {items.length} dari {total} transaksi
            </span>

            <div className="flex items-center justify-center gap-2 font-mono text-[11px] text-muted-foreground">
              {isFetchingNextPage ? (
                <span className="inline-flex items-center gap-1.5 text-primary">
                  <Loader2
                    className="h-3.5 w-3.5 animate-spin"
                    aria-hidden="true"
                  />
                  <span>Memuat transaksi berikutnya...</span>
                </span>
              ) : hasNextPage ? (
                isLoadMoreError ? (
                  <button
                    type="button"
                    onClick={onLoadMore}
                    className="nav-touch-item rounded-full border border-rose-500/35 bg-rose-500/10 px-3 py-1 font-sans text-[11px] font-semibold text-rose-500 transition-colors hover:bg-rose-500/20"
                  >
                    Gagal memuat · Ketuk untuk coba lagi
                  </button>
                ) : (
                  <span>Gulir untuk memuat lainnya</span>
                )
              ) : (
                <span>Semua transaksi telah ditampilkan</span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Delete Confirmation Bottom Drawer (Vaul) */}
      <DeleteTransactionDrawer
        tx={txPendingDelete}
        onClose={() => setTxPendingDelete(null)}
        onConfirmDelete={(txId) => {
          onDeleteTx(txId);
          setTxPendingDelete(null);
        }}
      />
    </div>
  );
};

