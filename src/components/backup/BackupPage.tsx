import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, ShieldCheck, Upload } from "lucide-react";
import { tauriApi } from "../../lib/tauri-api";
import { isTauriRuntime } from "../../lib/platform";
import { bookQueryKeys } from "../../hooks/useBookFinance";
import { Input } from "../ui/input";
import {
  ButtonSlideToConfirm,
  type SlideConfirmResult,
} from "../ui/ButtonSlideToConfirm";
import { pushToast } from "../../lib/toast";

export interface BackupPageProps {
  bookId: string;
}

export const BackupPage: React.FC<BackupPageProps> = ({ bookId }) => {
  const isDesktop = isTauriRuntime();
  const queryClient = useQueryClient();

  const [passphrase, setPassphrase] = React.useState("");
  const [confirmPassphrase, setConfirmPassphrase] = React.useState("");
  const [destinationPath, setDestinationPath] = React.useState(
    `backup-${bookId.slice(0, 8)}.fmm.enc`
  );
  const [lastExportedPath, setLastExportedPath] = React.useState<string | null>(
    null
  );

  // Web mode import state
  const [importFile, setImportFile] = React.useState<File | null>(null);
  const [importPassphrase, setImportPassphrase] = React.useState("");

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

  const importBackupMutation = useMutation({
    mutationFn: async () => {
      if (!importFile) {
        throw new Error("Pilih file cadangan terlebih dahulu");
      }
      if (importPassphrase.length < 8) {
        throw new Error("Kata sandi cadangan minimal 8 karakter");
      }
      const buffer = await importFile.arrayBuffer();
      return tauriApi.importBookEncryptedBytes(
        new Uint8Array(buffer),
        importPassphrase
      );
    },
    onSuccess: (restoredBook) => {
      setImportFile(null);
      setImportPassphrase("");
      void queryClient.invalidateQueries({ queryKey: bookQueryKeys.allBooks });
      void queryClient.invalidateQueries({
        queryKey: bookQueryKeys.bookRoot(restoredBook.id),
      });
      pushToast("Cadangan berhasil dipulihkan", {
        description: `Buku "${restoredBook.name}" siap digunakan.`,
        variant: "success",
      });
    },
    onError: (err: unknown) => {
      const msg =
        err instanceof Error ? err.message : "Gagal memulihkan file cadangan";
      pushToast("Pemulihan cadangan gagal", {
        description: msg,
        variant: "error",
      });
    },
  });

  const handleSlideConfirmBackup = async (): Promise<SlideConfirmResult> => {
    if (passphrase.length < 8) {
      pushToast("Passphrase minimal harus 8 karakter", {
        variant: "warning",
      });
      return { ok: false, message: "Kata sandi min. 8 karakter" };
    }
    if (passphrase !== confirmPassphrase) {
      pushToast("Konfirmasi passphrase tidak cocok", {
        variant: "error",
      });
      return { ok: false, message: "Konfirmasi kata sandi tidak cocok" };
    }
    if (!destinationPath.trim()) {
      pushToast("Lokasi file tujuan tidak boleh kosong", {
        variant: "warning",
      });
      return { ok: false, message: "Lokasi file tujuan wajib diisi" };
    }

    try {
      await exportBackupMutation.mutateAsync();
      return { ok: true };
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Gagal mengekspor buku";
      pushToast("Ekspor terenkripsi gagal", {
        description: msg,
        variant: "error",
      });
      return { ok: false, message: "Gagal Mengekspor Buku" };
    }
  };

  return (
    <div className="w-full space-y-3">
      {/* Header */}
      <div className="tabular-grid-container grid grid-cols-1">
        <div className="tabular-grid-cell flex flex-wrap items-center justify-between gap-2.5 px-3 py-3">
          <div className="flex items-center gap-3">
            <Link
              to="/books/$bookId/settings"
              params={{ bookId }}
              className="nav-touch-item inline-flex h-6 shrink-0 items-center rounded border border-border bg-background px-2 font-mono text-[10px] font-semibold text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
            >
              ← Pengaturan
            </Link>
            <div>
              <h1 className="text-xs font-semibold tracking-tight text-foreground sm:text-sm">
                Cadangan Buku Terenkripsi
              </h1>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Simpan salinan seluruh transaksi dan akun Anda ke dalam satu file cadangan aman yang dilindungi kata sandi.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Link
              to="/books/$bookId/sync"
              params={{ bookId }}
              className="nav-touch-item inline-flex items-center gap-1.5 rounded border border-border bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
            >
              <RefreshCw className="h-3 w-3" />
              <span>Buka Sinkronisasi P2P →</span>
            </Link>
          </div>
        </div>
      </div>

      {/* Backup Content Form */}
      <form
        onSubmit={(e) => e.preventDefault()}
        className="tabular-grid-container grid grid-cols-1 lg:grid-cols-12"
      >
        {/* Information & Security Callout */}
        <div className="tabular-grid-cell space-y-3 px-4 py-4 lg:col-span-5">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-primary">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-xs font-semibold text-foreground sm:text-sm">
                Keamanan Cadangan Terenkripsi
              </h2>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                File cadangan berisi seluruh transaksi, akun, anggaran, dan kategori dalam buku ini. File dienkripsi secara penuh dengan standar kriptografi modern.
              </p>
            </div>
          </div>

          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-[11px] text-foreground">
            <p className="font-semibold text-amber-600 dark:text-amber-400">
              Penting Diingat:
            </p>
            <p className="mt-1 leading-relaxed text-muted-foreground">
              Tidak ada fitur "Lupa Kata Sandi" pada sistem terdesentralisasi. Pastikan Anda mengingat atau mencatat kata sandi yang digunakan untuk cadangan ini.
            </p>
          </div>

          {lastExportedPath && (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-[11px]">
              <p className="font-semibold text-emerald-600 dark:text-emerald-400">
                Ekspor Terakhir Berhasil:
              </p>
              <p className="mt-1 font-mono text-[10px] text-foreground break-all">
                {lastExportedPath}
              </p>
            </div>
          )}
        </div>

        {/* Form Fields */}
        <div className="tabular-grid-cell space-y-3.5 px-4 py-4 lg:col-span-7">
          <div>
            <label
              htmlFor="export-dest-path"
              className="mb-1 block text-xs font-medium text-foreground"
            >
              Lokasi & Nama File Cadangan
            </label>
            <Input
              id="export-dest-path"
              value={destinationPath}
              onChange={(e) => setDestinationPath(e.target.value)}
              placeholder={
                isDesktop
                  ? "Contoh: C:\\backup\\buku-utama.fmm.enc"
                  : "Contoh: buku-utama.fmm.enc"
              }
              className="font-mono text-xs"
            />
            <p className="mt-1 text-[10px] text-muted-foreground">
              {isDesktop ? (
                <>
                  Format file dianjurkan menggunakan ekstensi{" "}
                  <code>.fmm.enc</code>.
                </>
              ) : (
                <>
                  File terenkripsi <code>.fmm.enc</code> akan langsung diunduh ke
                  perangkat Anda melalui browser.
                </>
              )}
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label
                htmlFor="export-passphrase"
                className="mb-1 block text-xs font-medium text-foreground"
              >
                Kata Sandi Cadangan
              </label>
              <Input
                id="export-passphrase"
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder="Min. 8 Karakter"
                className="text-xs"
              />
            </div>

            <div>
              <label
                htmlFor="export-confirm-passphrase"
                className="mb-1 block text-xs font-medium text-foreground"
              >
                Ulangi Kata Sandi
              </label>
              <Input
                id="export-confirm-passphrase"
                type="password"
                value={confirmPassphrase}
                onChange={(e) => setConfirmPassphrase(e.target.value)}
                placeholder="Ulangi kata sandi"
                className="text-xs"
              />
            </div>
          </div>

          <div className="flex items-center justify-end pt-3">
            <ButtonSlideToConfirm
              disabled={exportBackupMutation.isPending}
              label="Geser untuk Ekspor Cadangan"
              readyLabel="Lepas untuk Ekspor"
              loadingLabel="Menyimpan Cadangan..."
              successLabel="Cadangan Berhasil Diekspor!"
              onConfirm={handleSlideConfirmBackup}
            />
          </div>
        </div>
      </form>

      {!isDesktop && (
        <div className="tabular-grid-container grid grid-cols-1 lg:grid-cols-12">
          <div className="tabular-grid-cell space-y-2 px-4 py-4 lg:col-span-5">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-primary">
                <Upload className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-xs font-semibold text-foreground sm:text-sm">
                  Pulihkan dari File Cadangan
                </h2>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  Unggah file cadangan terenkripsi (<code>.fmm.enc</code>) untuk
                  memulihkan atau memindahkan buku ke penyimpanan OPFS browser
                  ini.
                </p>
              </div>
            </div>
          </div>

          <div className="tabular-grid-cell space-y-3.5 px-4 py-4 lg:col-span-7">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="import-backup-file"
                  className="mb-1 block text-xs font-medium text-foreground"
                >
                  Pilih File Cadangan (.fmm.enc)
                </label>
                <Input
                  id="import-backup-file"
                  type="file"
                  accept=".enc,.fmm.enc,application/octet-stream"
                  onChange={(e) =>
                    setImportFile(e.target.files?.[0] ?? null)
                  }
                  className="text-xs"
                />
              </div>

              <div>
                <label
                  htmlFor="import-backup-passphrase"
                  className="mb-1 block text-xs font-medium text-foreground"
                >
                  Kata Sandi Pemulihan
                </label>
                <Input
                  id="import-backup-passphrase"
                  type="password"
                  value={importPassphrase}
                  onChange={(e) => setImportPassphrase(e.target.value)}
                  placeholder="Masukkan kata sandi file"
                  className="text-xs"
                />
              </div>
            </div>

            <div className="flex items-center justify-end">
              <button
                type="button"
                disabled={
                  !importFile ||
                  importPassphrase.length < 8 ||
                  importBackupMutation.isPending
                }
                onClick={() => importBackupMutation.mutate()}
                className="nav-touch-item inline-flex h-8 items-center justify-center rounded border border-border bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:pointer-events-none disabled:opacity-50"
              >
                {importBackupMutation.isPending
                  ? "Memulihkan Cadangan..."
                  : "Pulihkan Buku dari File"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

