import { toast, type ExternalToast } from "sonner";

export type ToastVariant = "info" | "success" | "warning" | "error";

export interface ToastOptions {
  description?: string;
  variant?: ToastVariant;
  durationMs?: number;
}

export function pushToast(
  title: string,
  options?: ToastOptions
): string | number {
  const variant = options?.variant ?? "info";
  const data: ExternalToast = {
    description: options?.description,
    duration: options?.durationMs ?? 4500,
  };

  switch (variant) {
    case "success":
      return toast.success(title, data);
    case "error":
      return toast.error(title, data);
    case "warning":
      return toast.warning(title, data);
    case "info":
    default:
      return toast.info(title, data);
  }
}

export function dismissToast(id?: string | number): void {
  toast.dismiss(id);
}

export { toast };
