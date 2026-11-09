import * as React from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeftRight,
  BookOpen,
  Check,
  ChevronRight,
  Laptop,
  Moon,
  Pencil,
  PieChart,
  RefreshCw,
  ShieldCheck,
  Sun,
  Tags,
  Trash2,
  Wallet,
  X,
} from "lucide-react";
import {
  bookQueryKeys,
  useBookFinance,
  useBookSyncEvents,
} from "../../hooks/useBookFinance";
import { tauriApi } from "../../lib/tauri-api";
import { formatDateShort, formatRelativeTime } from "../../lib/date";
import {
  applyTheme,
  currentYearMonth,
  formatBookKindLabel,
  formatRupiah,
  getStoredTheme,
  type ThemeMode,
} from "../../lib/utils";
import { pushToast } from "../../lib/toast";
import { Input } from "../ui/input";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "../ui/drawer";

export interface SettingsPageProps {
  bookId: string;
}

/**
 * Vector illustration for book delete confirmation bottom drawer.
 * Matches the crimson warning visual language used across confirmation drawers.
 */
export const DeleteBookIllustration: React.FC<{ className?: string }> = ({
  className = "w-24 h-24 mx-auto",
}) => (
  <svg
    viewBox="0 0 120 120"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    role="img"
    aria-label="Konfirmasi Hapus Buku"
  >
    <defs>
      <radialGradient id="deleteBookGlow" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stopColor="#f43f5e" stopOpacity="0.18" />
        <stop offset="100%" stopColor="#f43f5e" stopOpacity="0" />
      </radialGradient>
      <linearGradient id="deleteBookCoverGrad" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#ffffff" />
        <stop offset="100%" stopColor="#f1f5f9" />
      </linearGradient>
      <linearGradient id="deleteBookBinGrad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#f43f5e" />
        <stop offset="100%" stopColor="#e11d48" />
      </linearGradient>
    </defs>

    {/* Ambient halo */}
    <circle cx="60" cy="60" r="54" fill="url(#deleteBookGlow)" />
    <circle
      cx="60"
      cy="60"
      r="44"
      fill="rgba(244, 63, 94, 0.06)"
      stroke="rgba(244, 63, 94, 0.15)"
      strokeWidth="1.5"
      strokeDasharray="4 4"
    />

    {/* Tilted Ledger Book (Left) */}
    <g transform="rotate(-10 43 49)">
      <rect
        x="24"
        y="22"
        width="36"
        height="48"
        rx="5"
        fill="url(#deleteBookCoverGrad)"
        stroke="#cbd5e1"
        strokeWidth="1.5"
      />
      {/* Book spine */}
      <rect
        x="24"
        y="22"
        width="8"
        height="48"
        rx="3"
        fill="#f43f5e"
        fillOpacity="0.85"
      />
      {/* Book label lines */}
      <rect x="36" y="31" width="18" height="3.5" rx="1.75" fill="#f43f5e" />
      <rect x="36" y="39" width="16" height="2" rx="1" fill="#94a3b8" />
      <rect x="36" y="45" width="13" height="2" rx="1" fill="#cbd5e1" />
      <rect x="36" y="54" width="18" height="2.5" rx="1.25" fill="#fda4af" />
    </g>

    {/* Crimson Trash Bin (Right) */}
    <g>
      <path
        d="M 58 56 L 62 92 Q 62 96 66 96 L 86 96 Q 90 96 90 92 L 94 56 Z"
        fill="url(#deleteBookBinGrad)"
        stroke="#be123c"
        strokeWidth="1.5"
      />
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
      <circle
        cx="8"
        cy="8"
        r="8"
        fill="#fbbf24"
        stroke="#d97706"
        strokeWidth="1.2"
      />
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

    {/* Sparkles */}
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

export const SettingsPage: React.FC<SettingsPageProps> = ({ bookId }) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const currentMonth = React.useMemo(() => currentYearMonth(), []);
  const syncStatus = useBookSyncEvents(bookId);
  const {
    accountsQuery,
    balancesQuery,
    categoriesQuery,
    budgetProgressQuery,
    deviceIdentityQuery,
    setDeviceNameMutation,
  } = useBookFinance({ bookId, budgetMonth: currentMonth });

  const booksQuery = useQuery({
    queryKey: bookQueryKeys.allBooks,
    queryFn: () => tauriApi.listBooks(),
  });

  const allBooks = React.useMemo(() => booksQuery.data ?? [], [booksQuery.data]);
  const activeBook = React.useMemo(
    () => allBooks.find((b) => b.id === bookId) ?? null,
    [allBooks, bookId]
  );

  const [theme, setTheme] = React.useState<ThemeMode>(() => getStoredTheme());
  const [isSwitchBookDrawerOpen, setIsSwitchBookDrawerOpen] =
    React.useState(false);

  const [isEditModalOpen, setIsEditModalOpen] = React.useState(false);
  const [deviceNameInput, setDeviceNameInput] = React.useState("");

  const [isRenameBookDrawerOpen, setIsRenameBookDrawerOpen] =
    React.useState(false);
  const [bookNameDraft, setBookNameDraft] = React.useState("");
  const [isDeleteBookConfirmOpen, setIsDeleteBookConfirmOpen] =
    React.useState(false);

  const activeAccounts = (accountsQuery.data ?? []).filter(
    (a) => !a.merged_into_id
  );
  const totalBalance = (balancesQuery.data ?? []).reduce(
    (acc, b) => acc + b.current_balance,
    0
  );
  const categories = categoriesQuery.data ?? [];
  const budgets = budgetProgressQuery.data ?? [];
  const overBudgetCount = budgets.filter((b) => b.status === "OVER").length;

  const renameBookMutation = useMutation({
    mutationFn: (newName: string) => tauriApi.renameBook(bookId, newName),
    onSuccess: (updated) => {
      void queryClient.invalidateQueries({
        queryKey: bookQueryKeys.allBooks,
        exact: true,
      });
      setIsRenameBookDrawerOpen(false);
      pushToast(`Nama buku diubah menjadi "${updated.name}"`, {
        variant: "success",
      });
    },
  });

  const deleteBookMutation = useMutation({
    mutationFn: () => tauriApi.deleteBook(bookId),
    onSuccess: async () => {
      setIsDeleteBookConfirmOpen(false);
      await queryClient.cancelQueries({
        queryKey: bookQueryKeys.bookRoot(bookId),
      });
      queryClient.removeQueries({
        queryKey: bookQueryKeys.bookRoot(bookId),
      });
      void queryClient.invalidateQueries({
        queryKey: bookQueryKeys.allBooks,
        exact: true,
      });
      pushToast("Buku berhasil dihapus dari perangkat ini", {
        variant: "info",
      });
      void navigate({ to: "/" });
    },
  });

  const handleOpenEditModal = () => {
    setDeviceNameInput(deviceIdentityQuery.data?.device_name ?? "");
    setIsEditModalOpen(true);
  };

  const handleSaveDeviceName = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = deviceNameInput.trim();
    if (!trimmed) {
      pushToast("Nama perangkat tidak boleh kosong", { variant: "error" });
      return;
    }
    try {
      await setDeviceNameMutation.mutateAsync(trimmed);
      pushToast("Nama perangkat berhasil diperbarui", { variant: "success" });
      setIsEditModalOpen(false);
    } catch (err: unknown) {
      pushToast(
        err instanceof Error ? err.message : "Gagal menyimpan nama perangkat",
        { variant: "error" }
      );
    }
  };

  const handleOpenRenameBookDrawer = () => {
    setBookNameDraft(activeBook?.name ?? "");
    setIsRenameBookDrawerOpen(true);
  };

  const handleSaveBookName = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = bookNameDraft.trim();
    if (!trimmed) {
      pushToast("Nama buku tidak boleh kosong", { variant: "warning" });
      return;
    }
    try {
      await renameBookMutation.mutateAsync(trimmed);
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Gagal mengubah nama buku";
      pushToast("Gagal mengubah nama buku", {
        description: msg,
        variant: "error",
      });
    }
  };

  const handleToggleTheme = () => {
    const next: ThemeMode = theme === "dark" ? "light" : "dark";
    setTheme(next);
    applyTheme(next);
  };

  const handleSwitchBook = async (targetBookId: string) => {
    setIsSwitchBookDrawerOpen(false);
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

  const syncBadgeMeta = React.useMemo(() => {
    switch (syncStatus.state) {
      case "syncing":
        return { dotClass: "bg-primary animate-pulse", label: "Sync" };
      case "connecting":
        return {
          dotClass: "bg-amber-400 animate-pulse",
          label: "Menghubungkan",
        };
      case "error":
        return { dotClass: "bg-rose-400", label: "Kendala" };
      case "idle":
      default:
        if (syncStatus.peers > 0) {
          return {
            dotClass: "bg-emerald-400",
            label: `${syncStatus.peers} Peer`,
          };
        }
        return { dotClass: "bg-emerald-400", label: "Lokal" };
    }
  }, [syncStatus]);

  const handleConfirmDeleteBook = async () => {
    try {
      await deleteBookMutation.mutateAsync();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Gagal menghapus buku";
      pushToast("Gagal menghapus buku", {
        description: msg,
        variant: "error",
      });
    }
  };

  return (
    <div className="w-full space-y-4">
      {/* Header Pengaturan */}
      <div className="glass-card px-4 py-3.5 sm:px-5">
        <h1 className="text-sm font-bold tracking-tight text-foreground sm:text-base">
          Pengaturan
        </h1>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Kelola buku keuangan, tampilan aplikasi, perangkat lokal, data buku,
          sinkronisasi P2P, dan cadangan terenkripsi.
        </p>
      </div>

      {/* Grup 0: Buku Keuangan Aktif & Switch Book */}
      <div className="space-y-2">
        <p className="px-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Buku Keuangan Aktif
        </p>
        <div className="glass-card overflow-hidden divide-y divide-border/70">
          <div className="flex items-center justify-between gap-3 px-4 py-3.5 sm:px-5">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-border bg-black/[0.04] text-primary dark:bg-white/[0.06]">
                <BookOpen className="h-5 w-5" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span
                    data-testid="active-book-name"
                    className="truncate text-xs font-semibold text-foreground sm:text-sm"
                  >
                    {activeBook?.name ?? (booksQuery.isPending ? "\u00A0" : "Buku Keuangan")}
                  </span>
                  {activeBook && (
                    <span className="shrink-0 rounded-full border border-border bg-black/[0.04] px-2 py-0.5 text-[10px] font-semibold text-muted-foreground dark:bg-white/[0.06]">
                      {formatBookKindLabel(activeBook.kind)}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                  {activeBook
                    ? `Dibuat ${formatDateShort(activeBook.created_at)} · ${activeAccounts.length} akun · ${categories.length} kategori`
                    : `ID: ${bookId}`}
                </p>
              </div>
            </div>

            <button
              type="button"
              data-testid="btn-rename-book"
              onClick={handleOpenRenameBookDrawer}
              className="nav-touch-item inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-black/[0.04] px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted dark:bg-white/[0.06] focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
            >
              <Pencil className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
              <span>Ubah Nama</span>
            </button>
          </div>

          <button
            type="button"
            data-testid="btn-switch-book"
            onClick={() => setIsSwitchBookDrawerOpen(true)}
            className="nav-touch-item group flex w-full items-center justify-between gap-3 px-4 py-3.5 text-left transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.04] focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary sm:px-5"
          >
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border bg-black/[0.04] text-primary dark:bg-white/[0.06]">
                <ArrowLeftRight className="h-4 w-4" strokeWidth={2.2} />
              </div>
              <div className="min-w-0">
                <span className="block truncate text-xs font-semibold text-foreground sm:text-sm">
                  Ganti Buku Keuangan
                </span>
                <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                  {allBooks.length > 1
                    ? "Beralih ke buku lain atau lihat semua buku lokal"
                    : "Lihat daftar buku lokal atau buat buku baru"}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="rounded-full border border-border bg-black/[0.04] px-2 py-0.5 font-mono text-[10px] font-semibold text-foreground dark:bg-white/[0.06]">
                {allBooks.length || 1} Buku
              </span>
              <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
            </div>
          </button>
        </div>
      </div>

      {/* Grup Tampilan: Dark Mode Toggle */}
      <div className="space-y-2">
        <p className="px-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Tampilan
        </p>
        <div className="glass-card flex items-center justify-between gap-3 px-4 py-3.5 sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-border bg-black/[0.04] text-primary dark:bg-white/[0.06]">
              {theme === "dark" ? (
                <Moon className="h-5 w-5" aria-hidden="true" />
              ) : (
                <Sun className="h-5 w-5 text-amber-500" aria-hidden="true" />
              )}
            </div>
            <div className="min-w-0">
              <span className="block truncate text-xs font-semibold text-foreground sm:text-sm">
                Mode Gelap
              </span>
              <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                {theme === "dark"
                  ? "Aktif · Tema gelap sedang digunakan"
                  : "Nonaktif · Tema terang sedang digunakan"}
              </p>
            </div>
          </div>

          <button
            type="button"
            role="switch"
            aria-checked={theme === "dark"}
            aria-label={
              theme === "dark"
                ? "Nonaktifkan mode gelap"
                : "Aktifkan mode gelap"
            }
            data-testid="settings-theme-toggle"
            onClick={handleToggleTheme}
            className={`nav-touch-item relative inline-flex h-7 w-12 shrink-0 cursor-pointer items-center rounded-full border p-0.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${
              theme === "dark"
                ? "border-transparent bg-cta-surface"
                : "border-border bg-black/15"
            }`}
          >
            <span
              className={`inline-block h-5 w-5 rounded-full transition-transform duration-200 ${
                theme === "dark"
                  ? "translate-x-5 bg-cta-foreground"
                  : "translate-x-0 bg-white"
              }`}
            />
          </button>
        </div>
      </div>

      {/* Identitas Perangkat */}
      <div className="space-y-2">
        <p className="px-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Identitas Perangkat Lokal
        </p>
        <div className="glass-card flex items-center justify-between gap-3 px-4 py-3.5 sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-border bg-black/[0.04] text-primary dark:bg-white/[0.06]">
              <Laptop className="h-5 w-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <span
                  data-testid="local-device-name"
                  className="truncate text-xs font-semibold text-foreground sm:text-sm"
                >
                  {deviceIdentityQuery.data?.device_name ||
                    (deviceIdentityQuery.isPending ? "\u00A0" : "Perangkat Ini")}
                </span>
                <span className="shrink-0 rounded-full border border-emerald-500/35 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                  Perangkat Ini
                </span>
              </div>
              <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                {deviceIdentityQuery.data?.device_id
                  ? `ID: ${deviceIdentityQuery.data.device_id}`
                  : "\u00A0"}
              </p>
            </div>
          </div>
          <button
            type="button"
            data-testid="btn-edit-device-name"
            onClick={handleOpenEditModal}
            className="nav-touch-item inline-flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-black/[0.04] px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted dark:bg-white/[0.06] focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
          >
            <Pencil className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
            <span>Ubah</span>
          </button>
        </div>
      </div>

      {/* Grup 1: Data Keuangan */}
      <div className="space-y-2">
        <p className="px-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Data Keuangan Buku
        </p>
        <div className="glass-card overflow-hidden divide-y divide-border/70">
          {/* 1. Accounts */}
          <Link
            to="/books/$bookId/accounts"
            params={{ bookId }}
            className="nav-touch-item group flex items-center justify-between gap-3 px-4 py-3.5 text-left transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.04] focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary sm:px-5"
          >
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border bg-black/[0.04] text-primary dark:bg-white/[0.06]">
                <Wallet className="h-4 w-4" strokeWidth={2.2} />
              </div>
              <span className="truncate text-xs font-semibold text-foreground sm:text-sm">
                Accounts
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="font-mono text-xs font-medium tabular-nums text-foreground">
                {formatRupiah(totalBalance)}
              </span>
              <span className="rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-primary">
                {activeAccounts.length} Akun
              </span>
              <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
            </div>
          </Link>

          {/* 2. Categories */}
          <Link
            to="/books/$bookId/categories"
            params={{ bookId }}
            className="nav-touch-item group flex items-center justify-between gap-3 px-4 py-3.5 text-left transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.04] focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary sm:px-5"
          >
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border bg-black/[0.04] text-primary dark:bg-white/[0.06]">
                <Tags className="h-4 w-4" strokeWidth={2.2} />
              </div>
              <span className="truncate text-xs font-semibold text-foreground sm:text-sm">
                Categories
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="rounded-full border border-border bg-black/[0.04] px-2 py-0.5 font-mono text-[10px] font-semibold text-foreground dark:bg-white/[0.06]">
                {categories.length} Kategori
              </span>
              <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
            </div>
          </Link>

          {/* 3. Budgets */}
          <Link
            to="/books/$bookId/budgets"
            params={{ bookId }}
            className="nav-touch-item group flex items-center justify-between gap-3 px-4 py-3.5 text-left transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.04] focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary sm:px-5"
          >
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border bg-black/[0.04] text-primary dark:bg-white/[0.06]">
                <PieChart className="h-4 w-4" strokeWidth={2.2} />
              </div>
              <span className="truncate text-xs font-semibold text-foreground sm:text-sm">
                Budgets
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {overBudgetCount > 0 ? (
                <span className="rounded-full border border-rose-500/35 bg-rose-500/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-rose-600 dark:text-rose-400">
                  {overBudgetCount} Over
                </span>
              ) : (
                <span className="rounded-full border border-border bg-black/[0.04] px-2 py-0.5 font-mono text-[10px] font-semibold text-foreground dark:bg-white/[0.06]">
                  {budgets.length} Target
                </span>
              )}
              <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
            </div>
          </Link>
        </div>
      </div>

      {/* Grup 2: Keamanan & Sinkronisasi P2P */}
      <div className="space-y-2">
        <p className="px-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Sinkronisasi &amp; Keamanan
        </p>
        <div className="glass-card overflow-hidden divide-y divide-border/70">
          {/* 4. Sinkronisasi Antar-Perangkat */}
          <Link
            to="/books/$bookId/sync"
            params={{ bookId }}
            data-testid="settings-cta-sync"
            className="nav-touch-item group flex items-center justify-between gap-3 px-4 py-3.5 text-left transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.04] focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary sm:px-5"
          >
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border bg-black/[0.04] text-primary dark:bg-white/[0.06]">
                <RefreshCw className="h-4 w-4" strokeWidth={2.2} />
              </div>
              <span className="truncate text-xs font-semibold text-foreground sm:text-sm">
                Sinkronisasi Antar-Perangkat
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-black/[0.04] px-2 py-0.5 font-mono text-[10px] text-muted-foreground dark:bg-white/[0.06]">
                <span
                  className={`inline-block h-1.5 w-1.5 rounded-full ${syncBadgeMeta.dotClass}`}
                />
                <span>{syncBadgeMeta.label}</span>
              </span>
              <span className="rounded-full border border-border bg-black/[0.04] px-2 py-0.5 font-mono text-[10px] text-muted-foreground dark:bg-white/[0.06]">
                P2P
              </span>
              <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
            </div>
          </Link>

          {/* 5. Cadangan Data Terenkripsi */}
          <Link
            to="/books/$bookId/backup"
            params={{ bookId }}
            data-testid="settings-cta-backup"
            className="nav-touch-item group flex items-center justify-between gap-3 px-4 py-3.5 text-left transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.04] focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary sm:px-5"
          >
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border bg-black/[0.04] text-primary dark:bg-white/[0.06]">
                <ShieldCheck className="h-4 w-4" strokeWidth={2.2} />
              </div>
              <span className="truncate text-xs font-semibold text-foreground sm:text-sm">
                Cadangan Buku Terenkripsi
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
            </div>
          </Link>
        </div>
      </div>

      {/* Grup 3: Zona Berbahaya (Hapus Buku) */}
      <div className="space-y-2">
        <p className="px-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-rose-600 dark:text-rose-400">
          Zona Berbahaya
        </p>
        <div className="glass-card flex flex-col md:flex-row md:items-center flex-wrap  justify-between gap-3 border-rose-500/25 px-4 py-3.5 sm:px-5">
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold text-foreground sm:text-sm">
              Hapus Buku Keuangan Ini
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Hapus permanen buku ini beserta seluruh transaksi dan anggarannya
              dari perangkat ini.
            </p>
          </div>
          <div className="">
            <button
              type="button"
              data-testid="btn-delete-book"
              onClick={() => setIsDeleteBookConfirmOpen(true)}
              className="nav-touch-item inline-flex shrink-0 items-center gap-1.5 rounded-full border border-rose-500/35 bg-rose-500/10 px-3.5 py-2 text-xs font-semibold text-rose-600 transition-colors hover:bg-rose-500/20 dark:text-rose-400 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-rose-500"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Hapus Buku</span>
            </button>
          </div>
        </div>
      </div>

      {/* Modal Edit Device Name */}
      {isEditModalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-device-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs animate-fade-in"
        >
          <div
            data-floating-surface="true"
            className="floating-surface w-full max-w-sm rounded-3xl border border-border p-5"
          >
            <div className="flex items-center justify-between border-b border-border/70 pb-3">
              <h3
                id="edit-device-modal-title"
                className="flex items-center gap-2 text-sm font-semibold text-foreground"
              >
                <Laptop className="h-4 w-4 text-primary" />
                <span>Ubah Nama Perangkat Ini</span>
              </h3>
              <button
                type="button"
                aria-label="Tutup"
                onClick={() => setIsEditModalOpen(false)}
                className="rounded-full border border-border p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveDeviceName} className="mt-4 space-y-4">
              <div>
                <label
                  htmlFor="input-device-name"
                  className="mb-1.5 block text-xs font-medium text-muted-foreground"
                >
                  Nama Label Perangkat
                </label>
                <input
                  id="input-device-name"
                  type="text"
                  value={deviceNameInput}
                  onChange={(e) => setDeviceNameInput(e.target.value)}
                  placeholder="Contoh: Laptop Kerja, HP Budi"
                  maxLength={64}
                  autoFocus
                  className="flex h-10 w-full rounded-xl border border-border bg-black/[0.04] px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground/60 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary dark:bg-white/[0.06]"
                />
                <p className="mt-1.5 text-[10px] text-muted-foreground">
                  ID teknis ({deviceIdentityQuery.data?.device_id}) tetap unik
                  dan tidak berubah.
                </p>
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-border/70 pt-3">
                <button
                  type="button"
                  onClick={() => setIsEditModalOpen(false)}
                  className="rounded-full border border-border bg-black/[0.04] px-4 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground dark:bg-white/[0.06]"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={setDeviceNameMutation.isPending}
                  className="rounded-full bg-cta-surface px-4 py-1.5 text-xs font-semibold text-cta-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
                >
                  {setDeviceNameMutation.isPending ? "Menyimpan..." : "Simpan"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Rename Book Drawer (Vaul) */}
      <Drawer
        open={isRenameBookDrawerOpen}
        onOpenChange={setIsRenameBookDrawerOpen}
        shouldScaleBackground={false}
      >
        <DrawerContent className="p-0 sm:mx-auto sm:max-w-md sm:rounded-t-3xl">
          <form
            onSubmit={(e) => void handleSaveBookName(e)}
            className="flex flex-col overflow-hidden"
          >
            <div className="flex shrink-0 items-center justify-between border-b border-border/70 px-5 py-4">
              <div>
                <DrawerTitle
                  id="rename-book-drawer-title"
                  className="text-sm font-bold text-foreground"
                >
                  Ubah Nama Buku Keuangan
                </DrawerTitle>
                <DrawerDescription className="mt-0.5 text-xs text-muted-foreground">
                  Perbarui nama buku catatan keuangan Anda.
                </DrawerDescription>
              </div>
              <button
                type="button"
                onClick={() => setIsRenameBookDrawerOpen(false)}
                aria-label="Tutup"
                className="nav-touch-item inline-flex h-8 w-8 items-center justify-center rounded-full border border-border bg-muted text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-4 px-5 py-4">
              <div className="space-y-1.5">
                <label
                  htmlFor="rename-book-name-input"
                  className="block text-xs font-medium text-foreground"
                >
                  Nama Buku Keuangan Baru
                </label>
                <Input
                  id="rename-book-name-input"
                  value={bookNameDraft}
                  onChange={(e) => setBookNameDraft(e.target.value)}
                  placeholder="Contoh: Uang Rumah Tangga, Tabungan, Usaha..."
                  maxLength={80}
                  autoFocus
                />
              </div>
            </div>

            <DrawerFooter className="flex flex-row items-center gap-2 border-t border-border/70 px-5 py-3.5">
              <button
                type="button"
                disabled={renameBookMutation.isPending}
                onClick={() => setIsRenameBookDrawerOpen(false)}
                className="nav-touch-item h-10 flex-1 rounded-full border border-border bg-black/[0.04] px-4 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50 dark:bg-white/[0.06] focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
              >
                Batal
              </button>
              <button
                type="submit"
                disabled={renameBookMutation.isPending}
                className="nav-touch-item h-10 flex-1 rounded-full bg-cta-surface px-5 text-xs font-semibold text-cta-foreground transition-opacity hover:opacity-90 active:scale-[0.98] disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
              >
                {renameBookMutation.isPending
                  ? "Menyimpan..."
                  : "Simpan Perubahan"}
              </button>
            </DrawerFooter>
          </form>
        </DrawerContent>
      </Drawer>

      {/* Dedicated Delete Book Confirmation Drawer */}
      <Drawer
        open={isDeleteBookConfirmOpen}
        onOpenChange={setIsDeleteBookConfirmOpen}
      >
        <DrawerContent
          aria-describedby="delete-book-confirm-desc"
          className="p-0 sm:mx-auto sm:max-w-md sm:rounded-t-3xl"
        >
          <div className="flex flex-col items-center px-5 pt-5 pb-3 text-center">
            <DeleteBookIllustration className="my-1 h-24 w-24" />

            <DrawerHeader className="mt-2 space-y-1 border-0 p-0">
              <DrawerTitle className="text-center text-base font-bold text-foreground sm:text-lg">
                Hapus Buku Ini?
              </DrawerTitle>
              <DrawerDescription
                id="delete-book-confirm-desc"
                className="mx-auto max-w-xs text-center text-xs text-muted-foreground"
              >
                Buku ini beserta seluruh rekening, kategori, transaksi, dan
                anggaran di dalamnya akan dihapus permanen dari perangkat ini.
                Tindakan ini tidak dapat dibatalkan.
              </DrawerDescription>
            </DrawerHeader>

            {/* Book Preview Box */}
            <div className="mt-3 w-full space-y-1.5 rounded-2xl border border-border bg-black/[0.04] p-3.5 text-left text-xs dark:bg-white/[0.05]">
              <div className="flex items-center justify-between gap-2 font-semibold">
                <span className="truncate text-sm text-foreground">
                  {activeBook?.name ?? "Buku Keuangan"}
                </span>
                {activeBook && (
                  <span className="shrink-0 rounded-full border border-border bg-black/[0.04] px-2 py-0.5 font-mono text-[10px] text-muted-foreground dark:bg-white/[0.06]">
                    {formatBookKindLabel(activeBook.kind)}
                  </span>
                )}
              </div>
              <div className="flex items-center justify-between border-t border-border/50 pt-1.5 text-xs text-muted-foreground">
                <span>
                  {activeAccounts.length} Akun · {categories.length} Kategori
                </span>
                <span className="font-mono font-bold tabular-nums text-foreground">
                  {formatRupiah(totalBalance)}
                </span>
              </div>
            </div>
          </div>

          <DrawerFooter className="flex flex-row items-center gap-2 border-t border-border/70 px-5 py-3.5">
            <button
              type="button"
              disabled={deleteBookMutation.isPending}
              onClick={() => setIsDeleteBookConfirmOpen(false)}
              className="nav-touch-item h-10 flex-1 rounded-full border border-border bg-black/[0.04] px-4 font-mono text-xs font-semibold text-muted-foreground transition-all hover:bg-muted hover:text-foreground active:scale-98 disabled:opacity-50 dark:bg-white/[0.06] focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
            >
              Batal
            </button>
            <button
              type="button"
              data-testid="confirm-delete-book-button"
              disabled={deleteBookMutation.isPending}
              onClick={() => void handleConfirmDeleteBook()}
              className="nav-touch-item inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-full bg-rose-600 px-4 text-xs font-semibold text-white transition-all hover:bg-rose-700 active:scale-98 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-rose-600"
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              <span>
                {deleteBookMutation.isPending ? "Menghapus..." : "Hapus Buku"}
              </span>
            </button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      {/* Switch Book Drawer (Vaul) */}
      <Drawer
        open={isSwitchBookDrawerOpen}
        onOpenChange={setIsSwitchBookDrawerOpen}
        shouldScaleBackground={false}
      >
        <DrawerContent className="max-h-[85vh] p-0 sm:mx-auto sm:max-w-md sm:rounded-t-3xl">
          <div className="flex shrink-0 items-center justify-between border-b border-border/70 px-5 py-4">
            <div>
              <DrawerTitle
                id="switch-book-drawer-title"
                className="text-sm font-bold text-foreground"
              >
                Ganti Buku Keuangan
              </DrawerTitle>
              <DrawerDescription className="mt-0.5 text-xs text-muted-foreground">
                Pilih buku lain di perangkat ini atau buka daftar semua buku.
              </DrawerDescription>
            </div>
            <button
              type="button"
              onClick={() => setIsSwitchBookDrawerOpen(false)}
              aria-label="Tutup"
              className="nav-touch-item inline-flex h-8 w-8 items-center justify-center rounded-full border border-border bg-muted text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex-1 space-y-2 overflow-y-auto px-5 py-4">
            {allBooks.map((b) => {
              const isCurrent = b.id === bookId;
              return (
                <button
                  key={b.id}
                  type="button"
                  data-testid={`switch-book-item-${b.id}`}
                  onClick={() => void handleSwitchBook(b.id)}
                  className={`nav-touch-item flex w-full items-center justify-between gap-3 rounded-2xl border p-3.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary ${
                    isCurrent
                      ? "border-primary/40 bg-primary/10"
                      : "border-border bg-black/[0.03] hover:bg-black/[0.06] dark:bg-white/[0.04] dark:hover:bg-white/[0.08]"
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                        isCurrent
                          ? "bg-cta-surface text-cta-foreground"
                          : "border border-border bg-black/[0.04] text-primary dark:bg-white/[0.06]"
                      }`}
                    >
                      <BookOpen className="h-4 w-4" aria-hidden="true" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate text-xs font-semibold text-foreground sm:text-sm">
                          {b.name}
                        </span>
                        <span className="shrink-0 rounded-full border border-border bg-black/[0.04] px-2 py-0.5 text-[10px] font-semibold text-muted-foreground dark:bg-white/[0.06]">
                          {formatBookKindLabel(b.kind)}
                        </span>
                      </div>
                      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                        Dibuka {formatRelativeTime(b.last_opened_at)}
                      </p>
                    </div>
                  </div>

                  {isCurrent ? (
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-cta-surface px-2.5 py-1 text-[10px] font-bold text-cta-foreground">
                      <Check className="h-3 w-3" aria-hidden="true" />
                      <span>Aktif</span>
                    </span>
                  ) : (
                    <ChevronRight
                      className="h-4 w-4 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                  )}
                </button>
              );
            })}
          </div>

          <DrawerFooter className="border-t border-border/70 px-5 py-3.5">
            <button
              type="button"
              data-testid="btn-view-all-books"
              onClick={() => void handleSwitchBook("__HOME__")}
              className="nav-touch-item inline-flex h-10 w-full items-center justify-center gap-2 rounded-full border border-border bg-black/[0.04] px-4 text-xs font-semibold text-foreground transition-colors hover:bg-muted dark:bg-white/[0.06] focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
            >
              <ArrowLeftRight
                className="h-3.5 w-3.5 text-primary"
                aria-hidden="true"
              />
              <span>Lihat Semua Buku &amp; Buat Baru</span>
            </button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </div>
  );
};
