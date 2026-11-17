import type { PreviewSource } from "./types";

/** The file is bigger than its kind's preview limit. */
export class PreviewTooLargeError extends Error {
  readonly limit: number;
  constructor(limit: number) {
    super(`The file is larger than the ${limit} byte preview limit.`);
    this.name = "PreviewTooLargeError";
    this.limit = limit;
  }
}

/** The source could not be read: a failed request or a failing loader. */
export class PreviewLoadError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "PreviewLoadError";
    this.status = status;
  }
}

export type ReadResult = {
  bytes: Uint8Array;
  /** More bytes followed the ones read (only with `truncate`). */
  truncated: boolean;
};

export type ReadOptions = {
  maxBytes: number;
  /** Return the first `maxBytes` instead of failing on a larger file. */
  truncate?: boolean;
};

function capped(
  bytes: Uint8Array,
  { maxBytes, truncate }: ReadOptions,
): ReadResult {
  if (bytes.byteLength <= maxBytes) return { bytes, truncated: false };
  if (!truncate) throw new PreviewTooLargeError(maxBytes);
  return { bytes: bytes.subarray(0, maxBytes), truncated: true };
}

/**
 * The bytes of `source`, read at most up to `maxBytes`. `load` wins over
 * `url`. A URL is streamed, so an oversized file stops downloading as soon
 * as it passes the limit.
 */
export async function readSource(
  source: PreviewSource,
  signal: AbortSignal,
  options: ReadOptions,
): Promise<ReadResult> {
  if (source.load) {
    let loaded: Blob | ArrayBuffer;
    try {
      loaded = await source.load(signal);
    } catch (error) {
      if (signal.aborted) throw error;
      throw new PreviewLoadError(
        error instanceof Error ? error.message : "The file could not be read.",
      );
    }
    // Duck-typed: a Blob or buffer from another realm (a frame, a worker
    // bridge) fails `instanceof`.
    if (typeof (loaded as Blob).arrayBuffer !== "function") {
      return capped(new Uint8Array(loaded as ArrayBuffer), options);
    }
    loaded = loaded as Blob;
    if (loaded.size > options.maxBytes && !options.truncate) {
      throw new PreviewTooLargeError(options.maxBytes);
    }
    const part =
      loaded.size > options.maxBytes
        ? loaded.slice(0, options.maxBytes)
        : loaded;
    const bytes = new Uint8Array(await part.arrayBuffer());
    return { bytes, truncated: loaded.size > options.maxBytes };
  }
  if (!source.url) throw new PreviewLoadError("The file has no address.");

  const response = await fetch(source.url, {
    credentials: source.credentials ?? "same-origin",
    signal,
  });
  if (!response.ok) {
    throw new PreviewLoadError(`HTTP ${response.status}`, response.status);
  }
  const declared = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(declared) &&
    declared > options.maxBytes &&
    !options.truncate
  ) {
    void response.body?.cancel().catch(() => {});
    throw new PreviewTooLargeError(options.maxBytes);
  }
  const reader = response.body?.getReader();
  if (!reader) {
    return capped(new Uint8Array(await response.arrayBuffer()), options);
  }
  const chunks: Uint8Array[] = [];
  let received = 0;
  let truncated = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    if (received > options.maxBytes) {
      await reader.cancel().catch(() => {});
      if (!options.truncate) throw new PreviewTooLargeError(options.maxBytes);
      truncated = true;
      break;
    }
  }
  const bytes = new Uint8Array(Math.min(received, options.maxBytes));
  let offset = 0;
  for (const chunk of chunks) {
    const room = bytes.byteLength - offset;
    if (room <= 0) break;
    const part = chunk.byteLength > room ? chunk.subarray(0, room) : chunk;
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return { bytes, truncated };
}

/** NUL bytes near the start: an image, archive or other binary file. */
export function looksBinary(bytes: Uint8Array): boolean {
  const end = Math.min(bytes.byteLength, 8192);
  for (let index = 0; index < end; index += 1) {
    if (bytes[index] === 0) return true;
  }
  return false;
}

/**
 * Bytes as text: UTF-8 (BOM dropped), or UTF-16 when a BOM says so. A cut
 * made by truncation may split the last character; it decodes as U+FFFD.
 */
export function decodeText(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  }
  return new TextDecoder("utf-8").decode(bytes);
}
