// Identifies a board image by its leading bytes and reads its pixel size.
// Only PNG, JPEG, GIF and WebP pass; SVG and everything else are refused
// whatever their declared type, since a script-capable format must never be
// served from a board.

export const BOARD_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
] as const;
export type BoardImageType = (typeof BOARD_IMAGE_TYPES)[number];

/** Bytes read from the start of an upload to identify it and find its size. */
export const IMAGE_HEAD_BYTES = 256 * 1024;

function startsWith(bytes: Uint8Array, signature: readonly number[], at = 0) {
  if (bytes.length < at + signature.length) return false;
  return signature.every((value, index) => bytes[at + index] === value);
}

function ascii(bytes: Uint8Array, at: number, text: string) {
  return startsWith(
    bytes,
    [...text].map((char) => char.charCodeAt(0)),
    at,
  );
}

/** The image type the bytes really are, or null when they are none of the four. */
export function sniffImageType(bytes: Uint8Array): BoardImageType | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return "image/png";
  }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (ascii(bytes, 0, "GIF87a") || ascii(bytes, 0, "GIF89a")) {
    return "image/gif";
  }
  if (ascii(bytes, 0, "RIFF") && ascii(bytes, 8, "WEBP")) return "image/webp";
  return null;
}

export type PixelSize = { width: number; height: number };

function u16be(bytes: Uint8Array, at: number) {
  return ((bytes[at] ?? 0) << 8) | (bytes[at + 1] ?? 0);
}

function u16le(bytes: Uint8Array, at: number) {
  return (bytes[at] ?? 0) | ((bytes[at + 1] ?? 0) << 8);
}

function u24le(bytes: Uint8Array, at: number) {
  return u16le(bytes, at) | ((bytes[at + 2] ?? 0) << 16);
}

function u32be(bytes: Uint8Array, at: number) {
  return (
    (((bytes[at] ?? 0) << 24) |
      ((bytes[at + 1] ?? 0) << 16) |
      ((bytes[at + 2] ?? 0) << 8) |
      (bytes[at + 3] ?? 0)) >>>
    0
  );
}

function jpegSize(bytes: Uint8Array): PixelSize | null {
  let at = 2;
  while (at + 9 < bytes.length) {
    if (bytes[at] !== 0xff) return null;
    const marker = bytes[at + 1] ?? 0;
    // Fill bytes and markers without a length.
    if (marker === 0xff) {
      at++;
      continue;
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2;
      continue;
    }
    const length = u16be(bytes, at + 2);
    if (length < 2) return null;
    // Start-of-frame markers, except DHT (c4), JPG (c8) and DAC (cc).
    const isFrame =
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc;
    if (isFrame) {
      return { height: u16be(bytes, at + 5), width: u16be(bytes, at + 7) };
    }
    at += 2 + length;
  }
  return null;
}

function webpSize(bytes: Uint8Array): PixelSize | null {
  if (ascii(bytes, 12, "VP8X") && bytes.length >= 30) {
    return { width: u24le(bytes, 24) + 1, height: u24le(bytes, 27) + 1 };
  }
  if (ascii(bytes, 12, "VP8 ") && bytes.length >= 30) {
    return {
      width: u16le(bytes, 26) & 0x3fff,
      height: u16le(bytes, 28) & 0x3fff,
    };
  }
  if (ascii(bytes, 12, "VP8L") && bytes.length >= 25) {
    const b0 = bytes[21] ?? 0;
    const b1 = bytes[22] ?? 0;
    const b2 = bytes[23] ?? 0;
    const b3 = bytes[24] ?? 0;
    return {
      width: 1 + (((b1 & 0x3f) << 8) | b0),
      height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)),
    };
  }
  return null;
}

/** The pixel size from the header, or null when it can't be read. */
export function imagePixelSize(
  bytes: Uint8Array,
  type: BoardImageType,
): PixelSize | null {
  let size: PixelSize | null = null;
  if (type === "image/png" && ascii(bytes, 12, "IHDR")) {
    size = { width: u32be(bytes, 16), height: u32be(bytes, 20) };
  } else if (type === "image/gif" && bytes.length >= 10) {
    size = { width: u16le(bytes, 6), height: u16le(bytes, 8) };
  } else if (type === "image/jpeg") {
    size = jpegSize(bytes);
  } else if (type === "image/webp") {
    size = webpSize(bytes);
  }
  if (!size || size.width <= 0 || size.height <= 0) return null;
  if (size.width > 1_000_000 || size.height > 1_000_000) return null;
  return size;
}
