const INVITE_ROOM_TTL_MS = 5 * 60 * 1000;
const TOPIC_ROOM_TTL_MS = 60 * 60 * 1000;
const MAX_PAYLOAD_BYTES = 64 * 1024;
const INVITE_MAX_PEERS = 2;
const TOPIC_MAX_PEERS = 8;

/**
 * Parse a WebSocket request path into `{ roomType, roomId }`.
 * Supports:
 * - `/ws/invite/:roomId`
 * - `/ws/topic/:roomId`
 * - `/__dmm_signal/ws/invite/:roomId`
 * - `/__dmm_signal/ws/topic/:roomId`
 * - `/room/:roomId` (legacy alias -> invite)
 */
export function parseSignalingRequestPath(rawUrlOrPath) {
  if (!rawUrlOrPath || typeof rawUrlOrPath !== "string") {
    return null;
  }

  let pathname = rawUrlOrPath;
  try {
    const parsed = new URL(rawUrlOrPath, "http://localhost");
    pathname = parsed.pathname;
  } catch {
    const qIdx = rawUrlOrPath.indexOf("?");
    pathname = qIdx >= 0 ? rawUrlOrPath.slice(0, qIdx) : rawUrlOrPath;
  }

  const normalized = pathname.replace(/^\/__dmm_signal(?=\/|$)/, "") || "/";

  const matchTyped = normalized.match(/^\/ws\/(invite|topic)\/([A-Za-z0-9._:-]{1,128})\/?$/);
  if (matchTyped) {
    return {
      roomType: matchTyped[1],
      roomId: decodeURIComponent(matchTyped[2]),
    };
  }

  const matchLegacy = normalized.match(/^\/(?:ws|room)\/([A-Za-z0-9._:-]{1,128})\/?$/);
  if (matchLegacy) {
    return {
      roomType: "invite",
      roomId: decodeURIComponent(matchLegacy[1]),
    };
  }

  return null;
}

/**
 * Stateless, ephemeral in-memory room hub for WebRTC SDP & ICE signaling.
 * Stores zero transaction data and zero book encryption keys.
 */
export class SignalingRoomHub {
  constructor(options = {}) {
    this.inviteTtlMs = options.inviteTtlMs ?? INVITE_ROOM_TTL_MS;
    this.topicTtlMs = options.topicTtlMs ?? TOPIC_ROOM_TTL_MS;
    this.maxPayloadBytes = options.maxPayloadBytes ?? MAX_PAYLOAD_BYTES;
    this.rooms = new Map();
    this.nextConnSeq = 1;
  }

  getRoomKey(roomType, roomId) {
    return `${roomType}:${roomId}`;
  }

  purgeExpiredRooms(now = Date.now()) {
    for (const [roomKey, room] of this.rooms.entries()) {
      if (now >= room.expiresAt) {
        for (const client of room.clients.values()) {
          this.safeSend(client.send, {
            type: "error",
            code: "ROOM_EXPIRED",
            message: "Signaling room TTL expired",
          });
          try {
            client.close?.(1000, "Room expired");
          } catch {
            // Ignore close errors
          }
        }
        this.rooms.delete(roomKey);
      }
    }
  }

  /**
   * Register a WebSocket client into `(roomType, roomId)`.
   * @param {"invite" | "topic"} roomType
   * @param {string} roomId
   * @param {{ send: (jsonText: string) => void, close?: (code?: number, reason?: string) => void }} transport
   */
  connectClient(roomType, roomId, transport) {
    const now = Date.now();
    this.purgeExpiredRooms(now);

    const roomKey = this.getRoomKey(roomType, roomId);
    const maxPeers = roomType === "invite" ? INVITE_MAX_PEERS : TOPIC_MAX_PEERS;
    const ttlMs = roomType === "invite" ? this.inviteTtlMs : this.topicTtlMs;

    let room = this.rooms.get(roomKey);
    if (!room) {
      room = {
        roomKey,
        roomType,
        roomId,
        createdAt: now,
        expiresAt: now + ttlMs,
        maxPeers,
        clients: new Map(),
      };
      this.rooms.set(roomKey, room);
    }

    if (room.clients.size >= room.maxPeers) {
      this.safeSend(transport.send, {
        type: "error",
        code: "ROOM_FULL",
        message: `Signaling room ${roomKey} has reached maximum capacity (${room.maxPeers})`,
      });
      try {
        transport.close?.(1008, "Room full");
      } catch {
        // Ignore
      }
      return null;
    }

    const connId = `conn-${this.nextConnSeq++}`;
    const clientRecord = {
      connId,
      peerId: connId,
      joinedAt: now,
      send: transport.send,
      close: transport.close,
    };

    room.clients.set(connId, clientRecord);
    if (roomType === "topic") {
      room.expiresAt = now + ttlMs;
    }

    return {
      connId,
      roomKey,
      handleMessage: (rawMessage) => this.handleClientMessage(roomKey, connId, rawMessage),
      handleDisconnect: () => this.disconnectClient(roomKey, connId),
    };
  }

  handleClientMessage(roomKey, connId, rawMessage) {
    const room = this.rooms.get(roomKey);
    if (!room) return;

    const sender = room.clients.get(connId);
    if (!sender) return;

    let text;
    if (typeof rawMessage === "string") {
      text = rawMessage;
    } else if (rawMessage instanceof ArrayBuffer || ArrayBuffer.isView(rawMessage)) {
      text = new TextDecoder().decode(rawMessage);
    } else {
      text = String(rawMessage);
    }

    const byteLen = new TextEncoder().encode(text).length;
    if (byteLen > this.maxPayloadBytes) {
      this.safeSend(sender.send, {
        type: "error",
        code: "PAYLOAD_TOO_LARGE",
        message: `Signaling frame exceeds ${this.maxPayloadBytes} bytes`,
      });
      return;
    }

    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      this.safeSend(sender.send, {
        type: "error",
        code: "INVALID_JSON",
        message: "Signaling message must be valid JSON",
      });
      return;
    }

    if (!msg || typeof msg !== "object" || typeof msg.type !== "string") {
      this.safeSend(sender.send, {
        type: "error",
        code: "INVALID_MESSAGE",
        message: "Signaling message requires a string 'type' field",
      });
      return;
    }

    const now = Date.now();
    if (room.roomType === "topic") {
      room.expiresAt = now + this.topicTtlMs;
    }

    switch (msg.type) {
      case "ping": {
        this.safeSend(sender.send, {
          type: "pong",
          ts: typeof msg.ts === "number" ? msg.ts : now,
          serverTs: now,
        });
        return;
      }

      case "join": {
        const requestedPeerId =
          typeof msg.peerId === "string" && msg.peerId.trim().length > 0
            ? msg.peerId.trim().slice(0, 128)
            : sender.peerId;

        sender.peerId = requestedPeerId;

        const otherPeers = [];
        for (const [id, client] of room.clients.entries()) {
          if (id !== connId) {
            otherPeers.push(client.peerId);
          }
        }

        this.safeSend(sender.send, {
          type: "joined",
          roomKey: room.roomKey,
          roomType: room.roomType,
          roomId: room.roomId,
          peerId: sender.peerId,
          peers: otherPeers,
          expiresAt: room.expiresAt,
        });

        const allPeers = Array.from(room.clients.values()).map((c) => c.peerId);
        for (const [id, client] of room.clients.entries()) {
          if (id !== connId) {
            this.safeSend(client.send, {
              type: "peer-joined",
              peerId: sender.peerId,
              peers: allPeers,
            });
          }
        }
        return;
      }

      case "offer":
      case "answer":
      case "ice-candidate":
      case "signal": {
        const targetPeerId =
          typeof msg.targetPeerId === "string" && msg.targetPeerId.trim().length > 0
            ? msg.targetPeerId.trim()
            : null;

        const outbound = {
          ...msg,
          fromPeerId: sender.peerId,
        };

        for (const [id, client] of room.clients.entries()) {
          if (id === connId) continue;
          if (targetPeerId && client.peerId !== targetPeerId) continue;
          this.safeSend(client.send, outbound);
        }
        return;
      }

      default: {
        // Forward any custom ephemeral WebRTC control frame to other peers in the room
        const targetPeerId =
          typeof msg.targetPeerId === "string" && msg.targetPeerId.trim().length > 0
            ? msg.targetPeerId.trim()
            : null;

        const outbound = {
          ...msg,
          fromPeerId: sender.peerId,
        };

        for (const [id, client] of room.clients.entries()) {
          if (id === connId) continue;
          if (targetPeerId && client.peerId !== targetPeerId) continue;
          this.safeSend(client.send, outbound);
        }
      }
    }
  }

  disconnectClient(roomKey, connId) {
    const room = this.rooms.get(roomKey);
    if (!room) return;

    const departing = room.clients.get(connId);
    if (!departing) return;

    room.clients.delete(connId);

    if (room.clients.size === 0) {
      this.rooms.delete(roomKey);
      return;
    }

    const remainingPeers = Array.from(room.clients.values()).map((c) => c.peerId);
    for (const client of room.clients.values()) {
      this.safeSend(client.send, {
        type: "peer-left",
        peerId: departing.peerId,
        peers: remainingPeers,
      });
    }
  }

  getStats() {
    this.purgeExpiredRooms();
    let totalConnections = 0;
    for (const room of this.rooms.values()) {
      totalConnections += room.clients.size;
    }
    return {
      activeRooms: this.rooms.size,
      activeConnections: totalConnections,
    };
  }

  safeSend(sendFn, payload) {
    try {
      sendFn(JSON.stringify(payload));
    } catch {
      // Ignore send errors on closing sockets
    }
  }
}

