import type { Database } from "@sqlite.org/sqlite-wasm";
import {
  CrdtMergeReport,
  CrdtOp,
  collectOpsSinceFrontier,
  computeLocalFrontier,
  mergeRemoteOplog,
} from "./crdt-merge";
import {
  WebRtcPeerSession,
  WebRtcSignalingClient,
  type WebRtcWireMessage,
} from "./webrtc-transport";
import {
  buildSignalingRoomUrl,
  getWebRtcConfig,
} from "../lib/webrtc-config";
import {
  decodeInviteToken,
  nowIso8601,
  randomHex,
  sha256Hex,
  validateBookId,
} from "../lib/web-core";
import {
  TauriCommandError,
  type BookKind,
  type BookMetadata,
  type InviteResponse,
  type PeerInfo,
  type SyncStatusPayload,
  type SyncTopologyInfo,
} from "../lib/tauri-api";
import { emitAppEvent, EVENT_CRDT_SYNCED, EVENT_SYNC_STATUS } from "../lib/event-bus";

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

export interface SyncEngineHost {
  getOrOpenBook(bookId: string): Promise<Database>;
  withBookWrite<T>(bookId: string, action: (db: Database) => Promise<T> | T): Promise<T>;
  getRegistryDb(): Database;
  initBookDb(db: Database, bookId: string, bookName: string, seedDefaults: boolean): void;
  persistDatabaseFile(virtualPath: string, db: Database): Promise<void>;
  bookVirtualPath(validBookId: string): string;
}

export class WebSyncEngine {
  private activeSessions = new Map<string, Map<string, WebRtcPeerSession>>(); // bookId -> (peerId -> session)
  private activeSignaling = new Map<string, WebRtcSignalingClient>(); // roomKey -> client
  private syncStatuses = new Map<string, SyncStatusPayload>();
  private isForeground = true;

  constructor(
    public readonly localNodeId: string,
    private readonly host: SyncEngineHost,
  ) {}

  getSyncStatus(bookId: string): SyncStatusPayload {
    const validId = validateBookId(bookId);
    const existing = this.syncStatuses.get(validId);
    if (existing) return existing;

    const activeCount = this.activeSessions.get(validId)?.size ?? 0;
    return {
      book_id: validId,
      state: activeCount > 0 ? "idle" : "idle",
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
   * Retrieves or creates a 32-byte hex book key stored in `meta`.
   */
  async getOrCreateBookKey(bookId: string): Promise<string> {
    const validId = validateBookId(bookId);
    return await this.host.withBookWrite(validId, (db) => {
      let key = db.selectValue(
        "SELECT value FROM meta WHERE key = 'book_key'",
      ) as string | undefined;

      if (!key || key.trim().length !== 64) {
        key = randomHex(32);
        db.exec({
          sql: `INSERT INTO meta (key, value) VALUES ('book_key', ?1)
                ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
          bind: [key],
        });
      }
      return key;
    });
  }

  /**
   * Generates a QR Code invite for a book and starts listening on the ephemeral room.
   */
  async createInvite(bookId: string, ttlSecs = 600): Promise<InviteResponse> {
    const validId = validateBookId(bookId);
    const registry = this.host.getRegistryDb();
    const bookName = registry.selectValue(
      "SELECT name FROM books WHERE id = ?1",
      [validId],
    ) as string | undefined;

    if (!bookName) {
      throw new TauriCommandError("BOOK_NOT_FOUND", `Buku tidak ditemukan: ${validId}`);
    }

    const bookKey = await this.getOrCreateBookKey(validId);
    const clampedTtl = Math.max(60, Math.min(3600, ttlSecs));
    const expiresAt = new Date(Date.now() + clampedTtl * 1000).toISOString();
    const roomId = `inv-${randomHex(16)}`;

    const config = getWebRtcConfig();
    const relayUrl = buildSignalingRoomUrl(config.signalingUrl, "invite", roomId);

    const payload: InviteQrPayload = {
      v: 1,
      book_id: validId,
      book_name: bookName,
      book_key: bookKey,
      inviter_node_addr: {
        node_id: this.localNodeId,
        relay_url: relayUrl,
        direct_addrs: ["webrtc:v1"],
      },
      expires_at: expiresAt,
    };

    const qrJson = JSON.stringify(payload);

    // Start background listening on the invite room for joining peer
    this.listenOnInviteRoom(validId, relayUrl, roomId).catch((err) => {
      console.warn("[sync-engine] Invite room listener error:", err);
    });

    return {
      qr_json: qrJson,
      expires_at: expiresAt,
      node_id: this.localNodeId,
    };
  }

  private async listenOnInviteRoom(
    bookId: string,
    relayUrl: string,
    roomId: string,
  ): Promise<void> {
    if (typeof WebSocket === "undefined") return;

    let peerSession: WebRtcPeerSession | null = null;
    const signaling = new WebRtcSignalingClient(relayUrl, this.localNodeId, {
      onPeerJoined: () => {
        // Invite room: responder waits for Offer from joiner (or initiator)
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
          console.warn("[sync-engine] Error handling invite offer:", err);
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
        console.warn("[sync-engine] Signaling error in invite room:", err);
      },
    });

    this.activeSignaling.set(`invite:${roomId}`, signaling);
    await signaling.connect();
  }

  /**
   * Joins a book from an invite QR string, connects to the inviter, and runs initial sync.
   */
  async joinBookFromInvite(inviteQr: string, kind?: BookKind): Promise<BookMetadata> {
    const parsed = decodeInviteToken(inviteQr);

    if (parsed.v !== 1 && parsed.v !== 2) {
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
    const bookName = parsed.book_name.trim();
    const bookKind = (kind?.trim() || "PERSONAL").toUpperCase();
    const now = nowIso8601();

    // 1. Insert book into registry
    const registry = this.host.getRegistryDb();
    registry.exec({
      sql: `INSERT INTO books (id, name, kind, created_at, last_opened_at)
            VALUES (?1, ?2, ?3, ?4, ?5)
            ON CONFLICT(id) DO UPDATE SET
               name = excluded.name,
               last_opened_at = excluded.last_opened_at`,
      bind: [validId, bookName, bookKind, now, now],
    });
    await this.host.persistDatabaseFile("/registry.sqlite", registry);

    // 2. Open book DB and store book_key
    const vPath = this.host.bookVirtualPath(validId);
    const bookDb = await this.host.getOrOpenBook(validId);
    this.host.initBookDb(bookDb, validId, bookName, false);
    if (parsed.book_key) {
      bookDb.exec({
        sql: `INSERT INTO meta (key, value) VALUES ('book_key', ?1)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        bind: [parsed.book_key.trim()],
      });
    }
    await this.host.persistDatabaseFile(vPath, bookDb);

    const relayUrl = parsed.inviter_node_addr?.relay_url;
    if (relayUrl && typeof WebSocket !== "undefined" && typeof RTCPeerConnection !== "undefined") {
      this.connectAsJoiner(validId, relayUrl, parsed.inviter_node_addr.node_id).catch((err) => {
        console.warn("[sync-engine] Failed to connect to inviter:", err);
      });
    }

    return {
      id: validId,
      name: bookName,
      kind: bookKind,
      created_at: now,
      last_opened_at: now,
      file_exists: true,
    };
  }

  private async connectAsJoiner(
    bookId: string,
    relayUrl: string,
    targetNodeId: string,
  ): Promise<void> {
    this.updateSyncStatus(bookId, "connecting");
    let peerSession: WebRtcPeerSession | null = null;

    const signaling = new WebRtcSignalingClient(relayUrl, this.localNodeId, {
      onPeerJoined: async (peerId) => {
        if (!peerSession && (peerId === targetNodeId || !targetNodeId)) {
          peerSession = new WebRtcPeerSession(peerId, true, signaling, {
            onConnected: async () => {
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
        // Initiator does not handle incoming offer
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
        console.warn("[sync-engine] Signaling error in joiner:", err);
      },
    });

    await signaling.connect();
  }

  /**
   * Automatically connects to topic room `ws.../ws/topic/:topicId` for foreground syncing.
   */
  async startTopicSyncForBook(bookId: string): Promise<void> {
    if (!this.isForeground) return;
    if (typeof WebSocket === "undefined" || typeof RTCPeerConnection === "undefined") return;

    const validId = validateBookId(bookId);
    const bookKey = await this.getOrCreateBookKey(validId);
    const topicHash = await sha256Hex(`dmm-topic-v1:${validId}:${bookKey}`);
    const topicRoomId = topicHash.slice(0, 32);

    const config = getWebRtcConfig();
    const relayUrl = buildSignalingRoomUrl(config.signalingUrl, "topic", topicRoomId);
    const roomKey = `topic:${topicRoomId}`;

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
    });

    this.activeSignaling.set(roomKey, signaling);
    await signaling.connect();
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
        console.warn("[sync-engine] Failed to push local op to peer:", err);
      }
    }
  }

  private async performMutualSync(bookId: string, session: WebRtcPeerSession): Promise<void> {
    const db = await this.host.getOrOpenBook(bookId);
    const localFrontier = computeLocalFrontier(db);

    await session.sendWireMessage({
      type: "frontier",
      frontier: localFrontier,
    });
  }

  private async handleIncomingWireMessage(
    bookId: string,
    fromPeerId: string,
    msg: WebRtcWireMessage,
    session: WebRtcPeerSession,
  ): Promise<void> {
    const db = await this.host.getOrOpenBook(bookId);

    switch (msg.type) {
      case "frontier": {
        const missingOps = collectOpsSinceFrontier(db, msg.frontier, 500);
        await session.sendWireMessage({
          type: "delta",
          ops: missingOps,
          isFinal: true,
        });
        break;
      }

      case "delta": {
        if (msg.ops.length > 0) {
          const report: CrdtMergeReport = await this.host.withBookWrite(bookId, (writeDb) =>
            mergeRemoteOplog(writeDb, msg.ops),
          );

          if (report.tables.length > 0) {
            emitAppEvent(EVENT_CRDT_SYNCED, {
              book_id: bookId,
              tables: report.tables,
            });
          }
        }

        // Record peer activity
        await this.host.withBookWrite(bookId, (writeDb) => {
          writeDb.exec({
            sql: `INSERT INTO sync_peers (node_id, last_seen_at)
                  VALUES (?1, ?2)
                  ON CONFLICT(node_id) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
            bind: [fromPeerId, nowIso8601()],
          });
        });

        await session.sendWireMessage({
          type: "sync_ack",
          ok: true,
        });

        this.updateSyncStatus(bookId, "idle", nowIso8601());
        break;
      }

      case "push_ops": {
        if (msg.ops.length > 0) {
          const report = await this.host.withBookWrite(bookId, (writeDb) =>
            mergeRemoteOplog(writeDb, msg.ops),
          );

          if (report.tables.length > 0) {
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
    const db = await this.host.getOrOpenBook(validId);
    const prefHub = db.selectValue(
      "SELECT value FROM meta WHERE key = 'preferred_hub_node_id'",
    ) as string | undefined;

    const activeMap = this.activeSessions.get(validId);
    const rows = db.selectArrays(
      "SELECT node_id, device_id, last_seen_at FROM sync_peers ORDER BY last_seen_at DESC",
    );

    return rows.map((r) => {
      const nodeId = String(r[0]);
      return {
        node_id: nodeId,
        device_id: r[1] !== null ? String(r[1]) : null,
        last_seen_at: r[2] !== null ? String(r[2]) : null,
        is_online: Boolean(activeMap?.has(nodeId)),
        is_preferred_hub: prefHub === nodeId,
      };
    });
  }

  async getSyncTopology(bookId: string): Promise<SyncTopologyInfo> {
    const validId = validateBookId(bookId);
    const db = await this.host.getOrOpenBook(validId);
    const prefHub = db.selectValue(
      "SELECT value FROM meta WHERE key = 'preferred_hub_node_id'",
    ) as string | undefined;
    const activeStreams = this.activeSessions.get(validId)?.size ?? 0;

    return {
      book_id: validId,
      local_node_id: this.localNodeId,
      preferred_hub_node_id: prefHub && prefHub.trim() !== "" ? prefHub : null,
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
