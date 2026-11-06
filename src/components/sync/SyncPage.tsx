import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  Info,
  Laptop,
  Network,
  Pencil,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  X,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import {
  bookQueryKeys,
  useBookFinance,
  useBookSyncEvents,
} from "../../hooks/useBookFinance";
import {
  tauriApi,
  resolvePeerDisplayName,
  type InviteResponse,
  type PeerInfo,
} from "../../lib/tauri-api";
import { pushToast } from "../../lib/toast";
import {
  formatDateTime,
  formatExpiryTime,
  formatRelativeTime,
} from "../../lib/date";

export interface SyncPageProps {
  bookId: string;
}

export const SyncPage: React.FC<SyncPageProps> = ({ bookId }) => {
  const queryClient = useQueryClient();
  const syncStatus = useBookSyncEvents(bookId);
  const { peersQuery, setPeerCustomAliasMutation } = useBookFinance({ bookId });

  const [editingPeer, setEditingPeer] = React.useState<PeerInfo | null>(null);
  const [customAliasInput, setCustomAliasInput] = React.useState("");

  const handleOpenAliasModal = (peer: PeerInfo) => {
    setEditingPeer(peer);
    setCustomAliasInput(peer.custom_alias ?? "");
  };

  const handleSaveAlias = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPeer) return;
    const trimmed = customAliasInput.trim();
    try {
      await setPeerCustomAliasMutation.mutateAsync({
        nodeId: editingPeer.node_id,
        customAlias: trimmed || null,
      });
      pushToast("Nama panggilan perangkat berhasil disimpan", {
        variant: "success",
      });
      setEditingPeer(null);
    } catch (err: unknown) {
      pushToast(
        err instanceof Error ? err.message : "Gagal menyimpan nama alias",
        { variant: "error" }
      );
    }
  };

  const handleResetAlias = async () => {
    if (!editingPeer) return;
    try {
      await setPeerCustomAliasMutation.mutateAsync({
        nodeId: editingPeer.node_id,
        customAlias: null,
      });
      pushToast("Nama perangkat dikembalikan ke nama bawaan", {
        variant: "success",
      });
      setEditingPeer(null);
    } catch (err: unknown) {
      pushToast(
        err instanceof Error ? err.message : "Gagal mereset alias",
        { variant: "error" }
      );
    }
  };

  const topologyQuery = useQuery({
    queryKey: bookQueryKeys.syncTopology(bookId),
    queryFn: () => tauriApi.getSyncTopology(bookId),
    enabled: Boolean(bookId),
  });

  const setPreferredHubMutation = useMutation({
    mutationFn: (hubNodeId: string | null) =>
      tauriApi.setPreferredHub(bookId, hubNodeId),
    onSuccess: (updated) => {
      queryClient.setQueryData(bookQueryKeys.syncTopology(bookId), updated);
      void queryClient.invalidateQueries({
        queryKey: bookQueryKeys.peers(bookId),
      });
      pushToast(
        updated.preferred_hub_node_id
          ? "Hub Utama berhasil diperbarui"
          : "Kembali ke mode Mesh otomatis",
        { variant: "success" }
      );
    },
  });

  const manualSyncMutation = useMutation({
    mutationFn: () => tauriApi.triggerManualSync(bookId),
    onSuccess: () => {
      pushToast("Sinkronisasi instan dipicu", { variant: "info" });
    },
  });

  const [isTopologyExpanded, setIsTopologyExpanded] = React.useState(false);
  const [activeInvite, setActiveInvite] =
    React.useState<InviteResponse | null>(null);
  const [isQrRevealed, setIsQrRevealed] = React.useState(false);

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
    const shareText = activeInvite.invite_url || activeInvite.qr_json;
    try {
      await navigator.clipboard.writeText(shareText);
      pushToast("Link undangan disalin ke clipboard", {
        variant: "success",
      });
    } catch {
      pushToast("Gagal menyalin ke clipboard", { variant: "error" });
    }
  };

  const peers = peersQuery.data ?? [];

  return (
    <div className="w-full">
      {/* Section 1: P2P Sync Status & Invite QR */}
      <div className="tabular-grid-container grid grid-cols-1 lg:grid-cols-12">
        <div className="tabular-grid-cell space-y-2.5 px-3 py-3 lg:col-span-7">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <Link
                  to="/books/$bookId/settings"
                  params={{ bookId }}
                  className="nav-touch-item inline-flex h-6 shrink-0 items-center rounded border border-border bg-background px-2 font-mono text-[10px] font-semibold text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
                >
                  ← Pengaturan
                </Link>
                <h1 className="text-xs font-semibold tracking-tight text-foreground sm:text-sm">
                  Sinkronisasi Antar-Perangkat
                </h1>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Data keuangan disinkronkan langsung antar-perangkat Anda secara privat dan aman.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Link
                to="/books/$bookId/backup"
                params={{ bookId }}
                className="nav-touch-item inline-flex items-center gap-1.5 rounded border border-border bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
              >
                <ShieldCheck className="h-3.5 w-3.5 text-primary" />
                <span>Cadangan Terenkripsi →</span>
              </Link>
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
                <span
                  className="rounded border border-primary/40 px-1.5 py-0.5 font-mono text-[10px] text-primary"
                  title={`Waktu kedaluwarsa: ${activeInvite.expires_at}`}
                >
                  Kedaluwarsa: {formatExpiryTime(activeInvite.expires_at)}
                </span>
              </div>

              {isQrRevealed ? (
                <div className="space-y-3">
                  {/* Visual QR Code for camera scanning */}
                  <div className="flex justify-center">

                  <QRCodeSVG
                    value={activeInvite.invite_url || activeInvite.qr_json}
                    size={280}
                    level="L"
                    marginSize={0}
                  />
                  </div>

                  {/* Shareable Link Input with One-click Copy */}
                  <div className="space-y-1">
                    <label className="text-[11px] font-medium text-foreground">
                      Link Undangan Buku:
                    </label>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        readOnly
                        value={activeInvite.invite_url || activeInvite.qr_json}
                        className="flex-1 rounded border border-border bg-background px-2.5 py-1.5 font-mono text-[11px] text-foreground select-all focus:outline-none"
                      />
                      <button
                        type="button"
                        onClick={() => void handleCopyInvite()}
                        className="nav-touch-item inline-flex shrink-0 items-center gap-1.5 rounded bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
                      >
                        <Copy className="h-3.5 w-3.5" />
                        <span>Salin Link</span>
                      </button>
                    </div>
                  </div>

                  {/* Hidden pre preserved for existing test selectors */}
                  <pre
                    data-testid="invite-qr-payload-display"
                    className="hidden"
                  >
                    {activeInvite.qr_json}
                  </pre>

                  <div className="flex items-center justify-between pt-1">
                    <button
                      type="button"
                      onClick={() => setIsQrRevealed(false)}
                      className="nav-touch-item rounded border border-border bg-card px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
                    >
                      Sembunyikan QR & Link
                    </button>
                    {activeInvite.invite_url && (
                      <a
                        href={activeInvite.invite_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                      >
                        <span>Buka Link Tes</span>
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between rounded border border-border bg-card p-2.5 text-xs">
                  <span className="text-muted-foreground mr-2">
                    Kode undangan disembunyikan demi keamanan.
                  </span>
                  <button
                    type="button"
                    onClick={() => setIsQrRevealed(true)}
                    className="nav-touch-item whitespace-nowrap rounded border border-border bg-background px-2 py-0.5 text-[11px] font-medium text-primary hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
                  >
                    Tampilkan Kembali
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Known Peers & Live Sync Diagnostics */}
        <div className="tabular-grid-cell space-y-3 px-3 py-3 lg:col-span-5">
          {/* Header & Status Indicator */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <h2 className="text-xs font-semibold text-foreground sm:text-sm">
                Perangkat Terhubung
              </h2>
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                {peers.length}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <div
                className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                  syncStatus.state === "syncing"
                    ? "border border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400"
                    : syncStatus.state === "connecting"
                      ? "border border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400"
                      : syncStatus.state === "error"
                        ? "border border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400"
                        : "border border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    syncStatus.state === "syncing"
                      ? "bg-sky-500 animate-spin"
                      : syncStatus.state === "connecting"
                        ? "bg-amber-500 animate-pulse"
                        : syncStatus.state === "error"
                          ? "bg-rose-500"
                          : "bg-emerald-500"
                  }`}
                />
                <span>
                  {syncStatus.state === "syncing"
                    ? "Menyinkronkan"
                    : syncStatus.state === "connecting"
                      ? "Menghubungkan"
                      : syncStatus.state === "error"
                        ? "Kendala"
                        : "Siap"}
                </span>
              </div>

              <button
                type="button"
                data-testid="btn-manual-sync"
                onClick={() => manualSyncMutation.mutate()}
                disabled={manualSyncMutation.isPending}
                className="nav-touch-item inline-flex items-center gap-1 rounded border border-border bg-background px-2 py-1 font-mono text-[10px] font-medium text-foreground hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary disabled:opacity-50"
                title="Sinkronkan data sekarang"
              >
                <RefreshCw
                  className={`h-3 w-3 ${manualSyncMutation.isPending ? "animate-spin" : ""}`}
                />
                <span>Sinkronkan</span>
              </button>
            </div>
          </div>

          {/* List of Connected Peers */}
          {peers.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/20 p-5 text-center">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <Laptop className="h-4 w-4 opacity-70" />
              </div>
              <p className="mt-2 text-xs font-semibold text-foreground">
                Belum ada perangkat terhubung
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {peers.map((peer, idx) => (
                <div
                  key={peer.node_id}
                  style={{ animationDelay: `${idx * 35}ms` }}
                  className="animate-card-up flex items-center justify-between gap-3 rounded-lg border border-border bg-card p-2.5 shadow-2xs transition-colors hover:border-primary/40"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground">
                      <Laptop className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate text-xs font-semibold text-foreground">
                          {resolvePeerDisplayName(peer)}
                        </span>
                        <span className="rounded border border-border bg-muted/40 px-1 py-0.2 font-mono text-[9px] text-muted-foreground">
                          ID: {peer.device_id ? peer.device_id.slice(0, 8) : peer.node_id.slice(0, 8)}
                        </span>
                        {peer.custom_alias && (
                          <span className="rounded bg-sky-500/10 px-1 py-0.2 text-[9px] font-semibold text-sky-600 dark:text-sky-400">
                            Alias
                          </span>
                        )}
                        {peer.is_preferred_hub && (
                          <span className="rounded border border-primary/30 bg-primary/10 px-1.5 py-0.2 font-mono text-[9px] font-semibold text-primary">
                            HUB UTAMA
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-[10px] text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${
                              peer.is_online
                                ? "bg-emerald-500 animate-pulse"
                                : "bg-muted-foreground/40"
                            }`}
                          />
                          <span
                            className={
                              peer.is_online
                                ? "font-medium text-emerald-600 dark:text-emerald-400"
                                : ""
                            }
                          >
                            {peer.is_online
                              ? "Aktif"
                              : peer.device_id
                                ? "Terhubung"
                                : "Menghubungkan"}
                          </span>
                        </span>
                        <span>•</span>
                        <span
                          className="truncate"
                          title={
                            peer.last_seen_at
                              ? formatDateTime(peer.last_seen_at)
                              : undefined
                          }
                        >
                          {peer.last_seen_at
                            ? `Aktif ${formatRelativeTime(peer.last_seen_at)}`
                            : "Baru saja"}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      data-testid={`btn-edit-alias-${peer.node_id}`}
                      onClick={() => handleOpenAliasModal(peer)}
                      title="Ubah Nama Panggilan"
                      className="nav-touch-item inline-flex h-6 w-6 items-center justify-center rounded border border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
                    >
                      <Pencil className="h-3 w-3" />
                      <span className="sr-only">Ubah Nama</span>
                    </button>

                    {!peer.is_preferred_hub && (
                      <button
                        type="button"
                        onClick={() =>
                          setPreferredHubMutation.mutate(peer.node_id)
                        }
                        disabled={setPreferredHubMutation.isPending}
                        className="nav-touch-item rounded border border-border bg-background px-2 py-0.5 text-[10px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary disabled:opacity-50"
                      >
                        Jadikan Hub
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Modal Edit Peer Custom Alias */}
          {editingPeer && (
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="edit-peer-alias-title"
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs animate-fade-in"
            >
              <div className="w-full max-w-sm rounded-lg border border-border bg-card p-4 shadow-xl">
                <div className="flex items-center justify-between pb-2 border-b border-border">
                  <h3
                    id="edit-peer-alias-title"
                    className="text-xs font-semibold text-foreground sm:text-sm flex items-center gap-1.5"
                  >
                    <Pencil className="h-4 w-4 text-primary" />
                    <span>Ubah Nama Panggilan Perangkat</span>
                  </h3>
                  <button
                    type="button"
                    onClick={() => setEditingPeer(null)}
                    className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <form onSubmit={handleSaveAlias} className="mt-3 space-y-3">
                  <div className="rounded border border-border/60 bg-muted/20 p-2 text-[11px] space-y-1">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">ID Perangkat:</span>
                      <span className="font-mono font-medium text-foreground">
                        {editingPeer.device_id || editingPeer.node_id.slice(0, 14)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Nama Asli:</span>
                      <span className="font-medium text-foreground">
                        {editingPeer.device_name || "Tidak disiarkan"}
                      </span>
                    </div>
                  </div>

                  <div>
                    <label
                      htmlFor="input-peer-alias"
                      className="block text-[11px] font-medium text-muted-foreground mb-1"
                    >
                      Nama Panggilan (Alias Lokal)
                    </label>
                    <input
                      id="input-peer-alias"
                      type="text"
                      value={customAliasInput}
                      onChange={(e) => setCustomAliasInput(e.target.value)}
                      placeholder="Contoh: Mas Budi, Laptop Kasir Toko"
                      maxLength={64}
                      autoFocus
                      className="w-full rounded border border-border bg-background px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground/60 focus:border-primary focus:outline-hidden"
                    />
                    <p className="mt-1 text-[10px] text-muted-foreground">
                      Nama ini hanya disimpan di perangkat ini untuk memudahkan Anda mengenali perangkat tersebut.
                    </p>
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-2 border-t border-border">
                    {editingPeer.custom_alias ? (
                      <button
                        type="button"
                        onClick={handleResetAlias}
                        disabled={setPeerCustomAliasMutation.isPending}
                        className="inline-flex items-center gap-1 text-[11px] text-rose-500 hover:underline"
                      >
                        <RotateCcw className="h-3 w-3" />
                        <span>Kembalikan ke Asli</span>
                      </button>
                    ) : (
                      <div />
                    )}

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setEditingPeer(null)}
                        className="rounded border border-border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted"
                      >
                        Batal
                      </button>
                      <button
                        type="submit"
                        disabled={setPeerCustomAliasMutation.isPending}
                        className="rounded bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
                      >
                        {setPeerCustomAliasMutation.isPending
                          ? "Menyimpan..."
                          : "Simpan"}
                      </button>
                    </div>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Collapsible Advanced Topology Controls */}
          <div className="overflow-hidden rounded-lg border border-border/80 bg-muted/15">
            <button
              type="button"
              onClick={() => setIsTopologyExpanded((prev) => !prev)}
              className="flex w-full items-center justify-between px-3 py-2 text-left text-xs font-medium text-foreground transition-colors hover:bg-muted/30"
            >
              <div className="flex items-center gap-1.5">
                <Network className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-[11px] font-medium">Topologi Jaringan</span>
                <span className="rounded border border-primary/30 bg-primary/10 px-1.5 py-0.2 font-mono text-[9px] font-semibold text-primary">
                  {topologyQuery.data?.preferred_hub_node_id
                    ? topologyQuery.data.preferred_hub_node_id ===
                      topologyQuery.data.local_node_id
                      ? "Perangkat Ini = Hub"
                      : "Hub Pilihan"
                    : "Mesh Otomatis"}
                </span>
              </div>
              {isTopologyExpanded ? (
                <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
              )}
            </button>

            {isTopologyExpanded && (
              <div className="border-t border-border/60 px-3 py-2.5 text-xs">
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  Perubahan data dikirim melalui koneksi persisten dan otomatis diteruskan oleh perangkat Hub ke anggota lain.
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {topologyQuery.data?.local_node_id &&
                    topologyQuery.data.preferred_hub_node_id !==
                      topologyQuery.data.local_node_id && (
                      <button
                        type="button"
                        data-testid="btn-set-self-hub"
                        onClick={() =>
                          setPreferredHubMutation.mutate(
                            topologyQuery.data?.local_node_id ?? null
                          )
                        }
                        disabled={setPreferredHubMutation.isPending}
                        className="nav-touch-item rounded border border-border bg-card px-2 py-0.5 font-mono text-[10px] font-semibold text-primary hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary disabled:opacity-50"
                      >
                        Jadikan Perangkat Ini Hub
                      </button>
                    )}
                  {topologyQuery.data?.preferred_hub_node_id && (
                    <button
                      type="button"
                      data-testid="btn-reset-mesh"
                      onClick={() => setPreferredHubMutation.mutate(null)}
                      disabled={setPreferredHubMutation.isPending}
                      className="nav-touch-item rounded border border-border bg-card px-2 py-0.5 font-mono text-[10px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary disabled:opacity-50"
                    >
                      Reset ke Mesh Otomatis
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Compact Tips Callout */}
          <div className="flex items-start gap-2 rounded-lg border border-border/60 bg-muted/20 p-2.5 text-[11px] text-muted-foreground">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/80" />
            <p>
              Pastikan kedua perangkat terhubung dalam jaringan yang sama agar sinkronisasi P2P langsung berjalan optimal.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

