import {
  CrdtMergeReport,
  CrdtOp,
} from "../web-worker/crdt-merge";
import {
  WebRtcPeerSession,
  WebRtcSignalingClient,
  type WebRtcWireMessage,
} from "../web-worker/webrtc-transport";
import {
  buildSignalingRoomUrl,
  getWebRtcConfig,
} from "./webrtc-config";
import {
  buildInviteShareUrl,
  decodeInviteToken,
  encodeInviteToken,
  type InviteTokenPayload,
  nowIso8601,
  randomHex,
  sha256Hex,
  validateBookId,
} from "./web-core";
import {
  TauriCommandError,
  type BookKind,
  type BookMetadata,
  type InviteResponse,
  type PeerInfo,
  type SyncStatusPayload,
  type SyncTopologyInfo,
} from "./tauri-api";
import { emitAppEvent, EVENT_CRDT_SYNCED, EVENT_SYNC_STATUS } from "./event-bus";
import { callWebWorkerCommand } from "./web-api-adapter";

export interface NodeTicketAddr {
  node_id: string;
  relay_url: string | null;
  direct_addrs: string[];
}

export interface InviteQrPayload {
  v: number;
  book_id: string;
  book_name: string;
  book_key: string;
  inviter_node_addr: NodeTicketAddr;
  expires_at: string;
}

function getOrCreateLocalNodeId(): string {
  try {
    if (typeof localStorage !== "undefined") {
      let id = localStorage.getItem("dmm.local_node_id");
      if (!id || id.trim().length !== 32) {
        id = randomHex(16);
        localStorage.setItem("dmm.local_node_id", id);
      }
      return id;
    }
  } catch {
    // Ignore localStorage access restrictions
  }
  return randomHex(16);
}

export class WebSyncEngine {
  private activeSessions = new Map<string, Map<string, WebRtcPeerSession>>(); // bookId -> (peerId -> session)
  private activeSignaling = new Map<string, WebRtcSignalingClient>(); // roomKey -> client
  private syncStatuses = new Map<string, SyncStatusPayload>();
  private isForeground = true;

  constructor(public readonly localNodeId: string = getOrCreateLocalNodeId()) {}

  getSyncStatus(bookId: string): SyncStatusPayload {
    const validId = validateBookId(bookId);
    const existing = this.syncStatuses.get(validId);
    if (existing) return existing;

    const activeCount = this.activeSessions.get(validId)?.size ?? 0;
    return {
      book_id: validId,
      state: "idle",
      peers: activeCount,
      last_synced_at: null,
    };
  }

  private updateSyncStatus(
    bookId: string,
    state: "idle" | "connecting" | "syncing" | "error",
    lastSyncedAt?: string | null,
  ): void {
    const validId = validateBookId(bookId);
    const activeCount = this.activeSessions.get(validId)?.size ?? 0;
    const current = this.getSyncStatus(validId);

    const updated: SyncStatusPayload = {
      book_id: validId,
      state,
      peers: activeCount,
      last_synced_at: lastSyncedAt !== undefined ? lastSyncedAt : current.last_synced_at,
    };
    this.syncStatuses.set(validId, updated);
    emitAppEvent(EVENT_SYNC_STATUS, updated);
  }

  /**
   * Generates a QR Code invite for a book and starts listening on the ephemeral room.
   */
  async createInvite(bookId: string, ttlSecs = 600): Promise<InviteResponse> {
    const validId = validateBookId(bookId);
    const meta = await callWebWorkerCommand<{
      bookId: string;
      bookName: string;
      bookKey: string;
      localNodeId: string;
    }>("get_sync_meta", { bookId: validId });

    const clampedTtl = Math.max(60, Math.min(3600, ttlSecs));
    const expiresAt = new Date(Date.now() + clampedTtl * 1000).toISOString();
    const roomId = `inv-${randomHex(16)}`;

    const config = getWebRtcConfig();
    const relayUrl = buildSignalingRoomUrl(config.signalingUrl, "invite", roomId);

    const payload: InviteTokenPayload = {
      v: 1,
      book_id: validId,
      book_name: meta.bookName,
      book_key: meta.bookKey,
      inviter_node_addr: {
        node_id: this.localNodeId,
        relay_url: relayUrl,
        direct_addrs: ["webrtc:v1"],
      },
      expires_at: expiresAt,
    };

    const inviteUrl = buildInviteShareUrl(payload);
    const token = encodeInviteToken(payload);

    // Start background listening on the invite room for joining peer
    this.listenOnInviteRoom(validId, relayUrl, roomId).catch((err) => {
      console.warn("[web-sync-engine] Invite room listener warning:", err);
    });

    return {
      qr_json: inviteUrl,
      invite_url: inviteUrl,
      token,
      expires_at: expiresAt,
      node_id: this.localNodeId,
    };
  }

  private async listenOnInviteRoom(
    bookId: string,
    relayUrl: string,
    roomId: string,
  ): Promise<void> {
    if (typeof WebSocket === "undefined" || typeof RTCPeerConnection === "undefined") {
      return;
    }

    let peerSession: WebRtcPeerSession | null = null;
    const signaling = new WebRtcSignalingClient(relayUrl, this.localNodeId, {
      onPeerJoined: () => {
        // Invite room: responder waits for Offer from joiner
      },
      onOffer: async (fromPeerId, offer) => {
        try {
          this.updateSyncStatus(bookId, "connecting");
          peerSession = new WebRtcPeerSession(fromPeerId, false, signaling, {
            onConnected: async () => {
              this.updateSyncStatus(bookId, "syncing");
              await this.performMutualSync(bookId, peerSession!);
            },
            onMessage: async (msg) => {
              await this.handleIncomingWireMessage(bookId, fromPeerId, msg, peerSession!);
            },
            onDisconnected: () => {
              this.removeSession(bookId, fromPeerId);
            },
          });

          await peerSession.initialize();
          await peerSession.handleRemoteOffer(offer);
          this.registerSession(bookId, fromPeerId, peerSession);
        } catch (err) {
          console.warn("[web-sync-engine] Error handling invite offer:", err);
          this.updateSyncStatus(bookId, "error");
        }
      },
      onAnswer: async (_fromPeerId, answer) => {
        if (peerSession) {
          await peerSession.handleRemoteAnswer(answer);
        }
      },
      onIceCandidate: async (_fromPeerId, candidate) => {
        if (peerSession) {
          await peerSession.handleRemoteIceCandidate(candidate);
        }
      },
      onPeerLeft: (peerId) => {
        this.removeSession(bookId, peerId);
      },
      onError: (err) => {
        console.warn("[web-sync-engine] Signaling error in invite room:", err);
      },
      onClose: () => {
        this.activeSignaling.delete(`invite:${roomId}`);
      },
    });

    this.activeSignaling.set(`invite:${roomId}`, signaling);
    await signaling.connect();
  }

  /**
   * Joins a book from an invite QR string or URL, connects to the inviter, and runs initial sync.
   */
  async joinBookFromInvite(inviteQrOrUrl: string, kind?: BookKind): Promise<BookMetadata> {
    const parsed = decodeInviteToken(inviteQrOrUrl);

    if (parsed.v !== 1) {
      throw new TauriCommandError(
        "INVITE_INVALID",
        `Versi undangan QR (v=${parsed.v}) tidak didukung`,
      );
    }
    if (!parsed.book_id || !parsed.book_name) {
      throw new TauriCommandError("INVITE_INVALID", "Data buku pada undangan tidak lengkap");
    }
    if (parsed.expires_at && new Date(parsed.expires_at).getTime() < Date.now()) {
      throw new TauriCommandError(
        "INVITE_EXPIRED",
        "Kode undangan telah kedaluwarsa (batas waktu 10 menit terlewati)",
      );
    }

    const validId = validateBookId(parsed.book_id);

    // 1. Insert book into registry & database meta
    const bookMeta = await callWebWorkerCommand<BookMetadata>("sync_join_book", {
      bookId: validId,
      bookName: parsed.book_name,
      bookKey: parsed.book_key,
      kind,
    });

    const relayUrl = parsed.inviter_node_addr?.relay_url;
    if (relayUrl && typeof WebSocket !== "undefined" && typeof RTCPeerConnection !== "undefined") {
      this.connectAsJoiner(validId, relayUrl, parsed.inviter_node_addr.node_id).catch((err) => {
        console.warn("[web-sync-engine] Failed to connect to inviter:", err);
      });
    }

    return bookMeta;
  }

  private async connectAsJoiner(
    bookId: string,
    relayUrl: string,
    targetNodeId: string,
  ): Promise<void> {
    this.updateSyncStatus(bookId, "connecting");
    let peerSession: WebRtcPeerSession | null = null;

    const joinTimeout = setTimeout(() => {
      if (!peerSession) {
        signaling.close();
        this.updateSyncStatus(bookId, "idle");
      }
    }, 20000);

    const signaling = new WebRtcSignalingClient(relayUrl, this.localNodeId, {
      onPeerJoined: async (peerId) => {
        if (!peerSession && (peerId === targetNodeId || !targetNodeId)) {
          peerSession = new WebRtcPeerSession(peerId, true, signaling, {
            onConnected: async () => {
              clearTimeout(joinTimeout);
              this.updateSyncStatus(bookId, "syncing");
              await this.performMutualSync(bookId, peerSession!);
            },
            onMessage: async (msg) => {
              await this.handleIncomingWireMessage(bookId, peerId, msg, peerSession!);
            },
            onDisconnected: () => {
              this.removeSession(bookId, peerId);
            },
          });
          await peerSession.initialize();
          this.registerSession(bookId, peerId, peerSession);
        }
      },
      onOffer: async () => {
        // Joiner acts as initiator in invite room
      },
      onAnswer: async (_fromPeerId, answer) => {
        if (peerSession) {
          await peerSession.handleRemoteAnswer(answer);
        }
      },
      onIceCandidate: async (_fromPeerId, candidate) => {
        if (peerSession) {
          await peerSession.handleRemoteIceCandidate(candidate);
        }
      },
      onPeerLeft: (peerId) => {
        this.removeSession(bookId, peerId);
      },
      onError: (err) => {
        console.warn("[web-sync-engine] Signaling error in joiner:", err);
      },
      onClose: () => {
        clearTimeout(joinTimeout);
        if (!peerSession) {
          this.updateSyncStatus(bookId, "idle");
        }
      },
    });

    try {
      await signaling.connect();
    } catch (err) {
      clearTimeout(joinTimeout);
      this.updateSyncStatus(bookId, "idle");
      console.warn("[web-sync-engine] Failed to connect signaling as joiner:", err);
    }
  }

  /**
   * Automatically connects to topic room `ws.../ws/topic/:topicId` for foreground syncing.
   */
  async startTopicSyncForBook(bookId: string): Promise<void> {
    if (!this.isForeground) return;
    if (typeof WebSocket === "undefined" || typeof RTCPeerConnection === "undefined") return;

    const validId = validateBookId(bookId);
    let meta: { bookKey: string };
    try {
      meta = await callWebWorkerCommand<{ bookKey: string }>("get_sync_meta", {
        bookId: validId,
      });
    } catch {
      return;
    }

    const topicHash = await sha256Hex(`dmm-topic-v1:${validId}:${meta.bookKey}`);
    const topicRoomId = topicHash.slice(0, 32);

    const config = getWebRtcConfig();
    const relayUrl = buildSignalingRoomUrl(config.signalingUrl, "topic", topicRoomId);
    const roomKey = `topic:${validId}:${topicRoomId}`;

    if (this.activeSignaling.has(roomKey)) return;

    const signaling = new WebRtcSignalingClient(relayUrl, this.localNodeId, {
      onPeerJoined: async (peerId) => {
        // Deterministic tie breaker: higher nodeId acts as initiator
        const shouldInitiate = this.localNodeId > peerId;
        if (shouldInitiate && !this.activeSessions.get(validId)?.has(peerId)) {
          const session = new WebRtcPeerSession(peerId, true, signaling, {
            onConnected: async () => {
              this.updateSyncStatus(validId, "syncing");
              await this.performMutualSync(validId, session);
            },
            onMessage: async (msg) => {
              await this.handleIncomingWireMessage(validId, peerId, msg, session);
            },
            onDisconnected: () => {
              this.removeSession(validId, peerId);
            },
          });
          await session.initialize();
          this.registerSession(validId, peerId, session);
        }
      },
      onOffer: async (fromPeerId, offer) => {
        if (!this.activeSessions.get(validId)?.has(fromPeerId)) {
          const session = new WebRtcPeerSession(fromPeerId, false, signaling, {
            onConnected: async () => {
              this.updateSyncStatus(validId, "syncing");
              await this.performMutualSync(validId, session);
            },
            onMessage: async (msg) => {
              await this.handleIncomingWireMessage(validId, fromPeerId, msg, session);
            },
            onDisconnected: () => {
              this.removeSession(validId, fromPeerId);
            },
          });
          await session.initialize();
          await session.handleRemoteOffer(offer);
          this.registerSession(validId, fromPeerId, session);
        }
      },
      onAnswer: async (fromPeerId, answer) => {
        const session = this.activeSessions.get(validId)?.get(fromPeerId);
        if (session) {
          await session.handleRemoteAnswer(answer);
        }
      },
      onIceCandidate: async (fromPeerId, candidate) => {
        const session = this.activeSessions.get(validId)?.get(fromPeerId);
        if (session) {
          await session.handleRemoteIceCandidate(candidate);
        }
      },
      onPeerLeft: (peerId) => {
        this.removeSession(validId, peerId);
      },
      onError: (err) => {
        console.warn("[web-sync-engine] Signaling error in topic room:", err);
      },
      onClose: () => {
        this.activeSignaling.delete(roomKey);
      },
    });

    this.activeSignaling.set(roomKey, signaling);
    try {
      await signaling.connect();
    } catch (err) {
      console.warn("[web-sync-engine] Failed to connect to topic room:", err);
      this.activeSignaling.delete(roomKey);
    }
  }

  stopTopicSyncForBook(bookId: string): void {
    const validId = validateBookId(bookId);
    for (const [key, client] of this.activeSignaling.entries()) {
      if (key.startsWith(`topic:${validId}:`)) {
        client.close();
        this.activeSignaling.delete(key);
      }
    }
    const bookSessions = this.activeSessions.get(validId);
    if (bookSessions) {
      for (const session of bookSessions.values()) {
        session.close();
      }
      this.activeSessions.delete(validId);
    }
    this.updateSyncStatus(validId, "idle");
  }

  /**
   * Broadcasts a newly created or modified CRDT operation to all connected DataChannels.
   */
  async broadcastLocalOp(bookId: string, op: CrdtOp): Promise<void> {
    const validId = validateBookId(bookId);
    const sessions = this.activeSessions.get(validId);
    if (!sessions || sessions.size === 0) return;

    const pushMsg: WebRtcWireMessage = {
      type: "push_ops",
      ops: [op],
    };

    for (const session of sessions.values()) {
      try {
        await session.sendWireMessage(pushMsg);
      } catch (err) {
        console.warn("[web-sync-engine] Failed to push local op to peer:", err);
      }
    }
  }

  private async performMutualSync(bookId: string, session: WebRtcPeerSession): Promise<void> {
    try {
      const localFrontier = await callWebWorkerCommand<Record<string, string>>(
        "get_sync_frontier",
        { bookId }
      );

      await session.sendWireMessage({
        type: "frontier",
        frontier: localFrontier,
      });
    } catch (err) {
      console.warn("[web-sync-engine] performMutualSync error:", err);
      this.updateSyncStatus(bookId, "idle");
    }
  }

  private async handleIncomingWireMessage(
    bookId: string,
    fromPeerId: string,
    msg: WebRtcWireMessage,
    session: WebRtcPeerSession,
  ): Promise<void> {
    switch (msg.type) {
      case "frontier": {
        const missingOps = await callWebWorkerCommand<CrdtOp[]>(
          "get_sync_delta_ops",
          { bookId, remoteFrontier: msg.frontier, limit: 500 }
        );
        await session.sendWireMessage({
          type: "delta",
          ops: missingOps,
          isFinal: true,
        });
        break;
      }

      case "delta": {
        if (msg.ops && msg.ops.length > 0) {
          const report = await callWebWorkerCommand<CrdtMergeReport>(
            "apply_sync_delta_ops",
            { bookId, ops: msg.ops, fromPeerId }
          );

          if (report.tables && report.tables.length > 0) {
            emitAppEvent(EVENT_CRDT_SYNCED, {
              book_id: bookId,
              tables: report.tables,
            });
          }
        } else {
          await callWebWorkerCommand("record_peer_seen", {
            bookId,
            nodeId: fromPeerId,
          });
        }

        await session.sendWireMessage({
          type: "sync_ack",
          ok: true,
        });

        this.updateSyncStatus(bookId, "idle", nowIso8601());
        break;
      }

      case "push_ops": {
        if (msg.ops && msg.ops.length > 0) {
          const report = await callWebWorkerCommand<CrdtMergeReport>(
            "apply_sync_delta_ops",
            { bookId, ops: msg.ops, fromPeerId }
          );

          if (report.tables && report.tables.length > 0) {
            emitAppEvent(EVENT_CRDT_SYNCED, {
              book_id: bookId,
              tables: report.tables,
            });
          }
        }
        break;
      }

      case "sync_ack": {
        this.updateSyncStatus(bookId, "idle", nowIso8601());
        break;
      }
    }
  }

  private registerSession(bookId: string, peerId: string, session: WebRtcPeerSession): void {
    let bookMap = this.activeSessions.get(bookId);
    if (!bookMap) {
      bookMap = new Map();
      this.activeSessions.set(bookId, bookMap);
    }
    bookMap.set(peerId, session);
    this.updateSyncStatus(bookId, "idle");
  }

  private removeSession(bookId: string, peerId: string): void {
    const bookMap = this.activeSessions.get(bookId);
    if (bookMap) {
      bookMap.delete(peerId);
      if (bookMap.size === 0) {
        this.activeSessions.delete(bookId);
      }
    }
    this.updateSyncStatus(bookId, "idle");
  }

  async listPeers(bookId: string): Promise<PeerInfo[]> {
    const validId = validateBookId(bookId);
    const peers = await callWebWorkerCommand<
      Array<{
        node_id: string;
        device_id: string | null;
        last_seen_at: string | null;
        device_name: string | null;
        custom_alias: string | null;
      }>
    >("get_sync_peers", { bookId: validId });
    const meta = await callWebWorkerCommand<{ preferredHubNodeId: string | null }>(
      "get_sync_meta",
      { bookId: validId }
    );
    const activeMap = this.activeSessions.get(validId);

    return peers.map((p) => ({
      node_id: p.node_id,
      device_id: p.device_id,
      last_seen_at: p.last_seen_at,
      device_name: p.device_name,
      custom_alias: p.custom_alias,
      is_online: Boolean(activeMap?.has(p.node_id)),
      is_preferred_hub: meta.preferredHubNodeId === p.node_id,
    }));
  }

  async getSyncTopology(bookId: string): Promise<SyncTopologyInfo> {
    const validId = validateBookId(bookId);
    const meta = await callWebWorkerCommand<{ preferredHubNodeId: string | null }>(
      "get_sync_meta",
      { bookId: validId }
    );
    const activeStreams = this.activeSessions.get(validId)?.size ?? 0;

    return {
      book_id: validId,
      local_node_id: this.localNodeId,
      preferred_hub_node_id: meta.preferredHubNodeId,
      active_streams: activeStreams,
    };
  }

  async triggerManualSync(bookId: string): Promise<void> {
    const validId = validateBookId(bookId);
    const sessions = this.activeSessions.get(validId);
    if (sessions && sessions.size > 0) {
      this.updateSyncStatus(validId, "syncing");
      for (const session of sessions.values()) {
        await this.performMutualSync(validId, session);
      }
    } else {
      await this.startTopicSyncForBook(validId);
    }
  }

  async setAppForeground(isForeground: boolean): Promise<void> {
    this.isForeground = isForeground;
    if (!isForeground) {
      for (const client of this.activeSignaling.values()) {
        client.close();
      }
      this.activeSignaling.clear();
      for (const bookSessions of this.activeSessions.values()) {
        for (const session of bookSessions.values()) {
          session.close();
        }
      }
      this.activeSessions.clear();
    }
  }
}

let syncEngineInstance: WebSyncEngine | null = null;

export function getWebSyncEngine(): WebSyncEngine {
  if (!syncEngineInstance) {
    syncEngineInstance = new WebSyncEngine();
  }
  return syncEngineInstance;
}

