import {
  createWhiteboardAssetUpload,
  type FinalizeWhiteboardAssetInput,
  finalizeWhiteboardAsset,
} from "@/fetchers/whiteboard/whiteboard-assets";

/** The image types a board accepts (the API checks the bytes too). */
export const WHITEBOARD_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
] as const;

type WhiteboardImageType = FinalizeWhiteboardAssetInput["contentType"];

export class UnsupportedWhiteboardImageError extends Error {
  constructor() {
    super("Only PNG, JPEG, GIF and WebP images can go on a board.");
    this.name = "UnsupportedWhiteboardImageError";
  }
}

export function isWhiteboardImageType(
  value: string,
): value is WhiteboardImageType {
  return (WHITEBOARD_IMAGE_TYPES as readonly string[]).includes(value);
}

export type ImageSize = { width: number; height: number };

/** The image's pixel size, read by the browser; null when it can't decode. */
export async function readImageSize(file: Blob): Promise<ImageSize | null> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);
      const size = { width: bitmap.width, height: bitmap.height };
      bitmap.close();
      return size;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Puts an image on a board: ask for an upload, PUT the bytes to storage,
 * then finalize. The size the API reads from the file wins over the
 * browser's.
 */
export async function uploadWhiteboardImage(
  whiteboardId: string,
  file: File,
  {
    fetchImpl = fetch,
    measure = readImageSize,
  }: {
    fetchImpl?: typeof fetch;
    measure?: (file: Blob) => Promise<ImageSize | null>;
  } = {},
): Promise<{ assetId: string; width: number; height: number }> {
  const contentType = file.type;
  if (file.size <= 0 || !isWhiteboardImageType(contentType)) {
    throw new UnsupportedWhiteboardImageError();
  }
  const measured = await measure(file);
  const { assetId, upload } = await createWhiteboardAssetUpload(whiteboardId, {
    filename: file.name || "image",
    contentType,
    size: file.size,
  });
  // A presigned storage URL, as for page files, not a typed client route:
  // the client would add JSON headers.
  const response = await fetchImpl(upload.uploadUrl, {
    method: "PUT",
    headers: upload.headers,
    body: file,
  });
  if (!response.ok) {
    throw new Error("Failed to upload the image to storage.");
  }
  const asset = await finalizeWhiteboardAsset(whiteboardId, assetId, {
    contentType,
    size: file.size,
    ...(measured
      ? {
          width: Math.round(measured.width),
          height: Math.round(measured.height),
        }
      : {}),
  });
  return {
    assetId,
    width: asset.width ?? measured?.width ?? 0,
    height: asset.height ?? measured?.height ?? 0,
  };
}
