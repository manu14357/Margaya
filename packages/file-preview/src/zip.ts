import { ZIP_LIMITS } from "./limits";

// Reads a ZIP's central directory without inflating anything, then inflates
// single entries on demand. Every size used for a decision comes from the
// directory and is checked before any work: entry count, per-entry size,
// expansion ratio and the bytes extracted so far. Inflation writes into a
// buffer of the declared size, so an entry that lies about its size is cut
// off there rather than allowed to grow.

export type ZipEntry = {
  /** Full path inside the archive, "/"-separated. */
  path: string;
  /** Last path segment. */
  name: string;
  directory: boolean;
  compressedSize: number;
  size: number;
  modified: Date | null;
  encrypted: boolean;
  method: number;
  localHeaderOffset: number;
};

export class ZipError extends Error {
  readonly reason:
    | "invalid"
    | "too-many"
    | "too-large"
    | "ratio"
    | "budget"
    | "encrypted"
    | "unsupported";
  constructor(reason: ZipError["reason"], message: string) {
    super(message);
    this.name = "ZipError";
    this.reason = reason;
  }
}

export type ZipLimits = typeof ZIP_LIMITS;

const EOCD = 0x06054b50;
const EOCD64_LOCATOR = 0x07064b50;
const EOCD64 = 0x06064b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

function dosDate(date: number, time: number): Date | null {
  const year = ((date >> 9) & 0x7f) + 1980;
  const month = (date >> 5) & 0x0f;
  const day = date & 0x1f;
  if (!month || !day) return null;
  return new Date(
    year,
    month - 1,
    day,
    (time >> 11) & 0x1f,
    (time >> 5) & 0x3f,
    (time & 0x1f) * 2,
  );
}

function findEndOfDirectory(view: DataView): number {
  // The record is 22 bytes plus a comment of at most 65,535.
  const stop = Math.max(0, view.byteLength - 22 - 0xffff);
  for (let offset = view.byteLength - 22; offset >= stop; offset -= 1) {
    if (view.getUint32(offset, true) === EOCD) return offset;
  }
  return -1;
}

const utf8 = new TextDecoder("utf-8");

/** The archive's entries, in directory order. */
export function listZip(
  bytes: Uint8Array,
  limits: Pick<ZipLimits, "maxEntries"> = ZIP_LIMITS,
): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.byteLength < 22) throw new ZipError("invalid", "Not a ZIP file.");
  const end = findEndOfDirectory(view);
  if (end < 0) throw new ZipError("invalid", "No ZIP directory found.");

  let count = view.getUint16(end + 10, true);
  let directoryOffset = view.getUint32(end + 16, true);
  // ZIP64: the real numbers live in a second record the locator points at.
  if (
    (count === 0xffff || directoryOffset === 0xffffffff) &&
    end >= 20 &&
    view.getUint32(end - 20, true) === EOCD64_LOCATOR
  ) {
    const record = Number(view.getBigUint64(end - 20 + 8, true));
    if (
      record + 56 <= bytes.byteLength &&
      view.getUint32(record, true) === EOCD64
    ) {
      count = Number(view.getBigUint64(record + 32, true));
      directoryOffset = Number(view.getBigUint64(record + 48, true));
    }
  }
  if (count > limits.maxEntries) {
    throw new ZipError("too-many", `The archive lists ${count} entries.`);
  }

  const entries: ZipEntry[] = [];
  let offset = directoryOffset;
  for (let index = 0; index < count; index += 1) {
    if (
      offset + 46 > bytes.byteLength ||
      view.getUint32(offset, true) !== CENTRAL
    ) {
      throw new ZipError("invalid", "The ZIP directory is damaged.");
    }
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const time = view.getUint16(offset + 12, true);
    const date = view.getUint16(offset + 14, true);
    let compressedSize = view.getUint32(offset + 20, true);
    let size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    let localHeaderOffset = view.getUint32(offset + 42, true);
    const nameStart = offset + 46;
    if (nameStart + nameLength + extraLength > bytes.byteLength) {
      throw new ZipError("invalid", "The ZIP directory is damaged.");
    }
    const path = utf8.decode(bytes.subarray(nameStart, nameStart + nameLength));

    // ZIP64 extra field: the 64-bit values, in this order, for each field
    // that was set to 0xffffffff above.
    let extra = nameStart + nameLength;
    const extraEnd = extra + extraLength;
    while (extra + 4 <= extraEnd) {
      const id = view.getUint16(extra, true);
      const length = view.getUint16(extra + 2, true);
      if (id === 0x0001) {
        let field = extra + 4;
        if (size === 0xffffffff && field + 8 <= extraEnd) {
          size = Number(view.getBigUint64(field, true));
          field += 8;
        }
        if (compressedSize === 0xffffffff && field + 8 <= extraEnd) {
          compressedSize = Number(view.getBigUint64(field, true));
          field += 8;
        }
        if (localHeaderOffset === 0xffffffff && field + 8 <= extraEnd) {
          localHeaderOffset = Number(view.getBigUint64(field, true));
        }
      }
      extra += 4 + length;
    }

    const clean = path.replace(/\\/g, "/");
    const directory = clean.endsWith("/");
    const segments = clean.split("/").filter(Boolean);
    entries.push({
      path: segments.join("/") + (directory ? "/" : ""),
      name: segments[segments.length - 1] ?? clean,
      directory,
      compressedSize,
      size,
      modified: dosDate(date, time),
      encrypted: (flags & 1) === 1,
      method,
      localHeaderOffset,
    });
    offset = nameStart + nameLength + extraLength + commentLength;
  }
  return entries;
}

/**
 * Why `entry` must not be extracted, or null when it may be. `spent` is
 * what this archive has already given out.
 */
export function zipEntryRefusal(
  entry: ZipEntry,
  spent = 0,
  limits: ZipLimits = ZIP_LIMITS,
): ZipError | null {
  if (entry.encrypted)
    return new ZipError("encrypted", "The entry is encrypted.");
  if (entry.method !== 0 && entry.method !== 8) {
    return new ZipError("unsupported", `Compression method ${entry.method}.`);
  }
  if (entry.size > limits.maxEntryBytes) {
    return new ZipError("too-large", "The entry is too large.");
  }
  if (
    entry.size > limits.ratioFloor &&
    entry.size / Math.max(entry.compressedSize, 1) > limits.maxRatio
  ) {
    return new ZipError("ratio", "The entry expands too much.");
  }
  if (spent + entry.size > limits.maxTotalBytes) {
    return new ZipError("budget", "Too much was extracted from this archive.");
  }
  return null;
}

/** One entry's bytes, after `zipEntryRefusal` said yes. */
export async function extractZipEntry(
  bytes: Uint8Array,
  entry: ZipEntry,
): Promise<Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const header = entry.localHeaderOffset;
  if (
    header + 30 > bytes.byteLength ||
    view.getUint32(header, true) !== LOCAL
  ) {
    throw new ZipError("invalid", "The entry's header is damaged.");
  }
  const nameLength = view.getUint16(header + 26, true);
  const extraLength = view.getUint16(header + 28, true);
  const start = header + 30 + nameLength + extraLength;
  const end = start + entry.compressedSize;
  if (end > bytes.byteLength) {
    throw new ZipError("invalid", "The entry runs past the end of the file.");
  }
  const compressed = bytes.subarray(start, end);
  if (entry.method === 0) return compressed.slice();
  const { inflateSync } = await import("fflate");
  // A fixed output buffer: inflating can never outgrow the declared size.
  return inflateSync(compressed, { out: new Uint8Array(entry.size) });
}
