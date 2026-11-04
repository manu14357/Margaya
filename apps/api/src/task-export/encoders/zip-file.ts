import { type FileHandle, open } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { crc32, createDeflateRaw } from "node:zlib";
import {
  assertSafeEntryName,
  centralHeader,
  dosDateTime,
  endOfCentralDirectory,
  LOCAL_HEADER_SIZE,
  localHeader,
  MAX_ENTRIES,
  MAX_ZIP32,
  ZIP_DEFLATE,
  ZIP_STORE,
  type ZipEntryHeader,
} from "./zip";

// Writes a ZIP archive straight to a file, entry by entry, so an archive far
// larger than memory (a whole workspace with its files) only costs disk. Each
// local header is written after its data, into the gap left for it, because
// the checksum and sizes are known only then.

/** The archive would pass `maxBytes`, or hold too many entries for ZIP32. */
export class ZipLimitError extends Error {}

type Chunk = string | Uint8Array;
type WrittenEntry = { header: ZipEntryHeader; name: Buffer; offset: number };

async function* toBuffers(source: AsyncIterable<Chunk> | Iterable<Chunk>) {
  for await (const chunk of source) {
    const buffer =
      typeof chunk === "string"
        ? Buffer.from(chunk, "utf8")
        : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
    if (buffer.length > 0) yield buffer;
  }
}

export class ZipFileWriter {
  private position = 0;
  private readonly written: WrittenEntry[] = [];
  private readonly stamp: { date: number; time: number };

  private constructor(
    private readonly handle: FileHandle,
    modifiedAt: Date,
    private readonly maxBytes: number,
  ) {
    this.stamp = dosDateTime(modifiedAt);
  }

  /**
   * Creates the file at `path`, readable by this user only, and refuses a path
   * that exists: the archive holds a workspace's data, and it may be going into
   * a temp folder other local users can write to.
   */
  static async create(path: string, modifiedAt: Date, maxBytes = MAX_ZIP32) {
    const limit = Math.min(maxBytes, MAX_ZIP32);
    return new ZipFileWriter(await open(path, "wx", 0o600), modifiedAt, limit);
  }

  private async writeAt(data: Uint8Array, position: number): Promise<void> {
    let done = 0;
    while (done < data.length) {
      const { bytesWritten } = await this.handle.write(
        data,
        done,
        data.length - done,
        position + done,
      );
      done += bytesWritten;
    }
  }

  /**
   * Appends an entry, streaming `source`. When it throws, the archive stays
   * valid without the entry: nothing counts until its header is in place.
   */
  async add(
    entryName: string,
    source: AsyncIterable<Chunk> | Iterable<Chunk>,
    options: { compress: boolean; signal?: AbortSignal },
  ): Promise<void> {
    assertSafeEntryName(entryName);
    if (this.written.length >= MAX_ENTRIES - 1) {
      throw new ZipLimitError("Too many entries for a ZIP archive");
    }
    const name = Buffer.from(entryName, "utf8");
    const offset = this.position;
    const dataStart = offset + LOCAL_HEADER_SIZE + name.length;
    let cursor = dataStart;
    let checksum = 0;
    let size = 0;

    const measure = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        checksum = crc32(chunk, checksum);
        size += chunk.length;
        callback(null, chunk);
      },
    });
    const sink = async (stream: AsyncIterable<Buffer>) => {
      for await (const chunk of stream) {
        if (cursor + chunk.length > this.maxBytes) {
          throw new ZipLimitError("The archive is too large");
        }
        await this.writeAt(chunk, cursor);
        cursor += chunk.length;
      }
    };
    const input = Readable.from(toBuffers(source));
    const pipelineOptions = { signal: options.signal };
    if (options.compress) {
      await pipeline(
        input,
        measure,
        createDeflateRaw({ level: 6 }),
        sink,
        pipelineOptions,
      );
    } else {
      await pipeline(input, measure, sink, pipelineOptions);
    }

    const header: ZipEntryHeader = {
      method: options.compress ? ZIP_DEFLATE : ZIP_STORE,
      date: this.stamp.date,
      time: this.stamp.time,
      checksum,
      compressedSize: cursor - dataStart,
      size,
      nameLength: name.length,
    };
    await this.writeAt(localHeader(header), offset);
    await this.writeAt(name, offset + LOCAL_HEADER_SIZE);
    this.written.push({ header, name, offset });
    this.position = cursor;
  }

  /** Writes the central directory, closes the file, returns its size. */
  async finish(): Promise<number> {
    const centralOffset = this.position;
    const parts = this.written.flatMap(({ header, name, offset }) => [
      centralHeader(header, offset),
      name,
    ]);
    const central = Buffer.concat(parts);
    const end = endOfCentralDirectory(
      this.written.length,
      central.length,
      centralOffset,
    );
    if (centralOffset + central.length + end.length > MAX_ZIP32) {
      throw new ZipLimitError("The archive is too large");
    }
    await this.writeAt(central, centralOffset);
    await this.writeAt(end, centralOffset + central.length);
    const total = centralOffset + central.length + end.length;
    // A failed last entry may have written past the end.
    await this.handle.truncate(total);
    await this.handle.close();
    return total;
  }

  /** Closes the file without finishing the archive. */
  async abort(): Promise<void> {
    await this.handle.close().catch(() => undefined);
  }
}
