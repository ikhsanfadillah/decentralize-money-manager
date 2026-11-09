import * as React from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronUp,
  Clock,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  Info,
  Laptop,
  Network,
  Pencil,
  QrCode,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
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
    <div className="w-full space-y-4">
      {/* Page Header */}
      <div className="glass-card flex flex-wrap items-center justify-between gap-2.5 px-4 py-3.5 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            to="/books/$bookId/settings"
            params={{ bookId }}
            className="nav-touch-item inline-flex h-8 shrink-0 items-center rounded-full border border-border bg-black/[0.04] px-3 font-mono text-[11px] font-semibold text-foreground transition-colors hover:bg-muted dark:bg-white/[0.06] focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
          >
            ← Pengaturan
          </Link>
          <div className="min-w-0">
            <h1 className="text-sm font-bold tracking-tight text-foreground sm:text-base">
              Sinkronisasi Antar-Perangkat
            </h1>
            <p className="truncate text-[11px] text-muted-foreground sm:text-clip">
              Sinkronisasi data langsung antar-perangkat secara privat dan aman
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link
            to="/books/$bookId/backup"
            params={{ bookId }}
            className="nav-touch-item inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-black/[0.04] px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted dark:bg-white/[0.06] focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
          >
            <ShieldCheck className="h-3.5 w-3.5 text-primary" />
            <span>Backup</span>
          </Link>
        </div>
      </div>

      {/* Main Grid: Left = Add Device / Active Invite, Right = Connected Peers & Topology */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* Left Column: Invite & QR */}
        <div className="glass-card space-y-4 p-4 sm:p-5 lg:col-span-7">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <div className="flex h-8 w-8 items-center justify-center rounded-xl border border-border bg-black/[0.04] text-primary dark:bg-white/[0.06]">
                <QrCode className="h-4 w-4" />
              </div>
              <h2 className="text-xs font-semibold text-foreground sm:text-sm">
                Hubungkan Perangkat Baru
              </h2>
            </div>

            {activeInvite && (
              <button
                type="button"
                onClick={() => void handleGenerateInvite()}
                disabled={createInviteMutation.isPending}
                className="nav-touch-item rounded-full border border-border bg-black/[0.04] px-3 py-1 text-[11px] font-semibold text-primary transition-colors hover:bg-muted dark:bg-white/[0.06] focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary disabled:opacity-50"
              >
                {createInviteMutation.isPending
                  ? "Membuat..."
                  : "Buat Kode Baru"}
              </button>
            )}
          </div>

          {!activeInvite ? (
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-black/[0.03] p-6 text-center dark:bg-white/[0.03]">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/15 text-primary">
                <QrCode className="h-6 w-6" />
              </div>
              <h3 className="mt-3 text-xs font-semibold text-foreground sm:text-sm">
                Mulai Sinkronisasi Antar-Perangkat
              </h3>
              <p className="mt-1 max-w-sm text-[11px] text-muted-foreground">
                Buat kode QR sementara untuk menghubungkan laptop, ponsel, atau tablet lain ke buku kas ini.
              </p>
              <button
                type="button"
                onClick={() => void handleGenerateInvite()}
                disabled={createInviteMutation.isPending}
                className="nav-touch-item mt-4 inline-flex items-center gap-1.5 rounded-full bg-cta-surface px-4 py-2 text-xs font-semibold text-cta-foreground transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary disabled:opacity-50"
              >
                <QrCode className="h-3.5 w-3.5" />
                <span>
                  {createInviteMutation.isPending
                    ? "Membuat Kunci..."
                    : "Buat Kode Undangan"}
                </span>
              </button>
            </div>
          ) : (
            <div className="animate-card-up space-y-3.5 rounded-2xl border border-border bg-black/[0.03] p-4 dark:bg-white/[0.04]">
              {/* Expiry & Meta Header */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 pb-2.5">
                <div className="flex items-center gap-1.5">
                  <span className="flex items-center gap-1 rounded-full border border-primary/35 bg-primary/10 px-2.5 py-0.5 font-mono text-[10px] font-semibold text-primary">
                    <Clock className="h-3 w-3" />
                    <span>Kedaluwarsa: {formatExpiryTime(activeInvite.expires_at)}</span>
                  </span>
                </div>
                <span className="font-mono text-[10px] text-muted-foreground" title={activeInvite.node_id}>
                  ID: {activeInvite.node_id.slice(0, 10)}...
                </span>
              </div>

              {/* QR Code Area: Revealed or Blurred (Solid White Container Strictly Preserved) */}
              {isQrRevealed ? (
                <div className="flex flex-col items-center justify-center py-2">
                  <div className="rounded-2xl bg-white p-4">
                    <QRCodeSVG
                      value={activeInvite.invite_url || activeInvite.qr_json}
                      size={220}
                      level="L"
                      marginSize={0}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsQrRevealed(false)}
                    className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-border bg-black/[0.04] px-3 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground dark:bg-white/[0.06]"
                  >
                    <EyeOff className="h-3.5 w-3.5" />
                    <span>Sembunyikan QR</span>
                  </button>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-2">
                  <div
                    onClick={() => setIsQrRevealed(true)}
                    className="group relative flex h-56 w-56 cursor-pointer flex-col items-center justify-center overflow-hidden rounded-2xl border border-border bg-black/[0.05] transition-all hover:border-primary/50 dark:bg-white/[0.05]"
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        setIsQrRevealed(true);
                      }
                    }}
                  >
                    {/* Blurred QR silhouette in background */}
                    <div className="pointer-events-none absolute inset-0 flex select-none items-center justify-center opacity-10 blur-[3px]">
                      <QRCodeSVG
                        value={activeInvite.invite_url || activeInvite.qr_json}
                        size={180}
                        level="L"
                        marginSize={0}
                      />
                    </div>

                    {/* Central reveal pill */}
                    <div className="floating-surface relative z-10 flex flex-col items-center gap-1.5 rounded-2xl border border-border px-4 py-3 transition-transform group-hover:scale-105">
                      <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/15 text-primary">
                        <Eye className="h-4 w-4" />
                      </div>
                      <span className="text-xs font-semibold text-foreground">
                        Tampilkan Kode QR
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        Disembunyikan demi keamanan
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Shareable Link Input */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-[11px] font-medium text-muted-foreground">
                    Link Undangan:
                  </label>
                  {activeInvite.invite_url && (
                    <a
                      href={activeInvite.invite_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                    >
                      <span>Buka tab baru</span>
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={activeInvite.invite_url || activeInvite.qr_json}
                    className="h-9 flex-1 select-all rounded-xl border border-border bg-black/[0.04] px-3 py-1.5 font-mono text-[11px] text-foreground focus:outline-none dark:bg-white/[0.06]"
                  />
                  <button
                    type="button"
                    onClick={() => void handleCopyInvite()}
                    className="nav-touch-item inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-cta-surface px-4 text-xs font-semibold text-cta-foreground transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    <span>Salin</span>
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
            </div>
          )}

          {/* Security Note in Contrast Card */}
          <div
            data-testid="qr-bearer-warning"
            className="contrast-card flex items-start gap-3 p-3.5 text-xs text-white/85"
          >
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-400/20 text-amber-300">
              <ShieldAlert className="h-4 w-4" />
            </div>
            <p className="leading-relaxed">
              <span className="font-semibold text-amber-300">Perhatian Keamanan:</span>{" "}
              Siapa pun yang memindai kode ini memiliki akses penuh ke buku ini. Hanya bagikan ke perangkat pribadi Anda.
            </p>
          </div>
        </div>

        {/* Known Peers & Live Sync Diagnostics */}
        <div className="glass-card space-y-4 p-4 sm:p-5 lg:col-span-5">
          {/* Header & Status Indicator */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <h2 className="text-xs font-semibold text-foreground sm:text-sm">
                Perangkat Terhubung
              </h2>
              <span className="rounded-full border border-border bg-black/[0.04] px-2 py-0.5 text-[10px] font-semibold text-muted-foreground dark:bg-white/[0.06]">
                {peers.length}
              </span>
            </div>

            <div className="flex items-center gap-2">
              <div
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-medium ${
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
                      ? "animate-spin bg-sky-500"
                      : syncStatus.state === "connecting"
                        ? "animate-pulse bg-amber-500"
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
                className="nav-touch-item inline-flex items-center gap-1.5 rounded-full border border-border bg-black/[0.04] px-2.5 py-1 font-mono text-[10px] font-semibold text-foreground transition-colors hover:bg-muted dark:bg-white/[0.06] focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary disabled:opacity-50"
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
            <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-black/[0.03] p-6 text-center dark:bg-white/[0.03]">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-black/[0.05] text-muted-foreground dark:bg-white/[0.08]">
                <Laptop className="h-4 w-4 opacity-75" />
              </div>
              <p className="mt-2.5 text-xs font-semibold text-foreground">
                Belum ada perangkat terhubung
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {peers.map((peer, idx) => (
                <div
                  key={peer.node_id}
                  style={{ animationDelay: `${idx * 35}ms` }}
                  className="animate-card-up flex items-center justify-between gap-3 rounded-2xl border border-border bg-black/[0.03] p-3 transition-colors hover:border-primary/40 dark:bg-white/[0.04]"
                >
                  <div className="flex min-w-0 items-center gap-2.5">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-border bg-black/[0.04] text-muted-foreground dark:bg-white/[0.06]">
                      <Laptop className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="truncate text-xs font-semibold text-foreground">
                          {resolvePeerDisplayName(peer)}
                        </span>
                        <span className="rounded-full border border-border bg-black/[0.04] px-1.5 py-0.5 font-mono text-[9px] text-muted-foreground dark:bg-white/[0.06]">
                          ID: {peer.device_id ? peer.device_id.slice(0, 8) : peer.node_id.slice(0, 8)}
                        </span>
                        {peer.custom_alias && (
                          <span className="rounded-full bg-sky-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-sky-600 dark:text-sky-400">
                            Alias
                          </span>
                        )}
                        {peer.is_preferred_hub && (
                          <span className="rounded-full border border-primary/35 bg-primary/10 px-2 py-0.5 font-mono text-[9px] font-semibold text-primary">
                            HUB UTAMA
                          </span>
                        )}
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-[10px] text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <span
                            className={`h-1.5 w-1.5 rounded-full ${
                              peer.is_online
                                ? "animate-pulse bg-emerald-500"
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
                        <span>·</span>
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
                      className="nav-touch-item inline-flex h-7 w-7 items-center justify-center rounded-full border border-border bg-black/[0.04] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground dark:bg-white/[0.06] focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary"
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
                        className="nav-touch-item rounded-full border border-border bg-black/[0.04] px-2.5 py-1 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground dark:bg-white/[0.06] focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary disabled:opacity-50"
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
              <div
                data-floating-surface="true"
                className="floating-surface w-full max-w-sm rounded-3xl border border-border p-5"
              >
                <div className="flex items-center justify-between border-b border-border/70 pb-3">
                  <h3
                    id="edit-peer-alias-title"
                    className="flex items-center gap-2 text-sm font-semibold text-foreground"
                  >
                    <Pencil className="h-4 w-4 text-primary" />
                    <span>Ubah Nama Panggilan Perangkat</span>
                  </h3>
                  <button
                    type="button"
                    aria-label="Tutup"
                    onClick={() => setEditingPeer(null)}
                    className="rounded-full border border-border p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <form onSubmit={handleSaveAlias} className="mt-4 space-y-3.5">
                  <div className="space-y-1 rounded-2xl border border-border bg-black/[0.03] p-3 text-[11px] dark:bg-white/[0.04]">
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
                      className="mb-1.5 block text-xs font-medium text-muted-foreground"
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
                      className="flex h-10 w-full rounded-xl border border-border bg-black/[0.04] px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground/60 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary dark:bg-white/[0.06]"
                    />
                    <p className="mt-1.5 text-[10px] text-muted-foreground">
                      Nama ini hanya disimpan di perangkat ini untuk memudahkan Anda mengenali perangkat tersebut.
                    </p>
                  </div>

                  <div className="flex items-center justify-between gap-2 border-t border-border/70 pt-3">
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
                        className="rounded-full border border-border bg-black/[0.04] px-4 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground dark:bg-white/[0.06]"
                      >
                        Batal
                      </button>
                      <button
                        type="submit"
                        disabled={setPeerCustomAliasMutation.isPending}
                        className="rounded-full bg-cta-surface px-4 py-1.5 text-xs font-semibold text-cta-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
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
          <div className="overflow-hidden rounded-2xl border border-border bg-black/[0.03] dark:bg-white/[0.04]">
            <button
              type="button"
              onClick={() => setIsTopologyExpanded((prev) => !prev)}
              className="flex w-full items-center justify-between px-3.5 py-2.5 text-left text-xs font-medium text-foreground transition-colors hover:bg-black/[0.03] dark:hover:bg-white/[0.04]"
            >
              <div className="flex items-center gap-2">
                <Network className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-[11px] font-medium">Topologi Jaringan</span>
                <span className="rounded-full border border-primary/35 bg-primary/10 px-2 py-0.5 font-mono text-[9px] font-semibold text-primary">
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
              <div className="border-t border-border/70 px-3.5 py-3 text-xs">
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  Perubahan data dikirim melalui koneksi persisten dan otomatis diteruskan oleh perangkat Hub ke anggota lain.
                </p>
                <div className="mt-2.5 flex flex-wrap items-center gap-2">
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
                        className="nav-touch-item rounded-full border border-primary/40 bg-primary/10 px-3 py-1 font-mono text-[10px] font-semibold text-primary transition-colors hover:bg-primary/20 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary disabled:opacity-50"
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
                      className="nav-touch-item rounded-full border border-border bg-black/[0.04] px-3 py-1 font-mono text-[10px] font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground dark:bg-white/[0.06] focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary disabled:opacity-50"
                    >
                      Reset ke Mesh Otomatis
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Contrast Tips Callout */}
          <div className="contrast-card flex items-start gap-3 p-3.5 text-xs text-white/80">
            <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-zinc-950">
              <Info className="h-3.5 w-3.5" />
            </div>
            <p className="leading-relaxed">
              Pastikan kedua perangkat terhubung dalam jaringan yang sama agar sinkronisasi P2P langsung berjalan optimal.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

