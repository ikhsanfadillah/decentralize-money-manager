import { TauriCommandError } from "./tauri-api";
import { ensurePersistentStorage } from "./platform";
import type {
  WorkerMessageToMain,
  WorkerRequestMessage,
  WorkerResponseMessage,
} from "../web-worker/db.worker";
import type { CrdtOp } from "../web-worker/crdt-merge";
import { getWebSyncEngine } from "./web-sync-engine";

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

let workerInstance: Worker | null = null;
let workerFailed = false;
let requestCounter = 0;
const pendingRequests = new Map<number, PendingRequest>();

let fallbackEnginePromise: Promise<
  import("../web-worker/sqlite-engine").WebSqliteEngine
> | null = null;
let fallbackQueue: Promise<unknown> = Promise.resolve();

function isTestJsdomEnv(): boolean {
  return (
    typeof navigator !== "undefined" &&
    typeof navigator.userAgent === "string" &&
    navigator.userAgent.toLowerCase().includes("jsdom")
  );
}

function getOrCreateWorker(): Worker | null {
  if (workerFailed || typeof Worker === "undefined" || isTestJsdomEnv()) {
    return null;
  }
  if (workerInstance) {
    return workerInstance;
  }
  try {
    const w = new Worker(
      new URL("../web-worker/db.worker.ts", import.meta.url),
      { type: "module" }
    );
    w.onmessage = (event: MessageEvent<WorkerMessageToMain>) => {
      const data = event.data;
      if ("type" in data && data.type === "crdt_op_created") {
        void getWebSyncEngine().broadcastLocalOp(data.bookId, data.op as CrdtOp);
        return;
      }

      const msg = data as WorkerResponseMessage;
      const pending = pendingRequests.get(msg.id);
      if (!pending) return;
      pendingRequests.delete(msg.id);

      if (msg.ok) {
        pending.resolve(msg.result);
      } else {
        pending.reject(
          new TauriCommandError(
            msg.error?.code ?? "UNKNOWN_ERROR",
            msg.error?.message ?? "Unknown worker error"
          )
        );
      }
    };
    w.onerror = () => {
      workerFailed = true;
      workerInstance = null;
      for (const [id, pending] of pendingRequests.entries()) {
        pendingRequests.delete(id);
        pending.reject(
          new TauriCommandError(
            "WORKER_ERROR",
            "Web Worker initialization failed"
          )
        );
      }
    };
    workerInstance = w;
    return w;
  } catch {
    workerFailed = true;
    return null;
  }
}

async function dispatchFallback(
  cmd: string,
  args?: Record<string, unknown>
): Promise<unknown> {
  if (!fallbackEnginePromise) {
    fallbackEnginePromise = import("../web-worker/sqlite-engine").then(
      async (m) => {
        const eng = new m.WebSqliteEngine();
        eng.onLocalOpCreated = (bookId, op) => {
          void getWebSyncEngine().broadcastLocalOp(bookId, op);
        };
        await eng.init();
        return eng;
      }
    );
  }

  const run = async () => {
    const engine = await fallbackEnginePromise!;
    return engine.dispatch(cmd, args ?? {});
  };

  const next = fallbackQueue.then(run, run);
  fallbackQueue = next.catch(() => {});
  return next;
}

function triggerBrowserFileDownload(
  bytes: Uint8Array,
  rawPathOrFilename: string
): string {
  const sanitized =
    rawPathOrFilename
      .trim()
      .split(/[/\\]/)
      .pop() || "backup.fmm.enc";
  const filename = sanitized.endsWith(".enc")
    ? sanitized
    : `${sanitized}.fmm.enc`;

  if (typeof document !== "undefined" && typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
    const blob = new Blob([bytes.buffer as ArrayBuffer], {
      type: "application/octet-stream",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  return filename;
}

export async function callWebWorkerCommand<T>(
  cmd: string,
  args?: Record<string, unknown>
): Promise<T> {
  void ensurePersistentStorage();

  if (cmd === "export_book_encrypted") {
    const bookId = String(args?.bookId ?? args?.book_id ?? "");
    const passphrase = String(args?.passphrase ?? "");
    const destinationPath = String(
      args?.destinationPath ?? args?.destination_path ?? "backup.fmm.enc"
    );
    const encryptedBytes = await callWebWorkerCommand<Uint8Array>(
      "export_book_encrypted_bytes",
      { bookId, passphrase }
    );
    const downloadedName = triggerBrowserFileDownload(
      encryptedBytes,
      destinationPath
    );
    return downloadedName as unknown as T;
  }

  const worker = getOrCreateWorker();
  if (worker) {
    const id = ++requestCounter;
    return new Promise<T>((resolve, reject) => {
      pendingRequests.set(id, {
        resolve: resolve as (val: unknown) => void,
        reject,
      });
      const req: WorkerRequestMessage = { id, cmd, args };
      worker.postMessage(req);
    });
  }

  return (await dispatchFallback(cmd, args)) as T;
}

