import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface AppEvent<T> {
  payload: T;
}

export type AppEventHandler<T> = (event: AppEvent<T>) => void;

export const EVENT_CRDT_SYNCED = "crdt:synced";
export const EVENT_SYNC_STATUS = "sync:status";

const webEventBus = new EventTarget();

/**
 * Emits an application-wide event (`crdt:synced`, `sync:status`, etc.)
 * on the browser event bus so React hooks receive real-time updates in Web mode.
 */
export function emitAppEvent<T>(eventName: string, payload: T): void {
  webEventBus.dispatchEvent(
    new CustomEvent<T>(eventName, {
      detail: payload,
    })
  );
}

/**
 * Subscribes to application events (`crdt:synced`, `sync:status`) across both
 * Tauri Desktop/Mobile IPC and Web Browser mode.
 */
export async function listenAppEvent<T>(
  eventName: string,
  handler: AppEventHandler<T>
): Promise<UnlistenFn> {
  const domListener = (evt: Event) => {
    const customEvt = evt as CustomEvent<T>;
    handler({ payload: customEvt.detail });
  };

  webEventBus.addEventListener(eventName, domListener);

  let tauriUnlisten: UnlistenFn | null = null;
  try {
    tauriUnlisten = await listen<T>(eventName, (event) => {
      handler({ payload: event.payload });
    });
  } catch {
    // Ignore when running in a standard web browser or non-Tauri test environment
  }

  return () => {
    webEventBus.removeEventListener(eventName, domListener);
    if (tauriUnlisten) {
      tauriUnlisten();
    }
  };
}

