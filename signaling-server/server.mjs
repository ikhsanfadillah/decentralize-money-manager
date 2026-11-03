import http from "node:http";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { SignalingRoomHub, parseSignalingRequestPath } from "./room-hub.mjs";
import { upgradeToWebSocket } from "./ws-frame.mjs";

/**
 * Attach WebRTC signaling upgrade handler to an existing Node HTTP server.
 * When `onlyPrefixed` is true (e.g. inside Vite dev server), only upgrades
 * requests starting with `/__dmm_signal/` so Vite HMR WebSockets are untouched.
 */
export function attachSignalingUpgradeHandler(httpServer, options = {}) {
  const hub = options.hub ?? new SignalingRoomHub(options);
  const onlyPrefixed = Boolean(options.onlyPrefixed);

  httpServer.on("upgrade", (req, socket, head) => {
    const rawUrl = req.url || "/";
    if (onlyPrefixed && !rawUrl.startsWith("/__dmm_signal")) {
      return;
    }

    const parsed = parseSignalingRequestPath(rawUrl);
    if (!parsed) {
      if (!onlyPrefixed) {
        socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
        socket.destroy();
      }
      return;
    }

    let session = null;
    const wsTransport = upgradeToWebSocket(req, socket, head, {
      onMessage: (text) => {
        session?.handleMessage(text);
      },
      onClose: () => {
        session?.handleDisconnect();
      },
    });

    if (!wsTransport) {
      return;
    }

    session = hub.connectClient(parsed.roomType, parsed.roomId, wsTransport);
  });

  return hub;
}

/**
 * Create a standalone HTTP + WebSocket signaling server.
 */
export function createSignalingHttpServer(options = {}) {
  const hub = new SignalingRoomHub(options);

  const server = http.createServer((req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = req.url || "/";
    if (url === "/healthz" || url === "/" || url === "/__dmm_signal/healthz") {
      const stats = hub.getStats();
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      res.end(
        JSON.stringify({
          status: "ok",
          service: "dmm-webrtc-signaling",
          zeroKnowledge: true,
          ...stats,
        }),
      );
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
    res.end(
      JSON.stringify({
        error: "Not Found",
        expected: ["/ws/invite/:roomId", "/ws/topic/:roomId", "/healthz"],
      }),
    );
  });

  attachSignalingUpgradeHandler(server, { hub, onlyPrefixed: false });

  return { server, hub };
}

const isMainModule =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (isMainModule) {
  const port = Number.parseInt(process.env.PORT || "8787", 10);
  const host = process.env.HOST || "0.0.0.0";
  const { server } = createSignalingHttpServer();

  server.listen(port, host, () => {
    console.log(
      `[dmm-signaling] Zero-knowledge WebRTC signaling server listening on ws://${host}:${port}`,
    );
    console.log(
      `[dmm-signaling] Endpoints: ws://localhost:${port}/ws/invite/:roomId | ws://localhost:${port}/ws/topic/:topicId`,
    );
  });
}

