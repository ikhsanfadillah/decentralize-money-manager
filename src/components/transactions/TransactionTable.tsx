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
import { Pencil, Trash2 } from "lucide-react";
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
              {cat.name} ({cat.kind === "EXPENSE" ? "Pengeluaran" : "Pemasukan"})
            </option>
          ))}
      </select>
    </div>

    {/* 4. Tipe Transaksi */}
    <div className="space-y-1 sm:col-span-2">
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
        className="flex h-9 w-full rounded-md border border-border bg-background px-3 py-1.5 text-xs text-foreground shadow-none focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
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

export interface TransactionItemProps {
  tx: TransactionView;
  isOpen?: boolean;
  onOpen?: () => void;
  onClose?: () => void;
  onEdit: (tx: TransactionView) => void;
  onDelete: (tx: TransactionView) => void;
}

/**
 * Modern vector illustration for transaction delete confirmation bottom drawer
 */
export const DeleteTransactionIllustration: React.FC<{ className?: string }> = ({
  className = "w-28 h-28 mx-auto",
}) => (
  <svg
    viewBox="0 0 120 120"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    role="img"
    aria-label="Konfirmasi Hapus Transaksi"
  >
    <defs>
      {/* Outer ambient glow */}
      <radialGradient id="deleteGlow" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stopColor="#f43f5e" stopOpacity="0.18" />
        <stop offset="100%" stopColor="#f43f5e" stopOpacity="0" />
      </radialGradient>
      {/* Receipt background */}
      <linearGradient id="receiptGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#ffffff" />
        <stop offset="100%" stopColor="#f8fafc" />
      </linearGradient>
      {/* Canister gradient */}
      <linearGradient id="binGrad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#f43f5e" />
        <stop offset="100%" stopColor="#e11d48" />
      </linearGradient>
    </defs>

    {/* Background Glow */}
    <circle cx="60" cy="60" r="54" fill="url(#deleteGlow)" />
    <circle
      cx="60"
      cy="60"
      r="44"
      fill="rgba(244, 63, 94, 0.06)"
      stroke="rgba(244, 63, 94, 0.15)"
      strokeWidth="1.5"
      strokeDasharray="4 4"
    />

    {/* Floating Paper Receipt (Tilted Left) */}
    <g transform="rotate(-10 44 48)">
      {/* Receipt body */}
      <path
        d="M 28 24 L 60 24 L 60 72 L 56 68 L 52 72 L 48 68 L 44 72 L 40 68 L 36 72 L 32 68 L 28 72 Z"
        fill="url(#receiptGrad)"
        stroke="#cbd5e1"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      {/* Receipt header bar */}
      <rect x="34" y="32" width="20" height="3" rx="1.5" fill="#f43f5e" />
      {/* Receipt text lines */}
      <rect x="34" y="40" width="16" height="2" rx="1" fill="#94a3b8" />
      <rect x="34" y="46" width="22" height="2" rx="1" fill="#cbd5e1" />
      <rect x="34" y="52" width="14" height="2" rx="1" fill="#cbd5e1" />
      {/* Tear / cross mark */}
      <line
        x1="34"
        y1="60"
        x2="48"
        y2="60"
        stroke="#f43f5e"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </g>

    {/* Modern Crimson Trash Bin */}
    <g>
      {/* Bin Body */}
      <path
        d="M 58 56 L 62 92 Q 62 96 66 96 L 86 96 Q 90 96 90 92 L 94 56 Z"
        fill="url(#binGrad)"
        stroke="#be123c"
        strokeWidth="1.5"
      />
      {/* Bin Ribs */}
      <line
        x1="68"
        y1="65"
        x2="70"
        y2="88"
        stroke="#ffffff"
        strokeOpacity="0.4"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <line
        x1="76"
        y1="65"
        x2="76"
        y2="88"
        stroke="#ffffff"
        strokeOpacity="0.4"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <line
        x1="84"
        y1="65"
        x2="82"
        y2="88"
        stroke="#ffffff"
        strokeOpacity="0.4"
        strokeWidth="2"
        strokeLinecap="round"
      />

      {/* Bin Rim */}
      <rect
        x="55"
        y="53"
        width="42"
        height="5"
        rx="2.5"
        fill="#e11d48"
        stroke="#be123c"
        strokeWidth="1.5"
      />

      {/* Bin Lid (Tilted open) */}
      <g transform="rotate(-18 76 50)">
        <rect
          x="54"
          y="47"
          width="44"
          height="4.5"
          rx="2"
          fill="#f43f5e"
          stroke="#be123c"
          strokeWidth="1.5"
        />
        <path
          d="M 70 47 Q 70 42 76 42 Q 82 42 82 47"
          fill="none"
          stroke="#be123c"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </g>
    </g>

    {/* Floating Coin (Gold Rp) */}
    <g transform="translate(18, 70)">
      <circle cx="8" cy="8" r="8" fill="#fbbf24" stroke="#d97706" strokeWidth="1.2" />
      <circle cx="8" cy="8" r="6" fill="#fde68a" />
      <text
        x="8"
        y="11"
        textAnchor="middle"
        fontSize="7.5"
        fontFamily="monospace"
        fontWeight="bold"
        fill="#b45309"
      >
        Rp
      </text>
    </g>

    {/* Sparkle & Warning Particles */}
    <path
      d="M 98 26 Q 98 32 104 32 Q 98 32 98 38 Q 98 32 92 32 Q 98 32 98 26 Z"
      fill="#f43f5e"
    />
    <path
      d="M 22 46 Q 22 50 26 50 Q 22 50 22 54 Q 22 50 18 50 Q 22 50 22 46 Z"
      fill="#f59e0b"
    />
    <circle cx="88" cy="40" r="1.5" fill="#f43f5e" />
    <circle cx="36" cy="18" r="1.5" fill="#f59e0b" />
    <circle cx="102" cy="74" r="2" fill="#fda4af" />
  </svg>
);

export const TransactionItem: React.FC<TransactionItemProps> = ({
  tx,
  isOpen: controlledIsOpen,
  onOpen,
  onClose,
  onEdit,
  onDelete,
}) => {
  const [internalOpen, setInternalOpen] = React.useState(false);
  const isCardOpen = controlledIsOpen !== undefined ? controlledIsOpen : internalOpen;

  const [offsetX, setOffsetX] = React.useState(isCardOpen ? -140 : 0);
  const [isDragging, setIsDragging] = React.useState(false);

  // Real-time position tracking to avoid React stale closures
  const currentOffsetRef = React.useRef(isCardOpen ? -140 : 0);
  const startXRef = React.useRef(0);
  const startYRef = React.useRef(0);
  const directionRef = React.useRef<"horizontal" | "vertical" | null>(null);
  const isPointerDownRef = React.useRef(false);
  const didSwipeRef = React.useRef(false);
  const lastOpenedAtRef = React.useRef(0);
  const isTouchRef = React.useRef(false);

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

  // Sync external controlled state
  React.useEffect(() => {
    if (isCardOpen) {
      currentOffsetRef.current = -140;
      setOffsetX(-140);
    } else {
      currentOffsetRef.current = 0;
      setOffsetX(0);
    }
  }, [isCardOpen]);

  const snapOpen = React.useCallback(() => {
    lastOpenedAtRef.current = Date.now();
    currentOffsetRef.current = -140;
    setOffsetX(-140);
    if (onOpen) {
      onOpen();
    } else {
      setInternalOpen(true);
    }
  }, [onOpen]);

  const snapClose = React.useCallback(() => {
    currentOffsetRef.current = 0;
    setOffsetX(0);
    if (onClose) {
      onClose();
    } else {
      setInternalOpen(false);
    }
  }, [onClose]);

  const isCardOpenRef = React.useRef(isCardOpen);
  isCardOpenRef.current = isCardOpen;

  const startDrag = React.useCallback((clientX: number, clientY: number) => {
    startXRef.current = clientX;
    startYRef.current = clientY;
    directionRef.current = null;
    didSwipeRef.current = false;
    isPointerDownRef.current = true;
  }, []);

  const moveDrag = React.useCallback((clientX: number, clientY: number) => {
    if (!isPointerDownRef.current) return;
    const dx = clientX - startXRef.current;
    const dy = clientY - startYRef.current;

    if (directionRef.current === null) {
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        directionRef.current =
          Math.abs(dx) >= Math.abs(dy) ? "horizontal" : "vertical";
        if (directionRef.current === "horizontal") {
          didSwipeRef.current = true;
          setIsDragging(true);
        }
      }
    }

    if (directionRef.current !== "horizontal") return;

    const base = isCardOpenRef.current ? -140 : 0;
    let target = base + dx;
    if (target > 0) {
      target = target * 0.15;
    } else if (target < -140) {
      const excess = -140 - target;
      target = -140 - excess * 0.2;
    }

    currentOffsetRef.current = target;
    setOffsetX(target);
  }, []);

  const endDrag = React.useCallback(() => {
    if (!isPointerDownRef.current) return;
    isPointerDownRef.current = false;
    setIsDragging(false);

    const offset = currentOffsetRef.current;

    if (directionRef.current === "horizontal") {
      if (isCardOpenRef.current) {
        if (offset > -105) {
          snapClose();
        } else {
          snapOpen();
        }
      } else {
        // Snap sticky open even on a light swipe (>= 15px left)
        if (offset < -15) {
          snapOpen();
        } else {
          snapClose();
        }
      }
    }
    directionRef.current = null;
  }, [snapOpen, snapClose]);

  // --- Touch Gesture Handlers ---
  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length !== 1) return;
    isTouchRef.current = true;
    startDrag(e.touches[0].clientX, e.touches[0].clientY);
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLDivElement>) => {
    if (!isPointerDownRef.current || e.touches.length !== 1) return;
    moveDrag(e.touches[0].clientX, e.touches[0].clientY);
  };

  const handleTouchEnd = () => {
    endDrag();
  };

  // --- Mouse Gesture Handlers (with window-level tracking so leaving card bounds never drops swipe) ---
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isTouchRef.current) {
      isTouchRef.current = false;
      return;
    }
    if (e.button !== 0) return;
    startDrag(e.clientX, e.clientY);

    const onWindowMouseMove = (ev: MouseEvent) => {
      moveDrag(ev.clientX, ev.clientY);
    };
    const onWindowMouseUp = () => {
      window.removeEventListener("mousemove", onWindowMouseMove);
      window.removeEventListener("mouseup", onWindowMouseUp);
      endDrag();
    };

    window.addEventListener("mousemove", onWindowMouseMove);
    window.addEventListener("mouseup", onWindowMouseUp);
  };

  const handleContentClick = (e: React.MouseEvent<HTMLDivElement>) => {
    // Prevent post-drag synthetic click from immediately closing the newly opened card
    if (didSwipeRef.current || Date.now() - lastOpenedAtRef.current < 350) {
      didSwipeRef.current = false;
      e.stopPropagation();
      return;
    }
    if (isCardOpen) {
      snapClose();
    }
  };

  const handleEditClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    snapClose();
    onEdit(tx);
  };

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    snapClose();
    onDelete(tx);
  };

  return (
    <div
      data-testid={`tx-mobile-card-${tx.id}`}
      className="relative overflow-hidden bg-background select-none"
    >
      {/* Underneath: Action Buttons pinned to the right (Revealed on Swipe) */}
      <div className="absolute inset-y-0 right-0 z-0 flex items-stretch">
        <button
          type="button"
          onClick={handleEditClick}
          className="flex w-[70px] flex-col items-center justify-center gap-1 bg-sky-500 font-medium text-xs text-white hover:bg-sky-600 active:bg-sky-700 transition-colors focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-sky-500"
        >
          <Pencil className="h-4 w-4" />
          <span>Edit</span>
        </button>
        <button
          type="button"
          onClick={handleDeleteClick}
          className="flex w-[70px] flex-col items-center justify-center gap-1 bg-rose-600 font-medium text-xs text-white hover:bg-rose-700 active:bg-rose-800 transition-colors focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-rose-600"
        >
          <Trash2 className="h-4 w-4" />
          <span>Hapus</span>
        </button>
      </div>

      {/* Foreground: The Swipable Transaction Card Content */}
      <div
        style={{
          transform: `translateX(${offsetX}px)`,
          transition: isDragging
            ? "none"
            : isCardOpen
              ? "transform 0.44s cubic-bezier(0.34, 1.56, 0.64, 1)" // Bouncy iOS snap open
              : "transform 0.32s cubic-bezier(0.25, 1, 0.5, 1)", // Smooth snap close
        }}
        data-testid={`tx-swipe-surface-${tx.id}`}
        className="relative z-10 tabular-grid-cell px-3 py-2.5 transition-colors bg-card hover:bg-muted/25 touch-pan-y cursor-grab active:cursor-grabbing"
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
        onMouseDown={handleMouseDown}
        onDragStart={(e) => e.preventDefault()}
        onClick={handleContentClick}
      >
        {/* Row 1: Category (+ inline note) & Nominal */}
        <div className="flex items-baseline justify-between gap-2">
          <div className="flex min-w-0 flex-1 items-baseline gap-1.5">
            <span
              className={`h-1.5 w-1.5 shrink-0 self-center rounded-full ${dotColor}`}
              aria-hidden="true"
            />
            <span className="truncate text-xs font-semibold text-foreground">
              {title}
            </span>
            {tx.note && (
              <span className="truncate text-[11px] text-muted-foreground">
                · {tx.note}
              </span>
            )}
            {tx.link_id && (
              <span className="shrink-0 rounded border border-primary/40 px-1 py-0.2 text-[9px] font-medium text-primary">
                Pindah Buku
              </span>
            )}
          </div>

          <span
            className={`shrink-0 font-mono text-xs font-semibold tabular-nums tracking-tight ${amountColor}`}
          >
            {formatSignedRupiah(tx.amount, tx.tx_type)}
          </span>
        </div>

        {/* Row 2: Date, Account, Device */}
        <div className="mt-0.5 flex items-center justify-between gap-2 pl-3">
          <p
            title={`Tanggal: ${tx.tx_date} · Rekening: ${accountDisplay}`}
            className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground"
          >
            <span className="font-mono">{tx.tx_date}</span>
            <span className="mx-1.5 opacity-50">·</span>
            <span className="font-medium text-foreground/80">
              {accountDisplay}
            </span>
            <span className="sr-only">#{tx.created_by_device.slice(0, 6)}</span>
          </p>
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

  const [txPendingDelete, setTxPendingDelete] =
    React.useState<TransactionView | null>(null);
  const [openTxId, setOpenTxId] = React.useState<string | null>(null);

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
        header: "Jenis",
        cell: (info) => {
          const val = info.getValue();
          if (val === "EXPENSE") {
            return (
              <span className="inline-flex items-center rounded border border-rose-500/40 px-1.5 py-0.5 text-[11px] font-semibold text-rose-500">
                Pengeluaran
              </span>
            );
          }
          if (val === "INCOME") {
            return (
              <span className="inline-flex items-center rounded border border-emerald-500/40 px-1.5 py-0.5 text-[11px] font-semibold text-emerald-500">
                Pemasukan
              </span>
            );
          }
          return (
            <span className="inline-flex items-center rounded border border-sky-500/40 px-1.5 py-0.5 text-[11px] font-semibold text-sky-500">
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
                onClick={() => setTxPendingDelete(row)}
                className="rounded border border-border bg-background px-2 py-0.5 text-[11px] font-medium text-rose-500 shadow-none hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
              >
                Hapus
              </button>
            </div>
          );
        },
      }),
    ],
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
    <div className="w-full">
      {/* Compact Flush Search & Action Toolbar */}
      <div className="tabular-grid-container grid grid-cols-1">
        <div className="tabular-grid-cell flex flex-col gap-1.5 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
          {/* Group 1: Search Input + Filter Button */}
          <div className="flex flex-1 items-center gap-1.5 sm:max-w-md">
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
                className="h-8 pr-6 text-xs"
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
              className={`nav-touch-item inline-flex h-8 shrink-0 items-center gap-1 rounded border px-2.5 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary ${
                activeFilterCount > 0
                  ? "border-primary bg-primary/10 text-primary hover:bg-primary/20"
                  : "border-border bg-background text-foreground hover:bg-muted"
              }`}
            >
              <svg
                className="h-3 w-3 shrink-0"
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

          {/* Group 2: Sort Controls + Primary CTA Button */}
          <div className="flex items-center justify-between gap-1.5 sm:justify-end">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => toggleSort("tx_date")}
                className="nav-touch-item h-7 rounded border border-border bg-background px-2 font-mono text-[11px] text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
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
                className="nav-touch-item h-7 rounded border border-border bg-background px-2 font-mono text-[11px] text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
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
                  className="hidden h-7 rounded border border-border bg-background px-2 text-[11px] text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary md:inline-flex md:items-center"
                >
                  Reset Filter
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={onOpenNewTx}
              className="nav-touch-item inline-flex h-7 shrink-0 items-center justify-center rounded border border-border bg-primary px-2.5 text-[11px] font-semibold text-primary-foreground hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
            >
              <span className="sm:hidden">+ Catat</span>
              <span className="hidden sm:inline">+ Catat Transaksi</span>
            </button>
          </div>
        </div>

        {/* Active Filter Badges Strip */}
        {activeFilterCount > 0 && (
          <div className="tabular-grid-cell flex flex-wrap items-center gap-1.5 px-3 py-1.5 text-[11px]">
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Filter Aktif:
            </span>

            {filter.account_id && (
              <span className="inline-flex items-center gap-1 rounded border border-primary/40 bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] text-primary">
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
              <span className="inline-flex items-center gap-1 rounded border border-primary/40 bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] text-primary">
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
              <span className="inline-flex items-center gap-1 rounded border border-primary/40 bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] text-primary">
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
              <span className="inline-flex items-center gap-1 rounded border border-primary/40 bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] text-primary">
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
              <span className="inline-flex items-center gap-1 rounded border border-primary/40 bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] text-primary">
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
              <span className="inline-flex items-center gap-1 rounded border border-primary/40 bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] text-primary">
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
              <span className="inline-flex items-center gap-1 rounded border border-primary/40 bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] text-primary">
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
              className="text-[10px] text-muted-foreground underline hover:text-foreground"
            >
              Hapus Semua
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
      <div className="tabular-grid-container grid grid-cols-1">
        {/* Mobile View: Dedicated responsive card-list (Zero Double Border) */}
        <div className="grid grid-cols-1 gap-px bg-border md:hidden">
          {isLoading ? (
            <div className="tabular-grid-cell p-6 text-center text-xs text-muted-foreground">
              Memuat daftar transaksi...
            </div>
          ) : items.length === 0 ? (
            <div className="tabular-grid-cell p-6 text-center text-xs text-muted-foreground">
              Tidak ada transaksi yang cocok dengan filter saat ini.
            </div>
          ) : (
            items.map((tx) => (
              <TransactionItem
                key={tx.id}
                tx={tx}
                isOpen={openTxId === tx.id}
                onOpen={() => setOpenTxId(tx.id)}
                onClose={() => setOpenTxId(null)}
                onEdit={onEditTx}
                onDelete={(t) => setTxPendingDelete(t)}
              />
            ))
          )}
        </div>

        {/* Desktop View: Multi-column TanStack Table (hidden on mobile) */}
        <div className="tabular-grid-cell hidden overflow-x-auto md:block">
          <table className="w-full min-w-[640px] border-collapse text-left">
            <thead>
              {table.getHeaderGroups().map((headerGroup) => (
                <tr
                  key={headerGroup.id}
                  className="border-b border-border bg-muted/40"
                >
                  {headerGroup.headers.map((header) => (
                    <th
                      key={header.id}
                      className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
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
                    className="px-3 py-6 text-center text-xs text-muted-foreground"
                  >
                    Memuat daftar transaksi...
                  </td>
                </tr>
              ) : table.getRowModel().rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={columns.length}
                    className="px-3 py-6 text-center text-xs text-muted-foreground"
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
                      <td key={cell.id} className="px-3 py-2 align-middle">
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

        {/* Server-Side Pagination Footer (Zero Double Border) */}
        <div className="tabular-grid-cell flex flex-col gap-2 px-3 py-2 text-xs sm:flex-row sm:items-center sm:justify-between">
          <span className="text-center font-mono text-[11px] text-muted-foreground sm:text-left">
            Menampilkan {items.length} dari {total} transaksi · Halaman{" "}
            {currentPage} / {totalPages}
          </span>
          <div className="flex items-center justify-center gap-1.5 sm:justify-end">
            <button
              type="button"
              disabled={offset <= 0}
              onClick={() =>
                onFilterChange((prev) => ({
                  ...prev,
                  offset: Math.max(0, (prev.offset ?? 0) - limit),
                }))
              }
              className="nav-touch-item flex-1 rounded border border-border bg-background px-2.5 py-1 font-mono text-[11px] text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary disabled:opacity-40 sm:flex-initial"
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
              className="nav-touch-item flex-1 rounded border border-border bg-background px-2.5 py-1 font-mono text-[11px] text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary disabled:opacity-40 sm:flex-initial"
            >
              Berikutnya →
            </button>
          </div>
        </div>
      </div>

      {/* Delete Confirmation Bottom Drawer (Vaul) */}
      <Drawer
        open={txPendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setTxPendingDelete(null);
        }}
      >
        <DrawerContent
          aria-describedby="delete-confirm-desc"
          className="p-0 sm:mx-auto sm:max-w-md sm:rounded-t-2xl"
        >
          <div className="flex flex-col items-center px-4 pt-5 pb-2 text-center">
            {/* Vector Illustration */}
            <DeleteTransactionIllustration className="h-28 w-28 my-1" />

            <DrawerHeader className="p-0 mt-2 space-y-1 border-0">
              <DrawerTitle className="text-center text-base font-bold text-foreground sm:text-lg">
                Hapus Transaksi Ini?
              </DrawerTitle>
              <DrawerDescription
                id="delete-confirm-desc"
                className="text-center text-xs text-muted-foreground max-w-xs mx-auto"
              >
                Catatan transaksi ini akan dihapus dari buku kas. Saldo dompet akan
                disesuaikan kembali secara otomatis.
              </DrawerDescription>
            </DrawerHeader>

            {/* Transaction Receipt Preview Box */}
            {txPendingDelete && (
              <div className="w-full mt-3 rounded-lg border border-border bg-muted/40 p-3 text-left text-xs space-y-1.5">
                <div className="flex items-center justify-between font-semibold">
                  <span className="truncate text-foreground">
                    {txPendingDelete.tx_type === "TRANSFER"
                      ? `${txPendingDelete.account_name} → ${txPendingDelete.to_account_name ?? "-"}`
                      : (txPendingDelete.category_name ?? "Tanpa Kategori")}
                  </span>
                  <span
                    className={`font-mono font-bold tabular-nums tracking-tight ${
                      txPendingDelete.tx_type === "EXPENSE"
                        ? "text-rose-500"
                        : txPendingDelete.tx_type === "INCOME"
                          ? "text-emerald-500"
                          : "text-sky-500"
                    }`}
                  >
                    {formatSignedRupiah(
                      txPendingDelete.amount,
                      txPendingDelete.tx_type
                    )}
                  </span>
                </div>
                <div className="flex items-center justify-between font-mono text-[11px] text-muted-foreground">
                  <span>{txPendingDelete.tx_date}</span>
                  <span>{txPendingDelete.account_name}</span>
                </div>
                {txPendingDelete.note && (
                  <p className="border-t border-border/60 pt-1 text-[11px] text-muted-foreground italic">
                    "{txPendingDelete.note}"
                  </p>
                )}
              </div>
            )}
          </div>

          <DrawerFooter className="border-t border-border px-4 py-3 bg-card/60 backdrop-blur-xs flex flex-row items-center gap-2">
            <button
              type="button"
              onClick={() => setTxPendingDelete(null)}
              className="nav-touch-item flex-1 h-10 rounded-lg border border-border bg-background px-4 font-mono text-xs font-semibold text-muted-foreground hover:bg-muted hover:text-foreground active:scale-98 transition-all focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
            >
              Batal
            </button>
            <button
              type="button"
              onClick={() => {
                if (txPendingDelete) {
                  onDeleteTx(txPendingDelete.id);
                  setTxPendingDelete(null);
                }
              }}
              className="nav-touch-item flex-1 h-10 inline-flex items-center justify-center gap-1.5 rounded-lg bg-rose-600 px-4 text-xs font-semibold text-white shadow-xs hover:bg-rose-700 active:scale-98 transition-all focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-rose-600"
            >
              <Trash2 className="h-4 w-4" />
              <span>Hapus Transaksi</span>
            </button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </div>
  );
};

