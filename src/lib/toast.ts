export type ToastVariant = "info" | "success" | "warning" | "error";

export interface ToastItem {
  id: string;
  title: string;
  description?: string;
  variant: ToastVariant;
}

type ToastListener = (toasts: ToastItem[]) => void;

let currentToasts: ToastItem[] = [];
const listeners = new Set<ToastListener>();

function notify(): void {
  const snapshot = [...currentToasts];
  for (const listener of listeners) {
    listener(snapshot);
  }
}

export function pushToast(
  title: string,
  options?: { description?: string; variant?: ToastVariant; durationMs?: number }
): string {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const item: ToastItem = {
    id,
    title,
    description: options?.description,
    variant: options?.variant ?? "info",
  };
  currentToasts = [...currentToasts, item];
  notify();

  const duration = options?.durationMs ?? 4500;
  if (duration > 0 && typeof window !== "undefined") {
    window.setTimeout(() => {
      dismissToast(id);
    }, duration);
  }
  return id;
}

export function dismissToast(id: string): void {
  currentToasts = currentToasts.filter((t) => t.id !== id);
  notify();
}

export function subscribeToasts(listener: ToastListener): () => void {
  listeners.add(listener);
  listener([...currentToasts]);
  return () => {
    listeners.delete(listener);
  };
}

