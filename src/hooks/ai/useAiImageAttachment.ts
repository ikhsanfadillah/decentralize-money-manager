import * as React from "react";
import { compressImageFileToDataUrl } from "../../lib/ai-provider";
import { pushToast } from "../../lib/toast";

export interface AttachedAiImage {
  dataUrl: string;
  fileName: string;
}

export interface UseAiImageAttachmentOptions {
  invalidTypeTitle?: string;
  invalidTypeDescription?: string;
  errorTitle?: string;
}

export function useAiImageAttachment(options?: UseAiImageAttachmentOptions) {
  const [attachedImage, setAttachedImage] =
    React.useState<AttachedAiImage | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  const handleFileChange = React.useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      if (!file.type.startsWith("image/")) {
        pushToast(
          options?.invalidTypeTitle ?? "Pilih file gambar",
          options?.invalidTypeDescription
            ? {
                description: options.invalidTypeDescription,
                variant: "warning",
              }
            : { variant: "warning" }
        );
        return;
      }

      try {
        const dataUrl = await compressImageFileToDataUrl(file);
        setAttachedImage({
          dataUrl,
          fileName: file.name,
        });
      } catch (err: unknown) {
        const fallbackMsg =
          err instanceof Error ? err.message : "Gagal memproses gambar";
        if (options?.errorTitle) {
          pushToast(options.errorTitle, {
            description:
              err instanceof Error ? err.message : "Coba pilih file lain.",
            variant: "error",
          });
        } else {
          pushToast(fallbackMsg, { variant: "error" });
        }
      } finally {
        e.target.value = "";
      }
    },
    [
      options?.errorTitle,
      options?.invalidTypeDescription,
      options?.invalidTypeTitle,
    ]
  );

  const clearAttachment = React.useCallback(() => {
    setAttachedImage(null);
  }, []);

  const openFilePicker = React.useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  return {
    attachedImage,
    setAttachedImage,
    fileInputRef,
    handleFileChange,
    clearAttachment,
    openFilePicker,
  };
}

