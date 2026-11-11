import type { ImageAttachmentPayload } from "./types";

/**
 * Compresses an image file in the browser canvas and returns a base64 JPEG data URL.
 */
export async function compressImageFileToDataUrl(
  file: File,
  maxDim = 1280,
  quality = 0.82
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Gagal membaca file gambar."));
    reader.onload = () => {
      const resultStr = String(reader.result ?? "");
      if (typeof Image === "undefined") {
        resolve(resultStr);
        return;
      }
      const img = new Image();
      img.onerror = () => resolve(resultStr);
      img.onload = () => {
        try {
          let { width, height } = img;
          if (width > maxDim || height > maxDim) {
            if (width >= height) {
              height = Math.round((height * maxDim) / width);
              width = maxDim;
            } else {
              width = Math.round((width * maxDim) / height);
              height = maxDim;
            }
          }
          const canvas = document.createElement("canvas");
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          if (!ctx) {
            resolve(resultStr);
            return;
          }
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL("image/jpeg", quality));
        } catch {
          resolve(resultStr);
        }
      };
      img.src = resultStr;
    };
    reader.readAsDataURL(file);
  });
}

export function parseDataUrlToImagePayload(
  dataUrl: string
): ImageAttachmentPayload | null {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(
    dataUrl.trim()
  );
  if (!match) return null;
  return {
    mimeType: match[1],
    base64Data: match[2],
    dataUrl: dataUrl.trim(),
  };
}

