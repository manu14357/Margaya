import { constants, createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { createId } from "@paralleldrive/cuid2";

// The built-in file store used when no S3-compatible storage is configured.
// Objects live under MARGAYA_STORAGE_DIR with the same keys S3 would use;
// each has a JSON sidecar under `.meta/` holding its content type. Nothing
// here is served directly: downloads go through the authorized asset and
// export routes, and there is no listing.

const DEFAULT_STORAGE_DIR = "./data/uploads";
const META_DIR = ".meta";
const TEMP_DIR = ".tmp";
const MAX_KEY_LENGTH = 1024;
// Key segments: no separators, no drive letters, no percent escapes. A
// leading dot is refused too, which keeps `.`, `..`, `.meta` and `.tmp` out.
const KEY_SEGMENT = /^[A-Za-z0-9._-]+$/;

export class InvalidStorageKeyError extends Error {}
export class LocalObjectExistsError extends Error {}
export class LocalUploadSizeError extends Error {
  constructor(
    message: string,
    /** More bytes than allowed, rather than a different count. */
    readonly tooLarge: boolean,
  ) {
    super(message);
  }
}

export function localStorageRoot(): string {
  return path.resolve(
    process.env.MARGAYA_STORAGE_DIR?.trim() || DEFAULT_STORAGE_DIR,
  );
}

function keySegments(key: string): string[] {
  if (!key || key.length > MAX_KEY_LENGTH) {
    throw new InvalidStorageKeyError("Invalid storage key");
  }
  const segments = key.split("/");
  for (const segment of segments) {
    if (!KEY_SEGMENT.test(segment) || segment.startsWith(".")) {
      throw new InvalidStorageKeyError("Invalid storage key");
    }
  }
  return segments;
}

/** The file that holds `key`, refusing any key that could leave the root. */
export function resolveLocalPath(key: string, root = localStorageRoot()) {
  const resolved = path.resolve(root, ...keySegments(key));
  if (!resolved.startsWith(root + path.sep)) {
    throw new InvalidStorageKeyError("Invalid storage key");
  }
  return resolved;
}

function metaPath(key: string, root: string) {
  return `${path.resolve(root, META_DIR, ...keySegments(key))}.json`;
}

type ObjectMeta = { contentType: string };

async function readMeta(key: string, root: string): Promise<ObjectMeta | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(metaPath(key, root), "utf8"));
    return typeof parsed?.contentType === "string"
      ? { contentType: parsed.contentType }
      : null;
  } catch {
    return null;
  }
}

async function writeMeta(key: string, root: string, meta: ObjectMeta) {
  const file = metaPath(key, root);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(meta));
}

function isMissing(error: unknown) {
  return (error as NodeJS.ErrnoException | null)?.code === "ENOENT";
}

/** Counts bytes as they pass and fails the stream past `maxBytes`. */
function byteLimit(maxBytes: number, counter: { bytes: number }) {
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      counter.bytes += chunk.length;
      if (counter.bytes > maxBytes) {
        callback(
          new LocalUploadSizeError("Upload exceeds the allowed size.", true),
        );
        return;
      }
      callback(null, chunk);
    },
  });
}

type WriteOptions = {
  contentType: string;
  maxBytes: number;
  /** When set, the stored file must have exactly this many bytes. */
  expectedSize?: number;
  /** Server-written files may replace an object; uploads never do. */
  overwrite?: boolean;
};

/**
 * Streams `body` into the store: into a temporary file first, then linked
 * into place, so a reader never sees a partial object and an upload can't
 * replace a file that already exists.
 */
export async function writeLocalObject(
  key: string,
  body: WebReadableStream | ReadableStream | Uint8Array,
  options: WriteOptions,
): Promise<{ size: number }> {
  const root = localStorageRoot();
  const target = resolveLocalPath(key, root);
  const tempDir = path.join(root, TEMP_DIR);
  await fs.mkdir(tempDir, { recursive: true });
  await fs.mkdir(path.dirname(target), { recursive: true });
  const temp = path.join(tempDir, `${Date.now()}-${createId()}.part`);

  const counter = { bytes: 0 };
  const source =
    body instanceof Uint8Array
      ? Readable.from([Buffer.from(body)])
      : Readable.fromWeb(body as WebReadableStream);
  try {
    await pipeline(
      source,
      byteLimit(options.maxBytes, counter),
      createWriteStream(temp, { flags: "wx" }),
    );
    if (
      options.expectedSize !== undefined &&
      counter.bytes !== options.expectedSize
    ) {
      throw new LocalUploadSizeError(
        "Uploaded bytes do not match the declared size.",
        false,
      );
    }
    if (options.overwrite) {
      await fs.rename(temp, target);
    } else {
      try {
        // link() fails when the target exists: no check-then-write race.
        await fs.link(temp, target);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") {
          throw new LocalObjectExistsError("The object already exists.");
        }
        throw error;
      }
    }
    await writeMeta(key, root, { contentType: options.contentType });
    return { size: counter.bytes };
  } finally {
    await fs.rm(temp, { force: true });
  }
}

export async function statLocalObject(key: string) {
  const root = localStorageRoot();
  try {
    const stats = await fs.stat(resolveLocalPath(key, root));
    if (!stats.isFile()) return null;
    const meta = await readMeta(key, root);
    return {
      size: stats.size,
      contentType: meta?.contentType,
      lastModified: stats.mtime,
    };
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

export async function readLocalObject(key: string) {
  const root = localStorageRoot();
  const file = resolveLocalPath(key, root);
  const stats = await fs.stat(file);
  if (!stats.isFile()) throw new Error("Storage object is missing.");
  const meta = await readMeta(key, root);
  return {
    body: Readable.toWeb(createReadStream(file)),
    contentType: meta?.contentType,
    contentLength: stats.size,
    etag: `"${stats.size.toString(16)}-${stats.mtimeMs.toString(16)}"`,
    lastModified: stats.mtime,
  };
}

export async function copyLocalObject(
  sourceKey: string,
  destinationKey: string,
) {
  const root = localStorageRoot();
  const destination = resolveLocalPath(destinationKey, root);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.copyFile(
    resolveLocalPath(sourceKey, root),
    destination,
    constants.COPYFILE_EXCL,
  );
  const meta = await readMeta(sourceKey, root);
  if (meta) await writeMeta(destinationKey, root, meta);
}

/** Removes an object and its sidecar; a missing object is not an error. */
export async function deleteLocalObject(key: string) {
  const root = localStorageRoot();
  await fs.rm(resolveLocalPath(key, root), { force: true });
  await fs.rm(metaPath(key, root), { force: true });
}

/** Temporary files a crashed or cut-off upload left behind. */
export async function sweepLocalTempFiles(olderThan: Date): Promise<number> {
  const tempDir = path.join(localStorageRoot(), TEMP_DIR);
  let names: string[];
  try {
    names = await fs.readdir(tempDir);
  } catch (error) {
    if (isMissing(error)) return 0;
    throw error;
  }
  let removed = 0;
  for (const name of names) {
    const file = path.join(tempDir, name);
    try {
      const stats = await fs.stat(file);
      if (stats.isFile() && stats.mtime < olderThan) {
        await fs.rm(file, { force: true });
        removed += 1;
      }
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }
  return removed;
}
