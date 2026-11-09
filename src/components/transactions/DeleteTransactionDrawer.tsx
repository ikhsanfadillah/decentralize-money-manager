import * as React from "react";
import { Trash2 } from "lucide-react";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "../ui/drawer";
import type { TransactionView } from "../../lib/tauri-api";
import { formatSignedRupiah } from "../../lib/utils";
import { formatDateReadable } from "../../lib/date";

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

export interface DeleteTransactionDrawerProps {
  tx: TransactionView | null;
  isDeleting?: boolean;
  onClose: () => void;
  onConfirmDelete: (txId: string) => void | Promise<unknown>;
}

export const DeleteTransactionDrawer: React.FC<DeleteTransactionDrawerProps> = ({
  tx,
  isDeleting = false,
  onClose,
  onConfirmDelete,
}) => (
  <Drawer
    open={tx !== null}
    onOpenChange={(open) => {
      if (!open) onClose();
    }}
  >
    <DrawerContent
      aria-describedby="delete-confirm-desc"
      className="p-0 sm:mx-auto sm:max-w-md"
    >
      <div className="flex flex-col items-center px-5 pt-5 pb-3 text-center">
        {/* Vector Illustration */}
        <DeleteTransactionIllustration className="my-1 h-28 w-28" />

        <DrawerHeader className="mt-2 space-y-1 border-0 p-0">
          <DrawerTitle className="text-center text-base font-bold text-foreground sm:text-lg">
            Hapus Transaksi Ini?
          </DrawerTitle>
          <DrawerDescription
            id="delete-confirm-desc"
            className="mx-auto max-w-xs text-center text-xs text-muted-foreground"
          >
            Catatan transaksi ini akan dihapus dari buku kas. Saldo dompet akan
            disesuaikan kembali secara otomatis.
          </DrawerDescription>
        </DrawerHeader>

        {/* Transaction Receipt Preview Box */}
        {tx && (
          <div className="mt-3 w-full space-y-1.5 rounded-2xl border border-border bg-black/[0.03] p-3.5 text-left text-xs dark:bg-white/[0.05]">
            <div className="flex items-center justify-between font-semibold">
              <span className="truncate text-foreground">
                {tx.tx_type === "TRANSFER"
                  ? `${tx.account_name} → ${tx.to_account_name ?? "-"}`
                  : (tx.category_name ?? "Tanpa Kategori")}
              </span>
              <span
                className={`font-mono font-bold tabular-nums tracking-tight ${
                  tx.tx_type === "EXPENSE"
                    ? "text-rose-500"
                    : tx.tx_type === "INCOME"
                      ? "text-emerald-500"
                      : "text-sky-500"
                }`}
              >
                {formatSignedRupiah(tx.amount, tx.tx_type)}
              </span>
            </div>
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span title={tx.tx_date} className="font-medium text-foreground">
                {formatDateReadable(tx.tx_date, { withDayName: true })}
              </span>
              <span className="font-mono">{tx.account_name}</span>
            </div>
            {tx.note && (
              <p className="border-t border-border/60 pt-1 text-[11px] italic text-muted-foreground">
                "{tx.note}"
              </p>
            )}
          </div>
        )}
      </div>

      <DrawerFooter className="flex flex-row items-center gap-2 border-t border-border/70 px-5 py-3.5">
        <button
          type="button"
          onClick={onClose}
          className="nav-touch-item h-10 flex-1 rounded-full border border-border bg-black/[0.04] px-4 font-mono text-xs font-semibold text-muted-foreground transition-all hover:bg-muted hover:text-foreground active:scale-98 dark:bg-white/[0.05] focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
        >
          Batal
        </button>
        <button
          type="button"
          disabled={isDeleting}
          onClick={() => {
            if (tx) {
              void onConfirmDelete(tx.id);
            }
          }}
          className="nav-touch-item inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-full bg-rose-600 px-4 text-xs font-semibold text-white transition-all hover:bg-rose-700 active:scale-98 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-rose-600 disabled:opacity-50"
        >
          <Trash2 className="h-4 w-4" />
          <span>{isDeleting ? "Menghapus..." : "Hapus Transaksi"}</span>
        </button>
      </DrawerFooter>
    </DrawerContent>
  </Drawer>
);
