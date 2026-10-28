import * as React from "react";
import { useMutation } from "@tanstack/react-query";
import { useBookFinance, useBookSyncEvents } from "../../hooks/useBookFinance";
import { tauriApi, type InviteResponse } from "../../lib/tauri-api";
import { Input } from "../ui/input";
import { pushToast } from "../../lib/toast";

export interface SettingsPageProps {
  bookId: string;
}

export const SettingsPage: React.FC<SettingsPageProps> = ({ bookId }) => {
  const syncStatus = useBookSyncEvents(bookId);
  const { peersQuery } = useBookFinance({ bookId });

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

  return (
    <div className="space-y-6">
      {/* Section 1: P2P Sync Status & Invite QR */}
      <div className="tabular-grid-container grid grid-cols-1 lg:grid-cols-12">
        <div className="tabular-grid-cell space-y-3 p-5 lg:col-span-7">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h1 className="text-base font-semibold tracking-tight text-foreground">
                Sinkronisasi P2P & Undangan Perangkat (ALPN `fmm/sync/1`)
              </h1>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Pertukaran oplog terenkripsi end-to-end menggunakan{" "}
                <span className="font-mono">XChaCha20-Poly1305</span> +{" "}
                <span className="font-mono">BLAKE3 derive_key</span>.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void handleGenerateInvite()}
              disabled={createInviteMutation.isPending}
              className="rounded-md border border-border bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-foreground shadow-none hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary disabled:opacity-50"
            >
              {createInviteMutation.isPending
                ? "Membuat Kunci..."
                : "Buat Undangan QR (10 Menit)"}
            </button>
          </div>

          {/* Mandatory Security Warning Banner (Section 6.5) */}
          <div
            data-testid="qr-bearer-warning"
            className="rounded border border-amber-500/40 bg-background p-3 text-xs text-amber-500"
          >
            <p className="font-semibold">
              PERINGATAN KEAMANAN KUNCI BUKU (BEARER SECRET):
            </p>
            <p className="mt-1 text-foreground">
              Siapa pun yang memindai QR ini memiliki akses baca/tulis penuh ke
              buku ini. Payload undangan otomatis disembunyikan apabila jendela
              aplikasi berpindah ke latar belakang.
            </p>
          </div>

          {activeInvite && (
            <div className="space-y-3 rounded border border-border bg-background p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-mono text-xs">
                  <span className="text-muted-foreground">Node ID Lokal: </span>
                  <span className="text-foreground">
                    {activeInvite.node_id}
                  </span>
                </div>
                <span className="rounded border border-primary/40 px-2 py-0.5 font-mono text-[11px] text-primary">
                  Kedaluwarsa: {activeInvite.expires_at}
                </span>
              </div>

              {isQrRevealed ? (
                <div className="space-y-2">
                  <pre
                    data-testid="invite-qr-payload-display"
                    className="overflow-x-auto rounded border border-border bg-card p-3 font-mono text-[11px] text-foreground"
                  >
                    {activeInvite.qr_json}
                  </pre>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void handleCopyInvite()}
                      className="rounded border border-border bg-card px-3 py-1 text-xs font-medium text-foreground shadow-none hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
                    >
                      Salin Payload JSON
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsQrRevealed(false)}
                      className="rounded border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground shadow-none hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
                    >
                      Sembunyikan Rahasia
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between rounded border border-border bg-card p-3 text-xs">
                  <span className="text-muted-foreground">
                    Payload rahasia disembunyikan demi keamanan layar.
                  </span>
                  <button
                    type="button"
                    onClick={() => setIsQrRevealed(true)}
                    className="rounded border border-border bg-background px-2.5 py-1 font-medium text-primary shadow-none hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
                  >
                    Tampilkan Kembali
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Known Peers & Live Sync Diagnostics */}
        <div className="tabular-grid-cell space-y-3 p-5 lg:col-span-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">
              Perangkat Terdaftar ({peers.length} Peer)
            </h2>
            <span className="font-mono text-xs text-muted-foreground">
              STATUS: {syncStatus.state.toUpperCase()}
            </span>
          </div>

          {peers.length === 0 ? (
            <div className="rounded border border-border bg-background p-4 text-xs text-muted-foreground">
              Tidak ada perangkat lain yang terdaftar pada buku ini. Buat
              undangan QR di sebelah kiri atau gabung dari perangkat kedua.
            </div>
          ) : (
            <div className="space-y-2">
              {peers.map((peer) => (
                <div
                  key={peer.node_id}
                  className="rounded border border-border bg-background p-3 font-mono text-xs"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-foreground">
                      Node: {peer.node_id.slice(0, 16)}…
                    </span>
                    <span className="text-[11px] text-primary">
                      {peer.device_id
                        ? `Device: ${peer.device_id.slice(0, 8)}`
                        : "Menunggu Handshake"}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Terakhir terlihat: {peer.last_seen_at ?? "Belum pernah"}
                  </p>
                </div>
              ))}
            </div>
          )}

          {/* Documented v1 Limitations (Section 6.5) */}
          <div className="rounded border border-border bg-background p-3 text-xs text-muted-foreground">
            <p className="font-semibold text-foreground">
              Catatan Arsitektur Sinkronisasi v1:
            </p>
            <ul className="mt-1 list-disc space-y-1 pl-4">
              <li>
                Sinkronisasi P2P berjalan saat aplikasi aktif di foreground pada
                kedua perangkat.
              </li>
              <li>
                Pencabutan akses (revocation) perangkat di v1 dilakukan dengan
                membuat buku baru dan mengundang ulang perangkat yang masih
                dipercaya.
              </li>
            </ul>
          </div>
        </div>
      </div>

      {/* Section 2: Encrypted SQLite Backup Export (Section 6.6) */}
      <form
        onSubmit={(e) => void handleExportEncrypted(e)}
        className="tabular-grid-container grid grid-cols-1 md:grid-cols-12"
      >
        <div className="tabular-grid-cell flex flex-col justify-center p-5 md:col-span-5">
          <h2 className="text-sm font-semibold text-foreground">
            Ekspor Cadangan Buku Terenkripsi (`FMMBKUP1`)
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Menghasilkan snapshot konsisten via{" "}
            <span className="font-mono">VACUUM INTO</span> lalu mengenkripsinya
            dengan <span className="font-mono">Argon2id (64 MiB, t=3, p=4)</span>{" "}
            dan <span className="font-mono">XChaCha20-Poly1305</span>. File
            sementara plaintext otomatis di-zeroize dan dihapus.
          </p>
          {lastExportedPath && (
            <p className="mt-2 font-mono text-[11px] text-primary">
              Ekspor terakhir: {lastExportedPath}
            </p>
          )}
        </div>

        <div className="tabular-grid-cell space-y-3 p-5 md:col-span-5">
          <div>
            <label
              htmlFor="export-dest-path"
              className="mb-1 block text-xs font-medium text-foreground"
            >
              Nama / Path File Tujuan
            </label>
            <Input
              id="export-dest-path"
              value={destinationPath}
              onChange={(e) => setDestinationPath(e.target.value)}
              placeholder="Contoh: C:\backup\buku-utama.fmm.enc"
              className="font-mono text-xs"
            />
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label
                htmlFor="export-passphrase"
                className="mb-1 block text-xs font-medium text-foreground"
              >
                Passphrase Enkripsi (Min. 8 Karakter)
              </label>
              <Input
                id="export-passphrase"
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                placeholder="••••••••"
              />
            </div>

            <div>
              <label
                htmlFor="export-confirm-passphrase"
                className="mb-1 block text-xs font-medium text-foreground"
              >
                Konfirmasi Passphrase
              </label>
              <Input
                id="export-confirm-passphrase"
                type="password"
                value={confirmPassphrase}
                onChange={(e) => setConfirmPassphrase(e.target.value)}
                placeholder="••••••••"
              />
            </div>
          </div>
        </div>

        <div className="tabular-grid-cell flex items-end justify-end p-5 md:col-span-2">
          <button
            type="submit"
            disabled={exportBackupMutation.isPending}
            className="h-9 w-full rounded-md border border-border bg-primary px-4 text-xs font-semibold text-primary-foreground shadow-none hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary disabled:opacity-50"
          >
            {exportBackupMutation.isPending
              ? "Mengenkripsi..."
              : "Ekspor Cadangan"}
          </button>
        </div>
      </form>
    </div>
  );
};

