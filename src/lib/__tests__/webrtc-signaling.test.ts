import { afterEach, describe, expect, it } from "vitest";
import {
  buildRtcConfiguration,
  buildSignalingRoomUrl,
  checkSignalingReachability,
  clearWebRtcRuntimeOverride,
  getWebRtcConfig,
  parseIceCandidateSummary,
  saveWebRtcRuntimeOverride,
} from "../webrtc-config";
import {
  SignalingRoomHub,
  parseSignalingRequestPath,
} from "../../../signaling-server/room-hub.mjs";
import { createSignalingHttpServer } from "../../../signaling-server/server.mjs";
import { encodeWsFrame } from "../../../signaling-server/ws-frame.mjs";

function lastItem<T>(arr: T[]): T | undefined {
  return arr[arr.length - 1];
}

describe("Langkah 2: WebRTC STUN/TURN Configuration & Stateless Signaling Server", () => {
  afterEach(() => {
    clearWebRtcRuntimeOverride();
  });

  it("builds RTCConfiguration with default STUN servers and optional TURN credentials", () => {
    const defaultCfg = getWebRtcConfig({});
    expect(defaultCfg.stunUrls.length).toBeGreaterThanOrEqual(2);
    expect(defaultCfg.turnUrls).toEqual([]);

    const rtcDefault = buildRtcConfiguration(defaultCfg);
    expect(rtcDefault.iceServers).toHaveLength(1);
    expect(rtcDefault.iceCandidatePoolSize).toBe(4);

    const turnCfg = getWebRtcConfig({
      VITE_SIGNALING_URL: "wss://signal.example.com/",
      VITE_STUN_URLS: "stun:stun.l.google.com:19302",
      VITE_TURN_URLS:
        "turn:standard.relay.metered.ca:80,turns:standard.relay.metered.ca:443?transport=tcp",
      VITE_TURN_USERNAME: "metered_user",
      VITE_TURN_CREDENTIAL: "metered_secret",
    });

    expect(turnCfg.signalingUrl).toBe("wss://signal.example.com");
    expect(turnCfg.turnUrls).toEqual([
      "turn:standard.relay.metered.ca:80",
      "turns:standard.relay.metered.ca:443?transport=tcp",
    ]);

    const rtcWithTurn = buildRtcConfiguration(turnCfg);
    expect(rtcWithTurn.iceServers).toEqual([
      { urls: "stun:stun.l.google.com:19302" },
      {
        urls: [
          "turn:standard.relay.metered.ca:80",
          "turns:standard.relay.metered.ca:443?transport=tcp",
        ],
        username: "metered_user",
        credential: "metered_secret",
      },
    ]);
  });

  it("supports runtime localStorage overrides and parses ICE candidate types (host, srflx, relay)", () => {
    saveWebRtcRuntimeOverride({
      signalingUrl: "wss://custom-signal.example.org",
      turnUrls: ["turn:coturn.example.org:3478"],
      turnUsername: "alice",
      turnCredential: "secret123",
    });

    const cfg = getWebRtcConfig({});
    expect(cfg.signalingUrl).toBe("wss://custom-signal.example.org");
    expect(cfg.turnUrls).toEqual(["turn:coturn.example.org:3478"]);
    expect(cfg.turnUsername).toBe("alice");

    expect(
      buildSignalingRoomUrl(cfg.signalingUrl, "invite", "room-abc-123"),
    ).toBe("wss://custom-signal.example.org/ws/invite/room-abc-123");
    expect(
      buildSignalingRoomUrl("http://localhost:1420/__dmm_signal", "topic", "topic_xyz"),
    ).toBe("ws://localhost:1420/__dmm_signal/ws/topic/topic_xyz");

    const hostParsed = parseIceCandidateSummary(
      "candidate:1 1 UDP 2122252543 192.168.1.10 54321 typ host",
    );
    expect(hostParsed).toEqual({
      type: "host",
      protocol: "udp",
      address: "192.168.1.10",
      port: 54321,
    });

    const srflxParsed = parseIceCandidateSummary(
      "candidate:2 1 UDP 1686052607 203.0.113.5 62000 typ srflx raddr 192.168.1.10 rport 54321",
    );
    expect(srflxParsed.type).toBe("srflx");

    const relayParsed = parseIceCandidateSummary(
      "candidate:3 1 TCP 41885439 198.51.100.77 443 typ relay raddr 203.0.113.5 rport 62000",
    );
    expect(relayParsed.type).toBe("relay");
    expect(relayParsed.protocol).toBe("tcp");
  });

  it("routes join, offer, answer, and ice-candidate messages between peers and enforces 2-peer limit on invite rooms", () => {
    expect(parseSignalingRequestPath("/__dmm_signal/ws/invite/inv-01")).toEqual({
      roomType: "invite",
      roomId: "inv-01",
    });
    expect(parseSignalingRequestPath("/ws/topic/book-topic-99")).toEqual({
      roomType: "topic",
      roomId: "book-topic-99",
    });

    const hub = new SignalingRoomHub();
    const inboxA: Array<Record<string, unknown>> = [];
    const inboxB: Array<Record<string, unknown>> = [];
    const inboxC: Array<Record<string, unknown>> = [];

    const sessionA = hub.connectClient("invite", "room-42", {
      send: (txt: string) => inboxA.push(JSON.parse(txt)),
    });
    const sessionB = hub.connectClient("invite", "room-42", {
      send: (txt: string) => inboxB.push(JSON.parse(txt)),
    });
    const sessionC = hub.connectClient("invite", "room-42", {
      send: (txt: string) => inboxC.push(JSON.parse(txt)),
    });

    expect(sessionA).not.toBeNull();
    expect(sessionB).not.toBeNull();
    expect(sessionC).toBeNull();
    expect(inboxC[0]).toMatchObject({
      type: "error",
      code: "ROOM_FULL",
    });

    sessionA!.handleMessage(JSON.stringify({ type: "join", peerId: "node-alpha" }));
    expect(lastItem(inboxA)).toMatchObject({
      type: "joined",
      peerId: "node-alpha",
    });

    sessionB!.handleMessage(JSON.stringify({ type: "join", peerId: "node-beta" }));
    expect(lastItem(inboxB)).toMatchObject({
      type: "joined",
      peerId: "node-beta",
      peers: ["node-alpha"],
    });
    expect(lastItem(inboxA)).toMatchObject({
      type: "peer-joined",
      peerId: "node-beta",
      peers: ["node-alpha", "node-beta"],
    });

    // Peer B sends SDP Offer to Peer A
    sessionB!.handleMessage(
      JSON.stringify({
        type: "offer",
        targetPeerId: "node-alpha",
        sdp: { type: "offer", sdp: "v=0...fake-offer" },
      }),
    );
    expect(lastItem(inboxA)).toMatchObject({
      type: "offer",
      fromPeerId: "node-beta",
      targetPeerId: "node-alpha",
      sdp: { type: "offer", sdp: "v=0...fake-offer" },
    });

    // Peer A responds with SDP Answer and ICE Candidate
    sessionA!.handleMessage(
      JSON.stringify({
        type: "answer",
        targetPeerId: "node-beta",
        sdp: { type: "answer", sdp: "v=0...fake-answer" },
      }),
    );
    expect(lastItem(inboxB)).toMatchObject({
      type: "answer",
      fromPeerId: "node-alpha",
      sdp: { type: "answer", sdp: "v=0...fake-answer" },
    });

    sessionA!.handleMessage(
      JSON.stringify({
        type: "ice-candidate",
        targetPeerId: "node-beta",
        candidate: { candidate: "candidate:1 1 UDP 2122252543 10.0.0.1 50000 typ host" },
      }),
    );
    expect(lastItem(inboxB)).toMatchObject({
      type: "ice-candidate",
      fromPeerId: "node-alpha",
    });

    // Disconnect Peer B -> Peer A receives peer-left
    sessionB!.handleDisconnect();
    expect(lastItem(inboxA)).toMatchObject({
      type: "peer-left",
      peerId: "node-beta",
      peers: ["node-alpha"],
    });

    sessionA!.handleDisconnect();
    expect(hub.getStats()).toEqual({
      activeRooms: 0,
      activeConnections: 0,
    });
  });

  it("verifies checkSignalingReachability and HTTP /healthz + RFC 6455 frame codec", async () => {
    const frame = encodeWsFrame(0x01, new TextEncoder().encode('{"type":"ping"}'));
    expect(frame[0]).toBe(0x81);
    expect(frame[1]).toBe(15);

    const originalWs = globalThis.WebSocket;
    const hub = new SignalingRoomHub();

    class MockSignalingWebSocket {
      url: string;
      onopen: (() => void) | null = null;
      onmessage: ((ev: { data: string }) => void) | null = null;
      onerror: (() => void) | null = null;
      onclose: ((ev: { code: number; reason: string }) => void) | null = null;
      private session: ReturnType<SignalingRoomHub["connectClient"]> = null;

      constructor(url: string) {
        this.url = url;
        const parsed = parseSignalingRequestPath(url);
        if (!parsed) {
          setTimeout(() => this.onerror?.(), 1);
          return;
        }
        this.session = hub.connectClient(parsed.roomType, parsed.roomId, {
          send: (jsonText: string) => {
            setTimeout(() => this.onmessage?.({ data: jsonText }), 1);
          },
          close: (code?: number, reason?: string) => {
            setTimeout(() => this.onclose?.({ code: code ?? 1000, reason: reason ?? "" }), 1);
          },
        });
        setTimeout(() => this.onopen?.(), 1);
      }

      send(data: string) {
        this.session?.handleMessage(data);
      }

      close() {
        this.session?.handleDisconnect();
      }
    }

    globalThis.WebSocket = MockSignalingWebSocket as unknown as typeof WebSocket;

    try {
      const probe = await checkSignalingReachability("ws://localhost:8787", 2000);
      expect(probe.reachable).toBe(true);
      expect(probe.error).toBeNull();
      expect(probe.latencyMs).toBeGreaterThanOrEqual(1);
    } finally {
      globalThis.WebSocket = originalWs;
    }

    const { server } = createSignalingHttpServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    try {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      const res = await fetch(`http://127.0.0.1:${port}/healthz`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { status: string; zeroKnowledge: boolean };
      expect(body.status).toBe("ok");
      expect(body.zeroKnowledge).toBe(true);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});
