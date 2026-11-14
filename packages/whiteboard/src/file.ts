// `.margaya-board` files, and the same JSON embedded in an exported PNG so
// the image can be dropped back onto a board and edited again.

import {
  type BoardElement,
  type BoardSettings,
  DEFAULT_BOARD_SETTINGS,
} from "./elements.js";
import { parseSettings, sanitizeElements } from "./validate.js";

export const BOARD_FILE_TYPE = "margaya-board";
export const BOARD_FILE_VERSION = 1;
export const BOARD_FILE_EXTENSION = ".margaya-board";
/** Keyword of the PNG text chunk that carries the board JSON. */
export const PNG_BOARD_KEYWORD = "margaya-board";

/**
 * Pictures a board file carries, by asset id, as `data:` URLs: an image
 * element only names its upload, which another board or server can't read.
 */
export type BoardFileImages = Record<string, string>;

/** A picture a board can hold, as a base64 `data:` URL. */
const IMAGE_DATA_URL =
  /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

export function serializeBoard(
  elements: readonly BoardElement[],
  settings: BoardSettings = DEFAULT_BOARD_SETTINGS,
  images: BoardFileImages = {},
): string {
  const live = elements.filter((element) => !element.deleted);
  const used = new Set(
    live.flatMap((element) =>
      element.type === "image" && element.assetId ? [element.assetId] : [],
    ),
  );
  const carried = Object.fromEntries(
    Object.entries(images).filter(
      ([assetId, url]) => used.has(assetId) && IMAGE_DATA_URL.test(url),
    ),
  );
  return JSON.stringify({
    type: BOARD_FILE_TYPE,
    version: BOARD_FILE_VERSION,
    elements: live,
    settings: {
      background: settings.background,
      gridSize: settings.gridSize,
      pattern: settings.pattern,
      patternSize: settings.patternSize,
    },
    ...(Object.keys(carried).length > 0 ? { images: carried } : {}),
  });
}

/** The valid pictures of a board file, for the image elements it has. */
function parseImages(
  raw: unknown,
  elements: readonly BoardElement[],
): BoardFileImages {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const used = new Set(
    elements.flatMap((element) =>
      element.type === "image" && element.assetId ? [element.assetId] : [],
    ),
  );
  const images: BoardFileImages = {};
  for (const [assetId, url] of Object.entries(raw)) {
    if (
      used.has(assetId) &&
      typeof url === "string" &&
      IMAGE_DATA_URL.test(url)
    )
      images[assetId] = url;
  }
  return images;
}

/** Reads a board file; every element and picture is validated. Null when it is not a board file. */
export function parseBoardFile(text: string): {
  elements: BoardElement[];
  settings: BoardSettings;
  images: BoardFileImages;
} | null {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof data !== "object" || data === null || Array.isArray(data))
    return null;
  const file = data as Record<string, unknown>;
  if (file.type !== BOARD_FILE_TYPE) return null;
  if (file.version !== BOARD_FILE_VERSION) return null;
  if (!Array.isArray(file.elements)) return null;
  const elements = sanitizeElements(file.elements).filter(
    (element) => !element.deleted,
  );
  return {
    elements,
    settings: parseSettings(file.settings),
    images: parseImages(file.images, elements),
  };
}

/* ------------------------------------------------------------------ */
/* PNG chunks                                                          */
/* ------------------------------------------------------------------ */

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

let crcTable: Uint32Array | null = null;

function crcTableFor(): Uint32Array {
  if (crcTable) return crcTable;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let value = n;
    for (let bit = 0; bit < 8; bit++) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[n] = value >>> 0;
  }
  crcTable = table;
  return table;
}

/** CRC-32 (the PNG / zlib polynomial) over the given byte ranges. */
export function crc32(...parts: Uint8Array[]): number {
  const table = crcTableFor();
  let crc = 0xffffffff;
  for (const part of parts) {
    for (let i = 0; i < part.length; i++) {
      crc = table[(crc ^ part[i]) & 0xff] ^ (crc >>> 8);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function hasPngSignature(png: Uint8Array): boolean {
  return (
    png.length >= PNG_SIGNATURE.length &&
    PNG_SIGNATURE.every((byte, i) => png[i] === byte)
  );
}

type Chunk = { type: string; start: number; end: number; data: Uint8Array };

function readUint32(bytes: Uint8Array, at: number): number {
  return (
    ((bytes[at] << 24) |
      (bytes[at + 1] << 16) |
      (bytes[at + 2] << 8) |
      bytes[at + 3]) >>>
    0
  );
}

function writeUint32(bytes: Uint8Array, at: number, value: number): void {
  bytes[at] = (value >>> 24) & 0xff;
  bytes[at + 1] = (value >>> 16) & 0xff;
  bytes[at + 2] = (value >>> 8) & 0xff;
  bytes[at + 3] = value & 0xff;
}

const asciiOf = (bytes: Uint8Array) => String.fromCharCode(...bytes);

/** Walks the chunks; null when the bytes are not a structurally sound PNG. */
function readChunks(png: Uint8Array): Chunk[] | null {
  if (!hasPngSignature(png)) return null;
  const chunks: Chunk[] = [];
  let at = PNG_SIGNATURE.length;
  while (at + 12 <= png.length) {
    const length = readUint32(png, at);
    const dataStart = at + 8;
    const dataEnd = dataStart + length;
    if (length > 0x7fffffff || dataEnd + 4 > png.length) return null;
    const type = asciiOf(png.subarray(at + 4, at + 8));
    chunks.push({
      type,
      start: at,
      end: dataEnd + 4,
      data: png.subarray(dataStart, dataEnd),
    });
    at = dataEnd + 4;
    if (type === "IEND") return chunks;
  }
  return null;
}

function chunkCrcMatches(png: Uint8Array, chunk: Chunk): boolean {
  const typeAndData = png.subarray(chunk.start + 4, chunk.end - 4);
  return crc32(typeAndData) === readUint32(png, chunk.end - 4);
}

function buildChunk(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(12 + data.length);
  writeUint32(chunk, 0, data.length);
  for (let i = 0; i < 4; i++) chunk[4 + i] = type.charCodeAt(i);
  chunk.set(data, 8);
  writeUint32(
    chunk,
    8 + data.length,
    crc32(chunk.subarray(4, 8 + data.length)),
  );
  return chunk;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** Keyword of a tEXt/iTXt chunk, or null. */
function keywordOf(chunk: Chunk): string | null {
  if (chunk.type !== "tEXt" && chunk.type !== "iTXt") return null;
  const end = chunk.data.indexOf(0);
  return end > 0 ? asciiOf(chunk.data.subarray(0, end)) : null;
}

/**
 * Returns a copy of the PNG with `json` stored in an uncompressed iTXt chunk
 * (UTF-8) just before IEND. An earlier board chunk is replaced. Throws when
 * the input is not a PNG.
 */
export function embedInPng(png: Uint8Array, json: string): Uint8Array {
  const chunks = readChunks(png);
  if (!chunks) throw new Error("Not a PNG image");
  const keyword = new TextEncoder().encode(PNG_BOARD_KEYWORD);
  const text = new TextEncoder().encode(json);
  // keyword, NUL, compression flag 0, method 0, empty language, NUL, empty translated keyword, NUL, text
  const data = new Uint8Array(keyword.length + 5 + text.length);
  data.set(keyword, 0);
  data.set(text, keyword.length + 5);
  const boardChunk = buildChunk("iTXt", data);

  const parts: Uint8Array[] = [png.subarray(0, PNG_SIGNATURE.length)];
  for (const chunk of chunks) {
    if (keywordOf(chunk) === PNG_BOARD_KEYWORD) continue;
    if (chunk.type === "IEND") parts.push(boardChunk);
    parts.push(png.subarray(chunk.start, chunk.end));
  }
  return concat(parts);
}

/**
 * The board JSON stored in a PNG by `embedInPng` (or a plain tEXt chunk with
 * the same keyword), or null. Compressed text is not supported.
 */
export function extractFromPng(png: Uint8Array): string | null {
  const chunks = readChunks(png);
  if (!chunks) return null;
  for (const chunk of chunks) {
    if (keywordOf(chunk) !== PNG_BOARD_KEYWORD) continue;
    if (!chunkCrcMatches(png, chunk)) continue;
    const data = chunk.data;
    const afterKeyword = PNG_BOARD_KEYWORD.length + 1;
    if (chunk.type === "tEXt") {
      // tEXt is Latin-1.
      let text = "";
      for (let i = afterKeyword; i < data.length; i++) {
        text += String.fromCharCode(data[i]);
      }
      return text;
    }
    const compressed = data[afterKeyword];
    if (compressed !== 0) continue;
    const languageEnd = data.indexOf(0, afterKeyword + 2);
    if (languageEnd < 0) continue;
    const translatedEnd = data.indexOf(0, languageEnd + 1);
    if (translatedEnd < 0) continue;
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(
        data.subarray(translatedEnd + 1),
      );
    } catch {
      return null;
    }
  }
  return null;
}
