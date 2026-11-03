import type { SignalingRoomHub } from "./room-hub.mjs";

export interface MinimalHttpServer {
  listen(port: number, host: string, cb?: () => void): void;
  close(cb?: (err?: Error) => void): void;
  address(): { port: number; address: string; family: string } | string | null;
}

export function attachSignalingUpgradeHandler(
  httpServer: unknown,
  options?: {
    hub?: SignalingRoomHub;
    onlyPrefixed?: boolean;
    inviteTtlMs?: number;
    topicTtlMs?: number;
    maxPayloadBytes?: number;
  },
): SignalingRoomHub;

export function createSignalingHttpServer(options?: {
  inviteTtlMs?: number;
  topicTtlMs?: number;
  maxPayloadBytes?: number;
}): {
  server: MinimalHttpServer;
  hub: SignalingRoomHub;
};

