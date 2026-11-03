import { TauriCommandError } from "../lib/tauri-api";
import { WebSqliteEngine } from "./sqlite-engine";

export interface WorkerRequestMessage {
  id: number;
  cmd: string;
  args?: Record<string, unknown>;
}

export interface WorkerResponseMessage {
  id: number;
  ok: boolean;
  result?: unknown;
  error?: {
    code: string;
    message: string;
  };
}

export type WorkerMessageToMain =
  | WorkerResponseMessage
  | {
      type: "crdt_op_created";
      bookId: string;
      op: unknown;
    };

const engine = new WebSqliteEngine();
engine.onLocalOpCreated = (bookId, op) => {
  self.postMessage({
    type: "crdt_op_created",
    bookId,
    op,
  });
};
let executionQueue: Promise<void> = Promise.resolve();

self.onmessage = (event: MessageEvent<WorkerRequestMessage>) => {
  const { id, cmd, args } = event.data;

  executionQueue = executionQueue.then(async () => {
    try {
      const result = await engine.dispatch(cmd, args ?? {});
      const response: WorkerResponseMessage = {
        id,
        ok: true,
        result,
      };
      self.postMessage(response);
    } catch (err: unknown) {
      const code =
        err instanceof TauriCommandError ? err.code : "UNKNOWN_ERROR";
      const message =
        err instanceof Error ? err.message : String(err);
      const response: WorkerResponseMessage = {
        id,
        ok: false,
        error: { code, message },
      };
      self.postMessage(response);
    }
  });
};

