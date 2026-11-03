export interface ParsedSignalingPath {
  roomType: "invite" | "topic";
  roomId: string;
}

export function parseSignalingRequestPath(rawUrlOrPath: string): ParsedSignalingPath | null;

export interface SignalingClientTransport {
  send: (jsonText: string) => void;
  close?: (code?: number, reason?: string) => void;
}

export interface SignalingClientSession {
  connId: string;
  roomKey: string;
  handleMessage: (rawMessage: string | Uint8Array) => void;
  handleDisconnect: () => void;
}

export class SignalingRoomHub {
  constructor(options?: {
    inviteTtlMs?: number;
    topicTtlMs?: number;
    maxPayloadBytes?: number;
  });

  connectClient(
    roomType: "invite" | "topic",
    roomId: string,
    transport: SignalingClientTransport,
  ): SignalingClientSession | null;

  getStats(): {
    activeRooms: number;
    activeConnections: number;
  };

  purgeExpiredRooms(now?: number): void;
}

