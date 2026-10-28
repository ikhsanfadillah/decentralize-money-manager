import * as React from "react";
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { CurrencyInput } from "../ui/currency-input";
import { Input } from "../ui/input";
import { useMediaQuery } from "../../hooks/useMediaQuery";
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
import { formatSignedRupiah } from "../../lib/utils";

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
    <div className="space-y-1">
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
        className="flex h-9 w-full rounded-md border border-border bg-background px-3 py-1.5 text-xs text-foreground shadow-none focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
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
    <div className="space-y-1">
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
        className="flex h-9 w-full rounded-md border border-border bg-background px-3 py-1.5 text-xs text-foreground shadow-none focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
      >
        <option value="">Semua Kategori</option>
        {categories
          .filter((c) => c.merged_into_id === null)
          .map((cat) => (
            <option key={cat.id} value={cat.id}>
              {cat.name} ({cat.kind})
            </option>
          ))}
      </select>
    </div>

    {/* 4. Tipe Transaksi */}
    <div className="space-y-1 sm:col-span-2">
      <label className="block font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
        Tipe Transaksi
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
        className="flex h-9 w-full rounded-md border border-border bg-background px-3 py-1.5 text-xs text-foreground shadow-none focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
      >
        <option value="">Semua Tipe Transaksi</option>
        <option value="EXPENSE">Pengeluaran (EXPENSE)</option>
        <option value="INCOME">Pemasukan (INCOME)</option>
        <option value="TRANSFER">Transfer Antar-Akun (TRANSFER)</option>
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

export interface TransactionItemProps {
  tx: TransactionView;
  onEdit: (tx: TransactionView) => void;
  onDelete: (txId: string) => void;
}

export const TransactionItem: React.FC<TransactionItemProps> = ({
  tx,
  onEdit,
  onDelete,
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

  const accountDisplay = isTransfer ? "Transfer Internal" : tx.account_name;

  return (
    <div
      data-testid={`tx-mobile-card-${tx.id}`}
      className="tabular-grid-cell group px-4 py-3 transition-colors hover:bg-muted/25"
    >
      {/* Row 1: Category (+ inline note) & Nominal */}
      <div className="flex items-baseline justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-baseline gap-2">
          <span
            className={`h-1.5 w-1.5 shrink-0 self-center rounded-full ${dotColor}`}
            aria-hidden="true"
          />
          <span className="truncate text-xs font-semibold text-foreground sm:text-sm">
            {title}
          </span>
          {tx.note && (
            <span className="truncate text-xs text-muted-foreground">
              · {tx.note}
            </span>
          )}
          {tx.link_id && (
            <span className="shrink-0 rounded border border-primary/40 px-1 py-0.2 font-mono text-[9px] text-primary">
              ANTAR-BUKU
            </span>
          )}
        </div>

        <span
          className={`shrink-0 font-mono text-xs font-semibold tabular-nums tracking-tight sm:text-sm ${amountColor}`}
        >
          {formatSignedRupiah(tx.amount, tx.tx_type)}
        </span>
      </div>

      {/* Row 2: Compact Metadata & Seamless Inline Actions */}
      <div className="mt-1 flex items-center justify-between gap-3 pl-3.5">
        <p
          title={`Tanggal: ${tx.tx_date} · Akun: ${accountDisplay} · Device: ${tx.created_by_device}`}
          className="min-w-0 flex-1 truncate font-mono text-[11px] text-muted-foreground"
        >
          <span>{tx.tx_date}</span>
          <span className="mx-1.5 opacity-50">·</span>
          <span className="text-foreground/80">{accountDisplay}</span>
          <span className="mx-1.5 opacity-50">·</span>
          <span className="text-[10px] opacity-75">
            #{tx.created_by_device.slice(0, 6)}
          </span>
        </p>

        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => onEdit(tx)}
            className="rounded px-1.5 py-0.5 font-mono text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
          >
            Edit
          </button>
          <span className="text-[10px] text-border select-none">·</span>
          <button
            type="button"
            onClick={() => onDelete(tx.id)}
            className="rounded px-1.5 py-0.5 font-mono text-[11px] font-medium text-rose-500/80 transition-colors hover:bg-rose-500/10 hover:text-rose-500 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
          >
            Hapus
          </button>
        </div>
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
  onFilterChange,
  onResetFilter,
  onEditTx,
  onDeleteTx,
  onOpenNewTx,
}) => {
  const limit = filter.limit ?? 25;
  const offset = filter.offset ?? 0;
  const currentPage = Math.floor(offset / limit) + 1;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  const columns = React.useMemo(
    () => [
      columnHelper.accessor("tx_date", {
        header: "Tanggal",
        cell: (info) => (
          <span className="font-mono text-xs tabular-nums tracking-tight text-foreground">
            {info.getValue()}
          </span>
        ),
      }),
      columnHelper.accessor("tx_type", {
        header: "Tipe",
        cell: (info) => {
          const val = info.getValue();
          if (val === "EXPENSE") {
            return (
              <span className="inline-flex items-center rounded border border-rose-500/40 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-rose-500">
                − EXPENSE
              </span>
            );
          }
          if (val === "INCOME") {
            return (
              <span className="inline-flex items-center rounded border border-emerald-500/40 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-emerald-500">
                + INCOME
              </span>
            );
          }
          return (
            <span className="inline-flex items-center rounded border border-sky-500/40 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-sky-500">
              ⇄ TRANSFER
            </span>
          );
        },
      }),
      columnHelper.accessor("account_name", {
        header: "Akun",
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
        header: "Kategori / Catatan",
        cell: (info) => {
          const row = info.row.original;
          return (
            <div className="space-y-0.5 text-xs">
              <p className="font-medium text-foreground">
                {row.tx_type === "TRANSFER"
                  ? "Mutasi Internal Antar-Akun"
                  : (info.getValue() ?? "Kategori tidak diketahui")}
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
              ? "text-rose-500"
              : row.tx_type === "INCOME"
                ? "text-emerald-500"
                : "text-sky-500";
          return (
            <div
              className={`text-right font-mono text-xs font-semibold tabular-nums tracking-tight ${color}`}
            >
              {formatSignedRupiah(row.amount, row.tx_type)}
            </div>
          );
        },
      }),
      columnHelper.accessor("created_by_device", {
        header: "Perangkat",
        cell: (info) => (
          <span
            title={`Dibuat oleh device ID: ${info.getValue()}`}
            className="rounded border border-border bg-background px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
          >
            {info.getValue()}
          </span>
        ),
      }),
      columnHelper.display({
        id: "actions",
        header: () => <div className="text-right">Aksi</div>,
        cell: (info) => {
          const row = info.row.original;
          return (
            <div className="flex items-center justify-end gap-1">
              <button
                type="button"
                onClick={() => onEditTx(row)}
                className="rounded border border-border bg-background px-2 py-0.5 text-[11px] font-medium text-foreground shadow-none hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => onDeleteTx(row.id)}
                className="rounded border border-border bg-background px-2 py-0.5 text-[11px] font-medium text-rose-500 shadow-none hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
              >
                Hapus
              </button>
            </div>
          );
        },
      }),
    ],
    [onDeleteTx, onEditTx]
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

  return (
    <div className="space-y-3.5">
      {/* Search & Action Toolbar */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        {/* Group 1: Search Input + Filter Button */}
        <div className="flex flex-1 items-center gap-1.5 sm:max-w-md sm:gap-2">
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
                className="absolute right-2 top-1/2 -translate-y-1/2 font-mono text-xs text-muted-foreground hover:text-foreground"
                title="Hapus kata kunci"
              >
                ×
              </button>
            )}
          </div>

          <button
            type="button"
            data-testid="filter-open-button"
            onClick={() => setIsFilterOpen(true)}
            className={`inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border px-3 text-xs font-semibold shadow-none transition-colors focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary ${
              activeFilterCount > 0
                ? "border-primary bg-primary/10 text-primary hover:bg-primary/20"
                : "border-border bg-card text-foreground hover:bg-muted"
            }`}
          >
            <svg
              className="h-3.5 w-3.5 shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
            </svg>
            <span>Filter</span>
            {activeFilterCount > 0 && (
              <span className="inline-flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary px-1 font-mono text-[10px] font-bold text-primary-foreground">
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>

        {/* Group 2: Sort Controls + Primary CTA Button (Single unified row on mobile & desktop) */}
        <div className="flex items-center justify-between gap-1.5 sm:justify-end sm:gap-2">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => toggleSort("tx_date")}
              className="h-9 rounded border border-border bg-card px-2.5 font-mono text-xs text-foreground shadow-none hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
            >
              Urut Tanggal{" "}
              {filter.sort_by === "tx_date"
                ? filter.sort_dir === "asc"
                  ? "↑"
                  : "↓"
                : ""}
            </button>
            <button
              type="button"
              onClick={() => toggleSort("amount")}
              className="h-9 rounded border border-border bg-card px-2.5 font-mono text-xs text-foreground shadow-none hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
            >
              Urut Nominal{" "}
              {filter.sort_by === "amount"
                ? filter.sort_dir === "asc"
                  ? "↑"
                  : "↓"
                : ""}
            </button>

            {activeFilterCount > 0 && (
              <button
                type="button"
                onClick={onResetFilter}
                className="hidden h-9 rounded border border-border bg-background px-2.5 text-xs text-muted-foreground shadow-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary md:inline-flex md:items-center"
              >
                Reset Filter
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={onOpenNewTx}
            className="inline-flex h-9 shrink-0 items-center justify-center rounded-md border border-border bg-primary px-3 text-xs font-semibold text-primary-foreground shadow-none hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary sm:px-3.5"
          >
            <span className="sm:hidden">+ Catat</span>
            <span className="hidden sm:inline">+ Catat Transaksi</span>
          </button>
        </div>
      </div>

      {/* Active Filter Badges Strip */}
      {activeFilterCount > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Filter Aktif:
          </span>

          {filter.account_id && (
            <span className="inline-flex items-center gap-1 rounded border border-primary/40 bg-primary/10 px-2 py-0.5 font-mono text-primary">
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
            <span className="inline-flex items-center gap-1 rounded border border-primary/40 bg-primary/10 px-2 py-0.5 font-mono text-primary">
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
            <span className="inline-flex items-center gap-1 rounded border border-primary/40 bg-primary/10 px-2 py-0.5 font-mono text-primary">
              Tipe: {filter.tx_type}
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
            <span className="inline-flex items-center gap-1 rounded border border-primary/40 bg-primary/10 px-2 py-0.5 font-mono text-primary">
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
            <span className="inline-flex items-center gap-1 rounded border border-primary/40 bg-primary/10 px-2 py-0.5 font-mono text-primary">
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
            <span className="inline-flex items-center gap-1 rounded border border-primary/40 bg-primary/10 px-2 py-0.5 font-mono text-primary">
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
            <span className="inline-flex items-center gap-1 rounded border border-primary/40 bg-primary/10 px-2 py-0.5 font-mono text-primary">
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

          <button
            type="button"
            onClick={onResetFilter}
            className="text-[11px] text-muted-foreground underline hover:text-foreground"
          >
            Hapus Semua
          </button>
        </div>
      )}

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
                  className="rounded border border-border px-2 py-1 font-mono text-xs text-muted-foreground shadow-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
                >
                  ESC
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
                className="rounded border border-border bg-background px-3 py-1.5 font-mono text-xs text-muted-foreground shadow-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
              >
                Reset Filter
              </button>

              <DialogClose asChild>
                <button
                  type="button"
                  className="rounded-md border border-border bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground shadow-none hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
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
                    className="rounded border border-border px-2 py-1 font-mono text-xs text-muted-foreground shadow-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
                  >
                    Tutup
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
                  className="rounded border border-border bg-background px-3 py-1.5 font-mono text-xs text-muted-foreground shadow-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
                >
                  Reset Filter
                </button>

                <DrawerClose asChild>
                  <button
                    type="button"
                    className="rounded-md border border-border bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground shadow-none hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
                  >
                    Terapkan & Selesai
                  </button>
                </DrawerClose>
              </div>
            </DrawerFooter>
          </DrawerContent>
        </Drawer>
      )}

      {/* Main Container: Mobile Card-List (md:hidden) & Desktop Table (md:block) */}
      <div className="tabular-grid-container">
        {/* Mobile View: Dedicated responsive card-list */}
        <div className="divide-y divide-border md:hidden">
          {isLoading ? (
            <div className="tabular-grid-cell p-8 text-center font-mono text-xs text-muted-foreground">
              Memuat data transaksi dari SQLite...
            </div>
          ) : items.length === 0 ? (
            <div className="tabular-grid-cell p-8 text-center text-xs text-muted-foreground">
              Tidak ada transaksi yang cocok dengan filter saat ini.
            </div>
          ) : (
            items.map((tx) => (
              <TransactionItem
                key={tx.id}
                tx={tx}
                onEdit={onEditTx}
                onDelete={onDeleteTx}
              />
            ))
          )}
        </div>

        {/* Desktop View: Multi-column TanStack Table (hidden on mobile) */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full min-w-[700px] border-collapse text-left">
            <thead>
              {table.getHeaderGroups().map((headerGroup) => (
                <tr
                  key={headerGroup.id}
                  className="border-b border-border bg-muted/50"
                >
                  {headerGroup.headers.map((header) => (
                    <th
                      key={header.id}
                      className="px-3.5 py-2.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
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
            <tbody className="divide-y divide-border bg-card">
              {isLoading ? (
                <tr>
                  <td
                    colSpan={columns.length}
                    className="px-4 py-8 text-center font-mono text-xs text-muted-foreground"
                  >
                    Memuat data transaksi dari SQLite...
                  </td>
                </tr>
              ) : table.getRowModel().rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={columns.length}
                    className="px-4 py-8 text-center text-xs text-muted-foreground"
                  >
                    Tidak ada transaksi yang cocok dengan filter saat ini.
                  </td>
                </tr>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <tr
                    key={row.id}
                    className="transition-colors hover:bg-muted/30"
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="px-3.5 py-2.5 align-middle">
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

        {/* Server-Side Pagination Footer (Responsive for Mobile & Desktop) */}
        <div className="flex flex-col gap-2.5 border-t border-border bg-card px-4 py-3 text-xs sm:flex-row sm:items-center sm:justify-between">
          <span className="text-center font-mono text-muted-foreground sm:text-left">
            Menampilkan {items.length} dari {total} transaksi · Halaman{" "}
            {currentPage} / {totalPages}
          </span>
          <div className="flex items-center justify-center gap-2 sm:justify-end">
            <button
              type="button"
              disabled={offset <= 0}
              onClick={() =>
                onFilterChange((prev) => ({
                  ...prev,
                  offset: Math.max(0, (prev.offset ?? 0) - limit),
                }))
              }
              className="flex-1 rounded border border-border bg-background px-3 py-1.5 font-mono text-xs text-foreground shadow-none hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary disabled:opacity-40 sm:flex-initial"
            >
              ← Sebelumnya
            </button>
            <button
              type="button"
              disabled={offset + limit >= total}
              onClick={() =>
                onFilterChange((prev) => ({
                  ...prev,
                  offset: (prev.offset ?? 0) + limit,
                }))
              }
              className="flex-1 rounded border border-border bg-background px-3 py-1.5 font-mono text-xs text-foreground shadow-none hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary disabled:opacity-40 sm:flex-initial"
            >
              Berikutnya →
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

