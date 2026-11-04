import { crc32, deflateRawSync } from "node:zlib";

// A minimal ZIP writer (deflate, UTF-8 names, no ZIP64) for the XLSX
// container and split CSV or JSON exports. Node 24's zlib provides both
// deflate and CRC-32, so no dependency is needed.

export type ZipEntry = { name: string; data: Uint8Array };

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const VERSION = 20;
const UTF8_NAMES = 0x0800;
export const ZIP_STORE = 0;
export const ZIP_DEFLATE = 8;
export const LOCAL_HEADER_SIZE = 30;
const END_RECORD_SIZE = 22;
export const MAX_ZIP32 = 0xffffffff;
export const MAX_ENTRIES = 0xffff;

export class InvalidZipEntryName extends Error {}

/** Rejects names that could escape the extraction folder. */
export function assertSafeEntryName(name: string): void {
  const invalid =
    name.length === 0 ||
    name.includes("\\") ||
    name.includes("\0") ||
    name.startsWith("/") ||
    /^[A-Za-z]:/.test(name) ||
    name.split("/").some((segment) => segment === ".." || segment === "");
  if (invalid) throw new InvalidZipEntryName(`Invalid entry name: ${name}`);
}

/** MS-DOS date and time fields of `when`, read in UTC. */
export function dosDateTime(when: Date): { date: number; time: number } {
  const year = Math.min(Math.max(when.getUTCFullYear(), 1980), 2107);
  return {
    date:
      ((year - 1980) << 9) |
      ((when.getUTCMonth() + 1) << 5) |
      when.getUTCDate(),
    time:
      (when.getUTCHours() << 11) |
      (when.getUTCMinutes() << 5) |
      Math.floor(when.getUTCSeconds() / 2),
  };
}

/** The fields a ZIP entry's local and central headers share. */
export type ZipEntryHeader = {
  method: number;
  date: number;
  time: number;
  checksum: number;
  compressedSize: number;
  size: number;
  nameLength: number;
};

/** A local file header, without the name that follows it. */
export function localHeader(entry: ZipEntryHeader): Buffer {
  const local = Buffer.alloc(LOCAL_HEADER_SIZE);
  local.writeUInt32LE(LOCAL_HEADER, 0);
  local.writeUInt16LE(VERSION, 4);
  local.writeUInt16LE(UTF8_NAMES, 6);
  local.writeUInt16LE(entry.method, 8);
  local.writeUInt16LE(entry.time, 10);
  local.writeUInt16LE(entry.date, 12);
  local.writeUInt32LE(entry.checksum, 14);
  local.writeUInt32LE(entry.compressedSize, 18);
  local.writeUInt32LE(entry.size, 22);
  local.writeUInt16LE(entry.nameLength, 26);
  local.writeUInt16LE(0, 28);
  return local;
}

/** A central directory header, without the name that follows it. */
export function centralHeader(entry: ZipEntryHeader, offset: number): Buffer {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(CENTRAL_HEADER, 0);
  header.writeUInt16LE(VERSION, 4);
  header.writeUInt16LE(VERSION, 6);
  header.writeUInt16LE(UTF8_NAMES, 8);
  header.writeUInt16LE(entry.method, 10);
  header.writeUInt16LE(entry.time, 12);
  header.writeUInt16LE(entry.date, 14);
  header.writeUInt32LE(entry.checksum, 16);
  header.writeUInt32LE(entry.compressedSize, 20);
  header.writeUInt32LE(entry.size, 24);
  header.writeUInt16LE(entry.nameLength, 28);
  // Extra field, comment, disk number, internal and external attributes.
  header.writeUInt32LE(offset, 42);
  return header;
}

/** The end-of-central-directory record that closes an archive. */
export function endOfCentralDirectory(
  entryCount: number,
  centralSize: number,
  centralOffset: number,
): Buffer {
  const end = Buffer.alloc(END_RECORD_SIZE);
  end.writeUInt32LE(END_OF_CENTRAL_DIRECTORY, 0);
  end.writeUInt16LE(entryCount, 8);
  end.writeUInt16LE(entryCount, 10);
  end.writeUInt32LE(centralSize, 12);
  end.writeUInt32LE(centralOffset, 16);
  return end;
}

/** The archive bytes of `entries`, in order, stamped with `modifiedAt`. */
export function buildZip(
  entries: readonly ZipEntry[],
  modifiedAt: Date,
): Buffer {
  if (entries.length > MAX_ENTRIES) {
    throw new Error("Too many entries for a ZIP archive");
  }
  const { date, time } = dosDateTime(modifiedAt);
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    assertSafeEntryName(entry.name);
    const name = Buffer.from(entry.name, "utf8");
    const compressed = deflateRawSync(entry.data, { level: 6 });
    if (
      offset + LOCAL_HEADER_SIZE + name.length + compressed.length >
      MAX_ZIP32
    ) {
      throw new Error("The archive is too large for a ZIP file");
    }
    const header: ZipEntryHeader = {
      method: ZIP_DEFLATE,
      date,
      time,
      checksum: crc32(entry.data),
      compressedSize: compressed.length,
      size: entry.data.byteLength,
      nameLength: name.length,
    };
    const local = localHeader(header);
    parts.push(local, name, compressed);
    central.push(centralHeader(header, offset), name);
    offset += local.length + name.length + compressed.length;
  }

  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  if (offset + centralSize + END_RECORD_SIZE > MAX_ZIP32) {
    throw new Error("The archive is too large for a ZIP file");
  }
  return Buffer.concat([
    ...parts,
    ...central,
    endOfCentralDirectory(entries.length, centralSize, offset),
  ]);
}
