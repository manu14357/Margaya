import { crc32, inflateRawSync } from "node:zlib";

export type ReadEntry = { name: string; data: Buffer; flags: number };

/**
 * Reads an archive through its central directory, inflates every entry and
 * checks each CRC-32 and size against the headers. Throws on any mismatch.
 */
export function readZip(archive: Buffer): ReadEntry[] {
  const eocd = archive.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error("No end of central directory record");
  const count = archive.readUInt16LE(eocd + 10);
  let cursor = archive.readUInt32LE(eocd + 16);
  const entries: ReadEntry[] = [];
  for (let i = 0; i < count; i += 1) {
    if (archive.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error("Bad central directory header");
    }
    const flags = archive.readUInt16LE(cursor + 8);
    const method = archive.readUInt16LE(cursor + 10);
    const checksum = archive.readUInt32LE(cursor + 16);
    const compressedSize = archive.readUInt32LE(cursor + 20);
    const size = archive.readUInt32LE(cursor + 24);
    const nameLength = archive.readUInt16LE(cursor + 28);
    const extraLength = archive.readUInt16LE(cursor + 30);
    const commentLength = archive.readUInt16LE(cursor + 32);
    const offset = archive.readUInt32LE(cursor + 42);
    const name = archive.toString(
      "utf8",
      cursor + 46,
      cursor + 46 + nameLength,
    );

    if (archive.readUInt32LE(offset) !== 0x04034b50) {
      throw new Error(`Bad local header for ${name}`);
    }
    const start =
      offset +
      30 +
      archive.readUInt16LE(offset + 26) +
      archive.readUInt16LE(offset + 28);
    const raw = archive.subarray(start, start + compressedSize);
    const data = method === 8 ? inflateRawSync(raw) : Buffer.from(raw);
    if (data.length !== size) throw new Error(`Size mismatch for ${name}`);
    if (crc32(data) !== checksum) throw new Error(`CRC mismatch for ${name}`);
    entries.push({ name, data, flags });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** The entries of an archive as UTF-8 text, by name. */
export function zipTexts(archive: Buffer): Map<string, string> {
  return new Map(
    readZip(archive).map((entry) => [entry.name, entry.data.toString("utf8")]),
  );
}
