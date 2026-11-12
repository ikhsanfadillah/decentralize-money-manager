import * as React from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeftRight,
  BookOpen,
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
} from "lucide-react";
import {
  bookQueryKeys,
  useBookFinance,
  useBookSyncEvents,
} from "../../hooks/useBookFinance";
import { tauriApi } from "../../lib/tauri-api";
import { formatDateShort } from "../../lib/date";
import {
  applyTheme,
  currentYearMonth,
  formatBookKindLabel,
  formatRupiah,
  getStoredTheme,
  type ThemeMode,
} from "../../lib/utils";
import { pushToast } from "../../lib/toast";
import { AiByokSettingsSection } from "./AiByokSettingsSection";
import { DeleteBookIllustration } from "./DeleteBookIllustration";
import { SettingsBookDrawers } from "./SettingsBookDrawers";

export { DeleteBookIllustration };

export interface SettingsPageProps {
  bookId: string;
}

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

      {/* Grup AI Agent (BYOK) */}
      <AiByokSettingsSection />

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

      <SettingsBookDrawers
        bookId={bookId}
        activeBook={activeBook}
        allBooks={allBooks}
        activeAccountsCount={activeAccounts.length}
        categoriesCount={categories.length}
        totalBalance={totalBalance}
        deviceId={deviceIdentityQuery.data?.device_id}
        isEditModalOpen={isEditModalOpen}
        setIsEditModalOpen={setIsEditModalOpen}
        deviceNameInput={deviceNameInput}
        setDeviceNameInput={setDeviceNameInput}
        isSavingDeviceName={setDeviceNameMutation.isPending}
        onSaveDeviceName={handleSaveDeviceName}
        isRenameBookDrawerOpen={isRenameBookDrawerOpen}
        setIsRenameBookDrawerOpen={setIsRenameBookDrawerOpen}
        bookNameDraft={bookNameDraft}
        setBookNameDraft={setBookNameDraft}
        isRenamingBook={renameBookMutation.isPending}
        onSaveBookName={handleSaveBookName}
        isDeleteBookConfirmOpen={isDeleteBookConfirmOpen}
        setIsDeleteBookConfirmOpen={setIsDeleteBookConfirmOpen}
        isDeletingBook={deleteBookMutation.isPending}
        onConfirmDeleteBook={handleConfirmDeleteBook}
        isSwitchBookDrawerOpen={isSwitchBookDrawerOpen}
        setIsSwitchBookDrawerOpen={setIsSwitchBookDrawerOpen}
        onSwitchBook={handleSwitchBook}
      />
    </div>
  );
};
