import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  type HeadObjectCommandOutput,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createId } from "@paralleldrive/cuid2";
import { config } from "dotenv-mono";
import { auditContext } from "../audit-log/context";
import { normalizeApiServerUrl } from "../utils/openapi-spec";
import {
  copyLocalObject,
  deleteLocalObject,
  readLocalObject,
  statLocalObject,
  writeLocalObject,
} from "./local";
import { signUploadToken } from "./upload-token";

config();

const DEFAULT_MAX_IMAGE_UPLOAD_BYTES = 10 * 1024 * 1024;
const DEFAULT_PRESIGN_TTL_SECONDS = 300;

const allowedImageMimeTypes = new Set([
  "image/apng",
  "image/avif",
  "image/gif",
  "image/heic",
  "image/heif",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

export function isImageContentType(contentType: string) {
  return allowedImageMimeTypes.has(contentType.toLowerCase());
}

// `attachment` files belong to a task's Attachments panel rather than to a
// piece of text, so description and comment cleanup never touches them.
export type UploadSurface = "description" | "comment" | "attachment";

const SURFACE_FOLDERS: Record<UploadSurface, string> = {
  description: "descriptions",
  comment: "comments",
  attachment: "attachments",
};

type StorageConfig = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicBaseUrl?: string;
  keyPrefix: string;
  forcePathStyle: boolean;
  maxImageUploadBytes: number;
  presignTtlSeconds: number;
};

type TaskImageUploadContext = {
  workspaceId: string;
  projectId: string;
  taskId: string;
  surface: UploadSurface;
  filename: string;
  contentType: string;
};

type TaskImageUploadUrl = {
  key: string;
  uploadUrl: string;
  headers: Record<string, string>;
};

type AssetObject = {
  body: unknown;
  contentType: string | undefined;
  contentLength: number | undefined;
  etag: string | undefined;
  lastModified: Date | undefined;
};

let clientCache:
  | {
      cacheKey: string;
      client: S3Client;
    }
  | undefined;

function env(name: string) {
  return process.env[name]?.trim() || "";
}

export function parseBoolean(value: string | undefined, fallback: boolean) {
  if (value === undefined || value.trim() === "") return fallback;
  return value.trim().toLowerCase() === "true";
}

export function parsePositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value?.trim() || "", 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

/**
 * Resolves static S3 credentials from the access key pair.
 *
 * Returns the explicit credentials only when BOTH the access key id and secret
 * are provided. When neither is set, returns `undefined` so the AWS SDK falls
 * back to its default credential provider chain (EC2 instance profile, ECS task
 * role, EKS IRSA, environment variables, or shared config), enabling
 * IAM-role-based access without static keys.
 *
 * Throws when exactly one of the two is set, since that is almost always a
 * misconfiguration rather than an intentional fallback.
 */
export function resolveS3Credentials(
  accessKeyId: string,
  secretAccessKey: string,
): { accessKeyId: string; secretAccessKey: string } | undefined {
  const hasAccessKeyId = Boolean(accessKeyId);
  const hasSecretAccessKey = Boolean(secretAccessKey);

  if (hasAccessKeyId !== hasSecretAccessKey) {
    throw new Error(
      "Incomplete S3 credentials. Set both S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY, or neither to use the default AWS credential provider chain (IAM role / IRSA / environment).",
    );
  }

  if (hasAccessKeyId && hasSecretAccessKey) {
    return { accessKeyId, secretAccessKey };
  }

  return undefined;
}

export type StorageDriver = "s3" | "local" | "none";

/**
 * Where files go: S3-compatible storage when S3_ENDPOINT or S3_BUCKET is
 * set (a half-done setup fails loudly rather than falling back), else the
 * built-in local store under MARGAYA_STORAGE_DIR. MARGAYA_LOCAL_STORAGE=false
 * turns the local store off, so uploads stay off until S3 is configured.
 */
export function storageDriver(): StorageDriver {
  if (env("S3_ENDPOINT") || env("S3_BUCKET")) return "s3";
  return parseBoolean(process.env.MARGAYA_LOCAL_STORAGE, true)
    ? "local"
    : "none";
}

function usesLocalStorage() {
  return storageDriver() === "local";
}

const NOT_CONFIGURED_MESSAGE =
  "S3 uploads are not configured. Set S3_ENDPOINT and S3_BUCKET (and either both S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY, or neither to use the default AWS credential provider chain / IAM role).";

function getStorageConfig(): StorageConfig {
  if (storageDriver() === "none") throw new Error(NOT_CONFIGURED_MESSAGE);
  const endpoint = env("S3_ENDPOINT");
  const bucket = env("S3_BUCKET");
  const accessKeyId = env("S3_ACCESS_KEY_ID");
  const secretAccessKey = env("S3_SECRET_ACCESS_KEY");

  if (!endpoint || !bucket) {
    throw new Error(NOT_CONFIGURED_MESSAGE);
  }

  // Validate the access key pair early so misconfiguration surfaces here rather
  // than as an opaque signing error later.
  resolveS3Credentials(accessKeyId, secretAccessKey);

  return {
    endpoint,
    region: env("S3_REGION") || "us-east-1",
    bucket,
    accessKeyId,
    secretAccessKey,
    publicBaseUrl: env("S3_PUBLIC_BASE_URL") || undefined,
    keyPrefix: env("S3_KEY_PREFIX"),
    forcePathStyle: parseBoolean(process.env.S3_FORCE_PATH_STYLE, true),
    maxImageUploadBytes: parsePositiveInt(
      process.env.S3_MAX_IMAGE_UPLOAD_BYTES,
      DEFAULT_MAX_IMAGE_UPLOAD_BYTES,
    ),
    presignTtlSeconds: parsePositiveInt(
      process.env.S3_PRESIGN_TTL_SECONDS,
      DEFAULT_PRESIGN_TTL_SECONDS,
    ),
  };
}

function getMaxImageUploadBytes() {
  return parsePositiveInt(
    process.env.S3_MAX_IMAGE_UPLOAD_BYTES,
    DEFAULT_MAX_IMAGE_UPLOAD_BYTES,
  );
}

/** S3_KEY_PREFIX for S3; local keys are already relative to their folder. */
function activeKeyPrefix() {
  return usesLocalStorage() ? "" : getStorageConfig().keyPrefix;
}

/** Where the browser sends bytes: MARGAYA_API_URL, else this request's origin. */
function requestApiBaseUrl() {
  const configured = env("MARGAYA_API_URL");
  const c = auditContext.getStore()?.c;
  const origin = configured || (c ? new URL(c.req.url).origin : "");
  return origin ? normalizeApiServerUrl(origin) : "/api";
}

/** The local store's presigned-PUT equivalent (see upload-token.ts). */
function localUploadUrl(key: string, contentType: string, size: number) {
  const ttlSeconds = parsePositiveInt(
    process.env.S3_PRESIGN_TTL_SECONDS,
    DEFAULT_PRESIGN_TTL_SECONDS,
  );
  const token = signUploadToken({
    key,
    contentType,
    size,
    expiresAt: Date.now() + ttlSeconds * 1000,
  });
  return `${requestApiBaseUrl()}/storage/upload/${token}`;
}

function getClient(config: StorageConfig) {
  const cacheKey = JSON.stringify({
    endpoint: config.endpoint,
    region: config.region,
    accessKeyId: config.accessKeyId,
    bucket: config.bucket,
    forcePathStyle: config.forcePathStyle,
  });

  if (clientCache?.cacheKey === cacheKey) {
    return clientCache.client;
  }

  const clientConfig: S3ClientConfig = {
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle,
    // Avoid auto-injecting checksum params for presigned PUT URLs. Some
    // S3-compatible providers (e.g. Garage/R2) reject mismatched hoisted CRCs.
    requestChecksumCalculation: "WHEN_REQUIRED",
  };

  const credentials = resolveS3Credentials(
    config.accessKeyId,
    config.secretAccessKey,
  );

  // Only pin explicit credentials when both keys are provided. Otherwise leave
  // `credentials` unset so the AWS SDK resolves them from its default provider
  // chain (EC2 instance profile, ECS task role, EKS IRSA, env, shared config),
  // which is how IAM-role-based access works.
  if (credentials) {
    clientConfig.credentials = credentials;
  }

  const client = new S3Client(clientConfig);
  clientCache = { cacheKey, client };
  return client;
}

export function sanitizePathSegment(value: string) {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, "-")
      .replace(/-{2,}/g, "-")
      .replace(/^-+|-+$/g, "") || "file"
  );
}

export function getFileExtension(filename: string) {
  const normalized = filename.trim();
  const extension = normalized.includes(".")
    ? normalized.split(".").pop() || ""
    : "";

  return sanitizePathSegment(extension).slice(0, 12);
}

export function buildObjectKeyPrefix(
  context: Omit<TaskImageUploadContext, "filename" | "contentType">,
) {
  const surfaceFolder =
    SURFACE_FOLDERS[context.surface] ?? SURFACE_FOLDERS.description;

  return [
    "workspace",
    sanitizePathSegment(context.workspaceId),
    "project",
    sanitizePathSegment(context.projectId),
    "task",
    sanitizePathSegment(context.taskId),
    surfaceFolder,
  ].join("/");
}

export function buildObjectKey(context: TaskImageUploadContext) {
  return `${buildObjectKeyPrefix(context)}/${buildObjectFileName(context.filename)}`;
}

/** A unique, sanitized object file name that keeps the extension. */
function buildObjectFileName(filename: string) {
  const extension = getFileExtension(filename);
  const timestamp = Date.now();
  const randomId = createId();

  // No leading dot: the key check refuses names that look hidden.
  const baseName =
    sanitizePathSegment(filename.replace(/\.[^/.]+$/, "") || "image")
      .replace(/^\.+/, "")
      .slice(0, 64) || "file";

  return extension
    ? `${baseName}-${timestamp}-${randomId}.${extension}`
    : `${baseName}-${timestamp}-${randomId}`;
}

type PageAssetContext = {
  workspaceId: string;
  projectId: string;
  pageId: string;
};

/** The object folder for files uploaded into a page. */
export function buildPageObjectKeyPrefix(context: PageAssetContext) {
  return [
    "workspace",
    sanitizePathSegment(context.workspaceId),
    "project",
    sanitizePathSegment(context.projectId),
    "page",
    sanitizePathSegment(context.pageId),
    "files",
  ].join("/");
}

/** A presigned PUT for a file uploaded into a page (S3_KEY_PREFIX applied). */
export async function createPageAssetUploadUrl(
  context: PageAssetContext & {
    filename: string;
    contentType: string;
    size: number;
  },
): Promise<TaskImageUploadUrl> {
  validateTaskAssetUploadInput(context.contentType, context.size);
  if (usesLocalStorage()) {
    const key = `${buildPageObjectKeyPrefix(context)}/${buildObjectFileName(context.filename)}`;
    return {
      key,
      uploadUrl: localUploadUrl(key, context.contentType, context.size),
      headers: { "Content-Type": context.contentType },
    };
  }
  const config = getStorageConfig();
  const key = applyKeyPrefix(
    config.keyPrefix,
    `${buildPageObjectKeyPrefix(context)}/${buildObjectFileName(context.filename)}`,
  );
  const uploadUrl = await getSignedUrl(
    getClient(config),
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      ContentType: context.contentType,
      ContentLength: context.size,
    }),
    {
      expiresIn: config.presignTtlSeconds,
      signableHeaders: new Set(["content-length", "content-type"]),
    },
  );
  return { key, uploadUrl, headers: { "Content-Type": context.contentType } };
}

/** Whether `key` was issued for this page (same rules as task keys). */
export function assertPageAssetKeyMatchesContext(
  key: string,
  context: PageAssetContext,
) {
  const fullPrefix = `${applyKeyPrefix(activeKeyPrefix(), buildPageObjectKeyPrefix(context))}/`;
  if (!key.startsWith(fullPrefix)) return false;
  const suffix = key.slice(fullPrefix.length);
  return /^[A-Za-z0-9._-]+$/.test(suffix) && !suffix.startsWith(".");
}

export function applyKeyPrefix(prefix: string, key: string) {
  if (!prefix) return key;
  const trimmed = prefix.replace(/\/+$/, "");
  return `${trimmed}/${key}`;
}

/** A fresh object key for this context, with S3_KEY_PREFIX applied. */
export function buildStorageObjectKey(context: TaskImageUploadContext) {
  return applyKeyPrefix(activeKeyPrefix(), buildObjectKey(context));
}

export function validateTaskAssetUploadInput(
  contentType: string,
  size: number,
) {
  const maxImageUploadBytes = getMaxImageUploadBytes();

  if (!contentType.trim()) {
    throw new Error("A valid content type is required.");
  }

  if (!Number.isSafeInteger(size) || size <= 0) {
    throw new Error("Upload size must be a positive safe integer.");
  }

  if (size > maxImageUploadBytes) {
    throw new Error(
      `Upload exceeds the maximum upload size of ${Math.floor(maxImageUploadBytes / (1024 * 1024))}MB.`,
    );
  }
}

export async function createTaskImageUploadUrl(
  context: TaskImageUploadContext & { size: number },
): Promise<TaskImageUploadUrl> {
  validateTaskAssetUploadInput(context.contentType, context.size);
  if (usesLocalStorage()) {
    const key = buildObjectKey(context);
    return {
      key,
      uploadUrl: localUploadUrl(key, context.contentType, context.size),
      headers: { "Content-Type": context.contentType },
    };
  }
  const config = getStorageConfig();
  const client = getClient(config);
  const rawKey = buildObjectKey(context);
  const key = applyKeyPrefix(config.keyPrefix, rawKey);

  const command = new PutObjectCommand({
    Bucket: config.bucket,
    Key: key,
    ContentType: context.contentType,
    ContentLength: context.size,
  });

  const uploadUrl = await getSignedUrl(client, command, {
    expiresIn: config.presignTtlSeconds,
    signableHeaders: new Set(["content-length", "content-type"]),
  });

  return {
    key,
    uploadUrl,
    headers: {
      // The browser supplies Content-Length from the File body. It is signed,
      // but must not be set by JS because it is a forbidden request header.
      "Content-Type": context.contentType,
    },
  };
}

export class InvalidUploadedAssetError extends Error {}

/** Call only after checking the object's task/workspace key prefix. */
export async function verifyTaskAssetUpload(
  key: string,
  expected: { size: number; contentType: string },
) {
  if (usesLocalStorage()) return verifyLocalUpload(key, expected);
  const config = getStorageConfig();
  const client = getClient(config);
  const abortSignal = AbortSignal.timeout(10_000);
  let object: HeadObjectCommandOutput;
  try {
    object = await client.send(
      new HeadObjectCommand({ Bucket: config.bucket, Key: key }),
      { abortSignal },
    );
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === "NotFound" ||
        error.name === "NoSuchKey" ||
        ("$metadata" in error &&
          (error.$metadata as { httpStatusCode?: number }).httpStatusCode ===
            404))
    ) {
      throw new InvalidUploadedAssetError("Uploaded object was not found.");
    }
    // Provider errors may include endpoints, signed URLs or other secrets.
    throw new Error("Unable to verify uploaded object.");
  }

  const size = object.ContentLength;
  if (typeof size === "number" && size > config.maxImageUploadBytes) {
    // Also remove oversized objects made with a still-valid older upload URL.
    // Invalid client size claims never cause deletion of an in-limit object.
    try {
      await client.send(
        new DeleteObjectCommand({ Bucket: config.bucket, Key: key }),
        { abortSignal },
      );
    } catch {
      throw new Error("Unable to remove oversized uploaded object.");
    }
    throw new InvalidUploadedAssetError(
      "Uploaded object exceeds the maximum upload size.",
    );
  }
  if (
    !Number.isSafeInteger(size) ||
    !size ||
    size !== expected.size ||
    !object.ContentType ||
    object.ContentType.toLowerCase() !== expected.contentType.toLowerCase()
  ) {
    throw new InvalidUploadedAssetError(
      "Uploaded object does not match the declared size and content type.",
    );
  }
  return { size, contentType: object.ContentType };
}

async function verifyLocalUpload(
  key: string,
  expected: { size: number; contentType: string },
) {
  let object: Awaited<ReturnType<typeof statLocalObject>>;
  try {
    object = await statLocalObject(key);
  } catch {
    throw new Error("Unable to verify uploaded object.");
  }
  if (!object) {
    throw new InvalidUploadedAssetError("Uploaded object was not found.");
  }
  if (object.size > getMaxImageUploadBytes()) {
    await deleteLocalObject(key);
    throw new InvalidUploadedAssetError(
      "Uploaded object exceeds the maximum upload size.",
    );
  }
  if (
    object.size !== expected.size ||
    !object.contentType ||
    object.contentType.toLowerCase() !== expected.contentType.toLowerCase()
  ) {
    throw new InvalidUploadedAssetError(
      "Uploaded object does not match the declared size and content type.",
    );
  }
  return { size: object.size, contentType: object.contentType };
}

/**
 * Throws when uploads are off or S3 is misconfigured. Returns the S3
 * settings, or null when the local store is in use.
 */
export function assertStorageConfigured(): StorageConfig | null {
  if (usesLocalStorage()) return null;
  return getStorageConfig();
}

/** The largest file an upload may carry (S3_MAX_IMAGE_UPLOAD_BYTES). */
export function maxUploadBytes() {
  return getMaxImageUploadBytes();
}

export function assertTaskImageKeyMatchesContext(
  key: string,
  context: Omit<TaskImageUploadContext, "filename" | "contentType">,
) {
  const objectPrefix = buildObjectKeyPrefix(context);
  const fullPrefix = `${applyKeyPrefix(activeKeyPrefix(), objectPrefix)}/`;

  if (!key.startsWith(fullPrefix)) {
    return false;
  }

  // The prefix alone is not enough: gateways that normalize paths would let
  // a traversal suffix walk back out into another workspace's objects.
  const suffix = key.slice(fullPrefix.length);
  return /^[A-Za-z0-9._-]+$/.test(suffix) && !suffix.startsWith(".");
}

export async function getPrivateObject(key: string): Promise<AssetObject> {
  if (usesLocalStorage()) return readLocalObject(key);
  const config = getStorageConfig();
  const client = getClient(config);
  const response = await client.send(
    new GetObjectCommand({
      Bucket: config.bucket,
      Key: key,
    }),
  );

  if (!response.Body) {
    throw new Error("Storage object body is missing.");
  }

  const body =
    "transformToWebStream" in response.Body
      ? response.Body.transformToWebStream()
      : Readable.toWeb(response.Body as Readable);

  return {
    body,
    contentType: response.ContentType,
    contentLength: response.ContentLength,
    etag: response.ETag,
    lastModified: response.LastModified,
  };
}

/**
 * Duplicates an object inside the bucket with one CopyObject request, so the
 * bytes never pass through the API. Provider errors are replaced, because
 * they may carry endpoints or signed URLs.
 */
export async function copyS3Object(
  sourceKey: string,
  destinationKey: string,
): Promise<void> {
  if (usesLocalStorage()) {
    try {
      await copyLocalObject(sourceKey, destinationKey);
    } catch {
      throw new Error("Unable to copy the stored object.");
    }
    return;
  }
  const config = getStorageConfig();
  const client = getClient(config);
  const encodedSource = sourceKey
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  try {
    await client.send(
      new CopyObjectCommand({
        Bucket: config.bucket,
        Key: destinationKey,
        CopySource: `${config.bucket}/${encodedSource}`,
      }),
      { abortSignal: AbortSignal.timeout(30_000) },
    );
  } catch {
    throw new Error("Unable to copy the stored object.");
  }
}

export async function deleteS3Object(key: string): Promise<void> {
  if (usesLocalStorage()) return deleteLocalObject(key);
  const config = getStorageConfig();
  const client = getClient(config);
  await client.send(
    new DeleteObjectCommand({
      Bucket: config.bucket,
      Key: key,
    }),
  );
}

/** `key` with S3_KEY_PREFIX applied, for objects the server writes itself. */
export function buildPrivateObjectKey(key: string): string {
  return applyKeyPrefix(activeKeyPrefix(), key);
}

/**
 * Uploads a server-generated file (never public, never presigned). `key`
 * is the full key, S3_KEY_PREFIX included. Provider errors are replaced,
 * because they may carry endpoints or signed URLs.
 */
export async function putPrivateObject(
  key: string,
  body: Uint8Array,
  contentType: string,
): Promise<void> {
  if (usesLocalStorage()) {
    try {
      await writeLocalObject(key, body, {
        contentType,
        maxBytes: body.byteLength,
        overwrite: true,
      });
    } catch {
      throw new Error("Unable to store the object.");
    }
    return;
  }
  const config = getStorageConfig();
  const client = getClient(config);
  try {
    await client.send(
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        ContentLength: body.byteLength,
      }),
      { abortSignal: AbortSignal.timeout(120_000) },
    );
  } catch {
    throw new Error("Unable to store the object.");
  }
}

/**
 * `putPrivateObject` for a file on disk too large to hold in memory, streamed
 * in one PUT (so at most 5 GB). The timeout allows for a slow link.
 */
export async function putPrivateObjectFromFile(
  key: string,
  filePath: string,
  size: number,
  contentType: string,
): Promise<void> {
  try {
    if (usesLocalStorage()) {
      await writeLocalObject(key, Readable.toWeb(createReadStream(filePath)), {
        contentType,
        maxBytes: size,
        expectedSize: size,
        overwrite: true,
      });
      return;
    }
    const config = getStorageConfig();
    await getClient(config).send(
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: key,
        Body: createReadStream(filePath),
        ContentType: contentType,
        ContentLength: size,
      }),
      { abortSignal: AbortSignal.timeout(60 * 60 * 1000) },
    );
  } catch {
    throw new Error("Unable to store the object.");
  }
}
