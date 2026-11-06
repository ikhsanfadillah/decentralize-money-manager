/**
 * Platform runtime detection utilities.
 * Determines whether the app is executing inside the native Tauri v2 shell
 * or inside a standard web browser / PWA environment.
 */
export function isTauriRuntime(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const win = window as unknown as Record<string, unknown>;
  return Boolean(win.__TAURI_INTERNALS__ || win.__TAURI__);
}

let persistentStoragePromise: Promise<boolean> | null = null;

/**
 * Requests persistent storage from the browser (StorageManager.persist) so
 * OPFS / IndexedDB / Cache API data is protected from automatic eviction
 * under storage pressure (especially important on iOS Safari / WebKit).
 */
export function ensurePersistentStorage(): Promise<boolean> {
  if (isTauriRuntime()) {
    return Promise.resolve(true);
  }
  if (persistentStoragePromise) {
    return persistentStoragePromise;
  }

  persistentStoragePromise = (async () => {
    try {
      if (
        typeof navigator === "undefined" ||
        !navigator.storage ||
        typeof navigator.storage.persisted !== "function"
      ) {
        return false;
      }

      const alreadyPersisted = await navigator.storage.persisted();
      if (alreadyPersisted) {
        return true;
      }

      if (typeof navigator.storage.persist === "function") {
        return await navigator.storage.persist();
      }
      return false;
    } catch {
      return false;
    }
  })();

  return persistentStoragePromise;
}


