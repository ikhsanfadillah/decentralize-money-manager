import { SignalingRoomHub, parseSignalingRequestPath } from "./room-hub.mjs";

/**
 * Cloudflare Durable Object for a single signaling room (`invite:<id>` or `topic:<id>`).
 * Uses `SignalingRoomHub` in-memory with zero persistent storage.
 */
export class SignalingRoomDurableObject {
  constructor() {
    this.hub = new SignalingRoomHub();
  }

  async fetch(request) {
    const upgradeHeader = request.headers.get("Upgrade");
    if (!upgradeHeader || upgradeHeader.toLowerCase() !== "websocket") {
      return new Response(JSON.stringify({ status: "ok", service: "dmm-signaling-do" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const url = new URL(request.url);
    const parsed = parseSignalingRequestPath(url.pathname);
    if (!parsed) {
      return new Response("Invalid signaling room path", { status: 400 });
    }

    // eslint-disable-next-line no-undef
    const pair = new WebSocketPair();
    const clientSocket = pair[0];
    const serverSocket = pair[1];

    serverSocket.accept();

    const session = this.hub.connectClient(parsed.roomType, parsed.roomId, {
      send: (jsonText) => {
        try {
          serverSocket.send(jsonText);
        } catch {
          // ignore send error
        }
      },
      close: (code, reason) => {
        try {
          serverSocket.close(code ?? 1000, reason ?? "");
        } catch {
          // ignore close error
        }
      },
    });

    if (!session) {
      return new Response(null, { status: 101, webSocket: clientSocket });
    }

    serverSocket.addEventListener("message", (event) => {
      try {
        session.handleMessage(event.data);
      } catch (err) {
        console.error("[signaling-do] message handling error:", err);
      }
    });

    const cleanup = () => {
      try {
        session.handleDisconnect();
      } catch {
        // ignore disconnect error
      }
    };
    serverSocket.addEventListener("close", cleanup);
    serverSocket.addEventListener("error", cleanup);

    return new Response(null, { status: 101, webSocket: clientSocket });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/healthz" || url.pathname === "/") {
      return new Response(
        JSON.stringify({
          status: "ok",
          service: "dmm-webrtc-signaling-worker",
          zeroKnowledge: true,
        }),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "Access-Control-Allow-Origin": "*",
          },
        },
      );
    }

    const parsed = parseSignalingRequestPath(url.pathname);
    if (!parsed) {
      return new Response(
        JSON.stringify({
          error: "Not Found",
          expected: ["/ws/invite/:roomId", "/ws/topic/:roomId", "/healthz"],
        }),
        {
          status: 404,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    const roomKey = `${parsed.roomType}:${parsed.roomId}`;
    const id = env.SIGNALING_ROOMS.idFromName(roomKey);
    const stub = env.SIGNALING_ROOMS.get(id);
    return stub.fetch(request);
  },
};

