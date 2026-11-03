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

