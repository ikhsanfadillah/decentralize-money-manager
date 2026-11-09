import * as React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import { App } from "./App";
import { ensurePersistentStorage, isTauriRuntime } from "./lib/platform";
import { applyTheme, getStoredTheme } from "./lib/utils";

applyTheme(getStoredTheme());

// Request persistent storage & register PWA Service Worker in web browser environment
if (typeof window !== "undefined" && !isTauriRuntime()) {
  void ensurePersistentStorage();

  if (import.meta.env.PROD && "serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker
        .register("/sw.js")
        .then((reg) => {
          // Automatically check for service worker updates
          reg.onupdatefound = () => {
            const installingWorker = reg.installing;
            if (installingWorker) {
              installingWorker.onstatechange = () => {
                if (
                  installingWorker.state === "installed" &&
                  navigator.serviceWorker.controller
                ) {
                  console.log("[PWA] Konten baru tersedia. Siap dimuat ulang.");
                }
              };
            }
          };
        })
        .catch((err) => {
          console.warn("[PWA] Registrasi service worker gagal:", err);
        });
    });
  } else if (import.meta.env.DEV && "serviceWorker" in navigator) {
    // In local development, unregister old service workers and clear cache
    // to prevent stale Vite module interception (e.g. platform.ts SyntaxError)
    navigator.serviceWorker.getRegistrations().then((registrations) => {
      for (const registration of registrations) {
        void registration.unregister();
      }
    });
    if ("caches" in window) {
      caches.keys().then((names) => {
        for (const name of names) {
          void caches.delete(name);
        }
      });
    }
  }
}

const rootEl = document.getElementById("root");
if (!rootEl) {
  throw new Error("Root element #root not found");
}

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

