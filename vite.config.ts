import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import process from "node:process";
import type http from "node:http";
import { attachSignalingUpgradeHandler } from "./signaling-server/server.mjs";

const host = process.env.TAURI_DEV_HOST;

function dmmSignalingServerPlugin(): Plugin {
  return {
    name: "dmm-webrtc-signaling",
    configureServer(server) {
      if (!server.httpServer) return;
      const hub = attachSignalingUpgradeHandler(server.httpServer as unknown as http.Server, {
        onlyPrefixed: true,
      });
      server.middlewares.use("/__dmm_signal/healthz", (_req, res) => {
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(
          JSON.stringify({
            status: "ok",
            service: "dmm-vite-signaling",
            zeroKnowledge: true,
            ...hub.getStats(),
          }),
        );
      });
    },
    configurePreviewServer(server) {
      if (!server.httpServer) return;
      const hub = attachSignalingUpgradeHandler(server.httpServer as unknown as http.Server, {
        onlyPrefixed: true,
      });
      server.middlewares.use("/__dmm_signal/healthz", (_req, res) => {
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(
          JSON.stringify({
            status: "ok",
            service: "dmm-vite-preview-signaling",
            zeroKnowledge: true,
            ...hub.getStats(),
          }),
        );
      });
    },
  };
}

export default defineConfig(() => ({
  plugins: [
    dmmSignalingServerPlugin(),
    tanstackRouter({
      target: "react",
      autoCodeSplitting: false,
      routesDirectory: "./src/routes",
      generatedRouteTree: "./src/routeTree.gen.ts",
    }),
    react(),
    tailwindcss(),
  ],
  clearScreen: false,
  optimizeDeps: {
    exclude: ["@sqlite.org/sqlite-wasm"],
  },
  worker: {
    format: "es",
  },
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  preview: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
  },
}));
