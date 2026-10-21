import { HTTPException } from "hono/http-exception";
import { CHAT_IMAGE_TYPES, type ChatImageType } from "../ai/types";

// Images sent to the capture route: checked by their bytes (not the declared
// type alone), bounded in size, and stripped of metadata (EXIF, XMP, IPTC,
// text chunks) before any model sees them. Camera photos carry GPS position,
// device serials and timestamps; none of that belongs in a model call.

export const CAPTURE_IMAGE_TYPES = CHAT_IMAGE_TYPES;
export type CaptureImageType = ChatImageType;

/** Screenshots or recording frames per request. */
export const MAX_CAPTURE_IMAGES = 6;
/** Decoded bytes per image; keeps the base64 under providers' 5 MB cap. */
export const MAX_CAPTURE_IMAGE_BYTES = 3_750_000;
/** Decoded bytes of all images together. */
export const MAX_CAPTURE_TOTAL_BYTES = 9_000_000;
/** Base64 length of the largest image. */
export const MAX_CAPTURE_IMAGE_BASE64 =
  Math.ceil(MAX_CAPTURE_IMAGE_BYTES / 3) * 4;

export class InvalidCaptureImageError extends Error {}

/** The image type the bytes really are, or null for anything else. */
export function sniffImageType(bytes: Uint8Array): CaptureImageType | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 12 &&
    ascii(bytes, 0, 4) === "RIFF" &&
    ascii(bytes, 8, 4) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

function ascii(bytes: Uint8Array, start: number, length: number): string {
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

// JPEG markers kept before the scan: JFIF (APP0), ICC colour (APP2), Adobe
// colour transform (APP14). Every other APPn and comments are dropped: APP1
// holds EXIF and XMP, APP13 IPTC, the rest vendor data.
const KEPT_JPEG_APP = new Set([0xe0, 0xe2, 0xee]);

function stripJpeg(bytes: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [bytes.subarray(0, 2)];
  let i = 2;
  while (i < bytes.length) {
    if (bytes[i] !== 0xff) {
      throw new InvalidCaptureImageError("Malformed JPEG");
    }
    // Fill bytes may pad a marker.
    let markerAt = i;
    while (bytes[markerAt + 1] === 0xff) markerAt += 1;
    const marker = bytes[markerAt + 1];
    if (marker === undefined)
      throw new InvalidCaptureImageError("Malformed JPEG");
    if (marker === 0xd9) {
      parts.push(bytes.subarray(markerAt, markerAt + 2));
      return concat(parts);
    }
    // Standalone markers carry no length.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      parts.push(bytes.subarray(markerAt, markerAt + 2));
      i = markerAt + 2;
      continue;
    }
    const high = bytes[markerAt + 2];
    const low = bytes[markerAt + 3];
    if (high === undefined || low === undefined) {
      throw new InvalidCaptureImageError("Malformed JPEG");
    }
    const length = (high << 8) | low;
    const end = markerAt + 2 + length;
    if (length < 2 || end > bytes.length) {
      throw new InvalidCaptureImageError("Malformed JPEG");
    }
    if (marker === 0xda) {
      // Start of scan: the entropy-coded data and the rest are image data.
      parts.push(bytes.subarray(markerAt));
      return concat(parts);
    }
    const isApp = marker >= 0xe0 && marker <= 0xef;
    const drop = marker === 0xfe || (isApp && !KEPT_JPEG_APP.has(marker));
    if (!drop) parts.push(bytes.subarray(markerAt, end));
    i = end;
  }
  throw new InvalidCaptureImageError("Malformed JPEG");
}

// PNG chunks that carry metadata: EXIF, text (often software, author or
// comments), and the modification time.
const DROPPED_PNG_CHUNKS = new Set(["eXIf", "tEXt", "zTXt", "iTXt", "tIME"]);

function stripPng(bytes: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [bytes.subarray(0, 8)];
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let i = 8;
  while (i + 12 <= bytes.length) {
    const length = view.getUint32(i);
    const type = ascii(bytes, i + 4, 4);
    const end = i + 12 + length;
    if (end > bytes.length) throw new InvalidCaptureImageError("Malformed PNG");
    if (!DROPPED_PNG_CHUNKS.has(type)) parts.push(bytes.subarray(i, end));
    i = end;
    if (type === "IEND") return concat(parts);
  }
  throw new InvalidCaptureImageError("Malformed PNG");
}

const VP8X_EXIF_FLAG = 0x08;
const VP8X_XMP_FLAG = 0x04;

function stripWebp(bytes: Uint8Array): Uint8Array {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const riffEnd = Math.min(bytes.length, 8 + view.getUint32(4, true));
  const chunks: Uint8Array[] = [];
  let i = 12;
  while (i + 8 <= riffEnd) {
    const type = ascii(bytes, i, 4);
    const size = view.getUint32(i + 4, true);
    const end = i + 8 + size + (size % 2);
    if (i + 8 + size > riffEnd) {
      throw new InvalidCaptureImageError("Malformed WebP");
    }
    if (type !== "EXIF" && type !== "XMP ") {
      const chunk = bytes.slice(i, Math.min(end, riffEnd));
      if (type === "VP8X" && chunk.length > 8) {
        chunk[8] = (chunk[8] ?? 0) & ~(VP8X_EXIF_FLAG | VP8X_XMP_FLAG);
      }
      chunks.push(chunk);
    }
    i = end;
  }
  if (chunks.length === 0) throw new InvalidCaptureImageError("Malformed WebP");
  const body = concat(chunks);
  const header = new Uint8Array(12);
  header.set(bytes.subarray(0, 4), 0);
  new DataView(header.buffer).setUint32(4, 4 + body.length, true);
  header.set(bytes.subarray(8, 12), 8);
  return concat([header, body]);
}

/** The image without metadata; the pixels are untouched. */
export function stripImageMetadata(
  bytes: Uint8Array,
  type: CaptureImageType,
): Uint8Array {
  if (type === "image/png") return stripPng(bytes);
  if (type === "image/jpeg") return stripJpeg(bytes);
  return stripWebp(bytes);
}

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

export type CaptureImage = {
  mediaType: CaptureImageType;
  /** Base64 of the stripped bytes. */
  data: string;
  bytes: number;
};

/**
 * Decodes, checks and strips the request's images. 400 for a bad image (its
 * bytes aren't the declared type, or it can't be parsed), 413 for too many
 * or too large.
 */
export function prepareCaptureImages(
  images: readonly { mediaType: string; data: string }[],
): CaptureImage[] {
  if (images.length > MAX_CAPTURE_IMAGES) {
    throw new HTTPException(413, {
      message: `At most ${MAX_CAPTURE_IMAGES} images per capture`,
    });
  }
  let total = 0;
  return images.map((image, index) => {
    const label = `Image ${index + 1}`;
    const declared = image.mediaType.toLowerCase();
    if (!(CAPTURE_IMAGE_TYPES as readonly string[]).includes(declared)) {
      throw new HTTPException(400, {
        message: `${label}: only PNG, JPEG and WebP images are accepted`,
      });
    }
    const data = image.data.replace(/^data:[^,]*,/, "").replace(/\s+/g, "");
    if (!data || !BASE64.test(data)) {
      throw new HTTPException(400, { message: `${label} is not valid base64` });
    }
    const raw = new Uint8Array(Buffer.from(data, "base64"));
    if (raw.length > MAX_CAPTURE_IMAGE_BYTES) {
      throw new HTTPException(413, {
        message: `${label} is larger than ${Math.floor(MAX_CAPTURE_IMAGE_BYTES / 1_000_000)} MB`,
      });
    }
    total += raw.length;
    if (total > MAX_CAPTURE_TOTAL_BYTES) {
      throw new HTTPException(413, {
        message: `The images are larger than ${MAX_CAPTURE_TOTAL_BYTES / 1_000_000} MB together`,
      });
    }
    const actual = sniffImageType(raw);
    if (actual !== declared) {
      throw new HTTPException(400, {
        message: `${label} is not a ${declared.replace("image/", "").toUpperCase()} image`,
      });
    }
    let stripped: Uint8Array;
    try {
      stripped = stripImageMetadata(raw, actual);
    } catch (error) {
      if (error instanceof InvalidCaptureImageError) {
        throw new HTTPException(400, { message: `${label} could not be read` });
      }
      throw error;
    }
    return {
      mediaType: actual,
      data: Buffer.from(stripped).toString("base64"),
      bytes: stripped.length,
    };
  });
}
