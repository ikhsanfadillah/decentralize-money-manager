import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import {
  ChevronRight,
  PieChart,
  RefreshCw,
  Tags,
  Wallet,
} from "lucide-react";
import { useBookFinance, useBookSyncEvents } from "../../hooks/useBookFinance";
import { tauriApi, type InviteResponse } from "../../lib/tauri-api";
import { Input } from "../ui/input";
import { pushToast } from "../../lib/toast";
import { currentYearMonth, formatRupiah } from "../../lib/utils";

export interface SettingsPageProps {
  bookId: string;
}

export const SettingsPage: React.FC<SettingsPageProps> = ({ bookId }) => {
  const currentMonth = React.useMemo(() => currentYearMonth(), []);
  const syncStatus = useBookSyncEvents(bookId);
  const {
    peersQuery,
    accountsQuery,
    balancesQuery,
    categoriesQuery,
    budgetProgressQuery,
  } = useBookFinance({ bookId, budgetMonth: currentMonth });

  const [sectionView, setSectionView] = React.useState<"hub" | "sync">("hub");

  const [activeInvite, setActiveInvite] =
    React.useState<InviteResponse | null>(null);
  const [isQrRevealed, setIsQrRevealed] = React.useState(false);

  const [passphrase, setPassphrase] = React.useState("");
  const [confirmPassphrase, setConfirmPassphrase] = React.useState("");
  const [destinationPath, setDestinationPath] = React.useState(
    `backup-${bookId.slice(0, 8)}.fmm.enc`
  );
  const [lastExportedPath, setLastExportedPath] = React.useState<string | null>(
    null
  );

  // Section 6.5: Automatically hide QR secret when application goes to background or loses focus
  React.useEffect(() => {
    const handleVisibilityOrBlur = () => {
      if (document.visibilityState === "hidden") {
        setIsQrRevealed(false);
      }
    };
    const handleWindowBlur = () => {
      setIsQrRevealed(false);
    };

    document.addEventListener("visibilitychange", handleVisibilityOrBlur);
    window.addEventListener("blur", handleWindowBlur);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityOrBlur);
      window.removeEventListener("blur", handleWindowBlur);
    };
  }, []);

  const createInviteMutation = useMutation({
    mutationFn: () => tauriApi.createInvite(bookId, 600),
    onSuccess: (invite) => {
      setActiveInvite(invite);
      setIsQrRevealed(true);
      pushToast("Undangan P2P dibuat (berlaku 10 menit)", {
        variant: "info",
      });
    },
  });

  const exportBackupMutation = useMutation({
    mutationFn: () =>
      tauriApi.exportBookEncrypted(
        bookId,
        passphrase,
        destinationPath.trim()
      ),
    onSuccess: (savedPath) => {
      setLastExportedPath(savedPath);
      setPassphrase("");
      setConfirmPassphrase("");
      pushToast("Cadangan terenkripsi berhasil diekspor", {
        description: savedPath,
        variant: "success",
      });
    },
  });

  const handleGenerateInvite = async () => {
    try {
      await createInviteMutation.mutateAsync();
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Gagal membuat undangan P2P";
      pushToast("Gagal membuat undangan P2P", {
        description: msg,
        variant: "error",
      });
    }
  };

  const handleCopyInvite = async () => {
    if (!activeInvite) return;
    try {
      await navigator.clipboard.writeText(activeInvite.qr_json);
      pushToast("Payload undangan disalin ke clipboard", {
        variant: "success",
      });
    } catch {
      pushToast("Gagal menyalin ke clipboard", { variant: "error" });
    }
  };

  const handleExportEncrypted = async (e: React.FormEvent) => {
    e.preventDefault();
    if (passphrase.length < 8) {
      pushToast("Passphrase minimal harus 8 karakter", {
        variant: "warning",
      });
      return;
    }
    if (passphrase !== confirmPassphrase) {
      pushToast("Konfirmasi passphrase tidak cocok", {
        variant: "error",
      });
      return;
    }
    if (!destinationPath.trim()) {
      pushToast("Lokasi file tujuan tidak boleh kosong", {
        variant: "warning",
      });
      return;
    }

    try {
      await exportBackupMutation.mutateAsync();
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Gagal mengekspor buku";
      pushToast("Ekspor terenkripsi gagal", {
        description: msg,
        variant: "error",
      });
    }
  };

  const peers = peersQuery.data ?? [];
  const activeAccounts = (accountsQuery.data ?? []).filter(
    (a) => !a.merged_into_id
  );
  const totalBalance = (balancesQuery.data ?? []).reduce(
    (acc, b) => acc + b.current_balance,
    0
  );
  const categories = categoriesQuery.data ?? [];
  const budgets = budgetProgressQuery.data ?? [];

  if (sectionView === "hub") {
    return (
      <div className="page-transition-wrapper animate-page-in w-full">
        {/* Settings Hub Header */}
        <div className="tabular-grid-container grid grid-cols-1">
          <div className="tabular-grid-cell px-3 py-2.5">
            <h1 className="text-xs font-semibold tracking-tight text-foreground sm:text-sm">
              Pusat Pengaturan & Konfigurasi Buku
            </h1>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Kelola akun keuangan, kategori transaksi, anggaran bulanan, serta
              sinkronisasi P2P dan cadangan terenkripsi.
            </p>
          </div>
        </div>

        {/* 4 Compact CTA Navigation Cards */}
        <div className="tabular-grid-container grid grid-cols-1 sm:grid-cols-2">
          {/* 1. CTA to Accounts */}
          <Link
            to="/books/$bookId/accounts"
            params={{ bookId }}
            style={{ animationDelay: "0ms" }}
            className="tabular-grid-cell animate-card-up nav-touch-item group flex items-center justify-between gap-3 px-3 py-3 text-left transition-colors hover:bg-muted/30 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
          >
            <div className="flex min-w-0 flex-1 items-start gap-2.5">
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded border border-border bg-background text-primary">
                <Wallet className="h-4 w-4" strokeWidth={2.2} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs font-semibold text-foreground sm:text-sm">
                    Manajemen Akun Keuangan
                  </span>
                  <span className="rounded border border-primary/40 bg-primary/10 px-1.5 py-0.2 font-mono text-[10px] font-semibold text-primary">
                    {activeAccounts.length} Akun
                  </span>
                </div>
                <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                  Rekening bank, kas tunai, e-wallet & penggabungan manual
                </p>
                <p className="mt-1 font-mono text-[11px] font-medium tabular-nums tracking-tight text-foreground">
                  Total Saldo: {formatRupiah(totalBalance)}
                </p>
              </div>
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
          </Link>

          {/* 2. CTA to Categories */}
          <Link
            to="/books/$bookId/categories"
            params={{ bookId }}
            style={{ animationDelay: "40ms" }}
            className="tabular-grid-cell animate-card-up nav-touch-item group flex items-center justify-between gap-3 px-3 py-3 text-left transition-colors hover:bg-muted/30 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
          >
            <div className="flex min-w-0 flex-1 items-start gap-2.5">
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded border border-border bg-background text-primary">
                <Tags className="h-4 w-4" strokeWidth={2.2} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs font-semibold text-foreground sm:text-sm">
                    Kategori Transaksi
                  </span>
                  <span className="rounded border border-border bg-background px-1.5 py-0.2 font-mono text-[10px] font-semibold text-foreground">
                    {categories.length} Kategori
                  </span>
                </div>
                <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                  Kelola pos pemasukan & pengeluaran Anda
                </p>
                <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                  Pengeluaran:{" "}
                  {categories.filter((c) => c.kind === "EXPENSE").length} ·
                  Pemasukan:{" "}
                  {categories.filter((c) => c.kind === "INCOME").length}
                </p>
              </div>
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
          </Link>

          {/* 3. CTA to Budgets */}
          <Link
            to="/books/$bookId/budgets"
            params={{ bookId }}
            style={{ animationDelay: "80ms" }}
            className="tabular-grid-cell animate-card-up nav-touch-item group flex items-center justify-between gap-3 px-3 py-3 text-left transition-colors hover:bg-muted/30 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
          >
            <div className="flex min-w-0 flex-1 items-start gap-2.5">
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded border border-border bg-background text-primary">
                <PieChart className="h-4 w-4" strokeWidth={2.2} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs font-semibold text-foreground sm:text-sm">
                    Anggaran Bulanan
                  </span>
                  <span className="rounded border border-border bg-background px-1.5 py-0.2 font-mono text-[10px] font-semibold text-foreground">
                    {budgets.length} Target ({currentMonth})
                  </span>
                </div>
                <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                  Atur batas belanja per kategori agar keuangan terkontrol
                </p>
                <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                  {budgets.filter((b) => b.status === "OVER").length > 0
                    ? `${budgets.filter((b) => b.status === "OVER").length} anggaran melebihi batas`
                    : "Seluruh anggaran terkendali"}
                </p>
              </div>
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
          </Link>

          {/* 4. CTA to P2P Sync & Encrypted Backup */}
          <button
            type="button"
            data-testid="settings-cta-sync"
            onClick={() => setSectionView("sync")}
            style={{ animationDelay: "120ms" }}
            className="tabular-grid-cell animate-card-up nav-touch-item group flex w-full items-center justify-between gap-3 px-3 py-3 text-left transition-colors hover:bg-muted/30 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
          >
            <div className="flex min-w-0 flex-1 items-start gap-2.5">
              <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded border border-border bg-background text-primary">
                <RefreshCw className="h-4 w-4" strokeWidth={2.2} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs font-semibold text-foreground sm:text-sm">
                    Sinkronisasi & Cadangan
                  </span>
                  <span className="rounded border border-primary/40 bg-primary/10 px-1.5 py-0.2 font-mono text-[10px] font-semibold text-primary">
                    {peers.length} Perangkat Terhubung
                  </span>
                </div>
                <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                  Hubungkan perangkat lain & simpan salinan cadangan aman
                </p>
                <p className="mt-1 font-mono text-[10px] text-muted-foreground">
                  Dilindungi enkripsi privat end-to-end
                </p>
              </div>
            </div>
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="page-transition-wrapper animate-page-in w-full">

      {/* Section 1: P2P Sync Status & Invite QR */}
      <div className="tabular-grid-container grid grid-cols-1 lg:grid-cols-12">
        <div className="tabular-grid-cell space-y-2.5 px-3 py-3 lg:col-span-7">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setSectionView("hub")}
                  className="nav-touch-item inline-flex h-7 items-center gap-1 rounded border border-border bg-background px-2.5 font-mono text-[11px] font-semibold text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
                >
                  ←
                </button>
                <h1 className="text-xs font-semibold tracking-tight text-foreground sm:text-sm">
                  Sinkronisasi Antar-Perangkat
                </h1>
              </div>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Data keuangan disinkronkan langsung antar-perangkat Anda secara privat dan aman.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void handleGenerateInvite()}
              disabled={createInviteMutation.isPending}
              className="nav-touch-item rounded border border-border bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary disabled:opacity-50"
            >
              {createInviteMutation.isPending
                ? "Membuat Kunci..."
                : "Buat Kode Undangan (10 Menit)"}
            </button>
          </div>

          {/* Mandatory Security Warning Banner (Section 6.5) */}
          <div
            data-testid="qr-bearer-warning"
            className="rounded border border-amber-500/40 bg-background p-2.5 text-xs text-amber-500"
          >
            <p className="font-semibold">
              PERHATIAN KEAMANAN KODE BUKU:
            </p>
            <p className="mt-0.5 text-[11px] text-foreground">
              Siapa pun yang memindai kode ini memiliki akses penuh ke
              buku ini. Pastikan hanya membagikannya ke perangkat milik Anda sendiri.
            </p>
          </div>

          {activeInvite && (
            <div className="animate-card-up space-y-2 rounded border border-border bg-background p-3">
              <div className="flex flex-wrap items-center justify-between gap-1.5">
                <div className="font-mono text-[11px]">
                  <span className="text-muted-foreground">ID Perangkat Ini: </span>
                  <span className="text-foreground">
                    {activeInvite.node_id.slice(0, 16)}...
                  </span>
                </div>
                <span className="rounded border border-primary/40 px-1.5 py-0.5 font-mono text-[10px] text-primary">
                  Kedaluwarsa: {activeInvite.expires_at}
                </span>
              </div>

              {isQrRevealed ? (
                <div className="space-y-2">
                  <pre
                    data-testid="invite-qr-payload-display"
                    className="overflow-x-auto rounded border border-border bg-card p-2.5 font-mono text-[10px] text-foreground"
                  >
                    {activeInvite.qr_json}
                  </pre>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => void handleCopyInvite()}
                      className="nav-touch-item rounded border border-border bg-card px-2.5 py-1 text-[11px] font-medium text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
                    >
                      Salin Kode Undangan
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsQrRevealed(false)}
                      className="nav-touch-item rounded border border-border bg-card px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
                    >
                      Sembunyikan Kode
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between rounded border border-border bg-card p-2.5 text-xs">
                  <span className="text-muted-foreground">
                    Kode undangan disembunyikan demi keamanan.
                  </span>
                  <button
                    type="button"
                    onClick={() => setIsQrRevealed(true)}
                    className="nav-touch-item rounded border border-border bg-background px-2 py-0.5 text-[11px] font-medium text-primary hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
                  >
                    Tampilkan Kembali
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Known Peers & Live Sync Diagnostics */}
        <div className="tabular-grid-cell space-y-2.5 px-3 py-3 lg:col-span-5">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-semibold text-foreground sm:text-sm">
              Perangkat Terhubung ({peers.length})
            </h2>
            <span className="font-mono text-[11px] text-muted-foreground">
              STATUS:{" "}
              {syncStatus.state === "syncing"
                ? "MENYINKRONKAN"
                : syncStatus.state === "connecting"
                  ? "MENGHUBUNGKAN"
                  : syncStatus.state === "error"
                    ? "KENDALA"
                    : "SIAP"}
            </span>
          </div>

          {peers.length === 0 ? (
            <div className="rounded border border-border bg-background p-3 text-xs text-muted-foreground">
              Tidak ada perangkat lain yang terdaftar pada buku ini. Buat
              kode undangan di sebelah kiri untuk menghubungkan perangkat kedua.
            </div>
          ) : (
            <div className="space-y-1.5">
              {peers.map((peer, idx) => (
                <div
                  key={peer.node_id}
                  style={{ animationDelay: `${idx * 35}ms` }}
                  className="animate-card-up rounded border border-border bg-background p-2.5 font-mono text-xs"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-foreground">
                      Perangkat:{" "}
                      {peer.device_id
                        ? peer.device_id.slice(0, 8)
                        : peer.node_id.slice(0, 10)}
                    </span>
                    <span className="text-[10px] text-primary">
                      {peer.device_id
                        ? "Terhubung"
                        : "Menghubungkan..."}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    Terakhir terlihat: {peer.last_seen_at ?? "Baru saja"}
                  </p>
                </div>
              ))}
            </div>
          )}

          {/* Documented v1 Limitations */}
          <div className="rounded border border-border bg-background p-2.5 text-[11px] text-muted-foreground">
            <p className="font-semibold text-foreground">
              Tips Sinkronisasi:
            </p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              <li>
                Buka aplikasi di kedua perangkat dalam jaringan yang sama agar
                sinkronisasi berjalan cepat.
              </li>
              <li>
                Pastikan hanya membagikan kode undangan kepada perangkat milik Anda sendiri.
              </li>
            </ul>
          </div>
        </div>
      </div>

      {/* Section 2: Encrypted SQLite Backup Export */}
      <form
        onSubmit={(e) => void handleExportEncrypted(e)}
        className="tabular-grid-container grid grid-cols-1 md:grid-cols-12"
      >
        <div className="tabular-grid-cell flex flex-col justify-center px-3 py-3 md:col-span-5">
          <h2 className="text-xs font-semibold text-foreground sm:text-sm">
            Cadangan Buku Terenkripsi
          </h2>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Simpan salinan seluruh transaksi dan akun Anda ke dalam satu file
            cadangan aman yang dilindungi kata sandi.
          </p>
          {lastExportedPath && (
            <p className="mt-1.5 font-mono text-[10px] text-primary">
              Ekspor terakhir: {lastExportedPath}
            </p>
          )}
        </div>

        <div className="tabular-grid-cell space-y-2.5 px-3 py-3 md:col-span-5">
          <div>
            <label
              htmlFor="export-dest-path"
              className="mb-1 block text-[11px] font-medium text-foreground"
            >
              Lokasi & Nama File Cadangan
            </label>
            <Input
              id="export-dest-path"
              value={destinationPath}
              onChange={(e) => setDestinationPath(e.target.value)}
              placeholder="Contoh: C:\backup\buku-utama.fmm.enc"
              className="h-8 font-mono text-xs"
            />
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <div>
              <label
                htmlFor="export-passphrase"
                className="mb-1 block text-[11px] font-medium text-foreground"
              >
                Kata Sandi Cadangan (Min. 8 Karakter)
              </label>
              <Input
                id="export-passphrase"
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder="••••••••"
                className="h-8 text-xs"
              />
            </div>

            <div>
              <label
                htmlFor="export-confirm-passphrase"
                className="mb-1 block text-[11px] font-medium text-foreground"
              >
                Ulangi Kata Sandi
              </label>
              <Input
                id="export-confirm-passphrase"
                type="password"
                value={confirmPassphrase}
                onChange={(e) => setConfirmPassphrase(e.target.value)}
                placeholder="••••••••"
                className="h-8 text-xs"
              />
            </div>
          </div>
        </div>

        <div className="tabular-grid-cell flex items-end justify-end px-3 py-3 md:col-span-2">
          <button
            type="submit"
            disabled={exportBackupMutation.isPending}
            className="nav-touch-item h-8 w-full rounded border border-border bg-primary px-3 text-xs font-semibold text-primary-foreground hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary disabled:opacity-50"
          >
            {exportBackupMutation.isPending
              ? "Menyimpan..."
              : "Ekspor Cadangan"}
          </button>
        </div>
      </form>
    </div>
  );
};

