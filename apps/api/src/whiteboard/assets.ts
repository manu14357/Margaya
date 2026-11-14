import { createId } from "@paralleldrive/cuid2";
import { and, eq, inArray } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import { whiteboardAssetTable, whiteboardTable } from "../database/schema";
import { deleteS3Keys } from "../storage/cleanup-assets";
import {
  assertStorageConfigured,
  createWhiteboardAssetUploadUrl,
  deleteS3Object,
  getPrivateObject,
  InvalidUploadedAssetError,
  readObjectHead,
  validateTaskAssetUploadInput,
  verifyTaskAssetUpload,
  whiteboardAssetKey,
} from "../storage/s3";
import { recordPendingUpload } from "../storage/upload-sweep";
import {
  BOARD_IMAGE_TYPES,
  IMAGE_HEAD_BYTES,
  imagePixelSize,
  sniffImageType,
} from "./image-bytes";
import { WHITEBOARD_MESSAGES } from "./rules";
import type { WhiteboardRecord } from "./shared";

// Images on a board. The upload key is derived from the board and a fresh
// asset id, the upload is checked (size, declared type and the bytes
// themselves) before a row exists, and only PNG, JPEG, GIF and WebP are
// ever stored. Size limits are the page upload limits.

type UploadBoard = Pick<WhiteboardRecord, "id" | "workspaceId" | "projectId">;

const UPLOADS_OFF = "File uploads are not configured";

function uploadContext(board: UploadBoard, assetId: string) {
  return {
    workspaceId: board.workspaceId,
    projectId: board.projectId,
    whiteboardId: board.id,
    assetId,
  };
}

function assertUploadInput(contentType: string, size: number) {
  if (!(BOARD_IMAGE_TYPES as readonly string[]).includes(contentType)) {
    throw new HTTPException(400, {
      message: "Only PNG, JPEG, GIF and WebP images can go on a whiteboard",
    });
  }
  try {
    validateTaskAssetUploadInput(contentType, size);
  } catch (error) {
    throw new HTTPException(400, {
      message:
        error instanceof Error ? error.message : "Invalid upload request",
    });
  }
}

/** A fresh asset id and the URL to PUT its bytes to. */
export async function createWhiteboardAssetUpload(
  board: UploadBoard,
  input: { contentType: string; size: number },
) {
  assertUploadInput(input.contentType, input.size);
  const assetId = createId();
  try {
    const upload = await createWhiteboardAssetUploadUrl({
      ...uploadContext(board, assetId),
      contentType: input.contentType,
      size: input.size,
    });
    await recordPendingUpload(upload.key);
    return {
      assetId,
      upload: { uploadUrl: upload.uploadUrl, headers: upload.headers },
    };
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(503, {
      message: error instanceof Error ? error.message : UPLOADS_OFF,
    });
  }
}

/** Verifies the uploaded bytes and records the image. */
export async function finalizeWhiteboardAsset(
  board: UploadBoard,
  assetId: string,
  input: {
    contentType: string;
    size: number;
    width?: number;
    height?: number;
  },
  userId: string,
) {
  assertUploadInput(input.contentType, input.size);
  try {
    assertStorageConfigured();
  } catch (error) {
    throw new HTTPException(503, {
      message: error instanceof Error ? error.message : UPLOADS_OFF,
    });
  }
  if (!/^[a-z0-9]{8,64}$/.test(assetId)) {
    throw new HTTPException(404, {
      message: WHITEBOARD_MESSAGES.assetNotFound,
    });
  }
  const [existing] = await db
    .select()
    .from(whiteboardAssetTable)
    .where(eq(whiteboardAssetTable.id, assetId))
    .limit(1);
  if (existing) {
    if (existing.whiteboardId !== board.id) {
      throw new HTTPException(404, {
        message: WHITEBOARD_MESSAGES.assetNotFound,
      });
    }
    return existing;
  }

  const key = whiteboardAssetKey(uploadContext(board, assetId));
  let uploaded: Awaited<ReturnType<typeof verifyTaskAssetUpload>>;
  try {
    uploaded = await verifyTaskAssetUpload(key, {
      size: input.size,
      contentType: input.contentType,
    });
  } catch (error) {
    const invalid = error instanceof InvalidUploadedAssetError;
    throw new HTTPException(invalid ? 400 : 503, {
      message: invalid ? error.message : "Unable to verify uploaded object.",
    });
  }

  let head: Uint8Array;
  try {
    head = await readObjectHead(key, IMAGE_HEAD_BYTES);
  } catch {
    throw new HTTPException(503, {
      message: "Unable to verify uploaded object.",
    });
  }
  const actual = sniffImageType(head);
  if (actual === null || actual !== uploaded.contentType.toLowerCase()) {
    // The bytes are not the image they claim to be: nothing may serve them.
    await deleteS3Object(key).catch(() => {});
    throw new HTTPException(400, {
      message: "The file is not a PNG, JPEG, GIF or WebP image",
    });
  }
  const pixels = imagePixelSize(head, actual);

  const [asset] = await db
    .insert(whiteboardAssetTable)
    .values({
      id: assetId,
      whiteboardId: board.id,
      workspaceId: board.workspaceId,
      objectKey: key,
      mimeType: actual,
      size: uploaded.size,
      width: pixels?.width ?? input.width ?? null,
      height: pixels?.height ?? input.height ?? null,
      createdById: userId,
    })
    .onConflictDoNothing()
    .returning();
  if (asset) return asset;
  const [raced] = await db
    .select()
    .from(whiteboardAssetTable)
    .where(
      and(
        eq(whiteboardAssetTable.id, assetId),
        eq(whiteboardAssetTable.whiteboardId, board.id),
      ),
    )
    .limit(1);
  if (!raced)
    throw new HTTPException(500, { message: "Failed to save the image" });
  return raced;
}

/** The image row of this board, or 404. */
export async function boardAsset(whiteboardId: string, assetId: string) {
  const [asset] = await db
    .select()
    .from(whiteboardAssetTable)
    .where(
      and(
        eq(whiteboardAssetTable.id, assetId),
        eq(whiteboardAssetTable.whiteboardId, whiteboardId),
      ),
    )
    .limit(1);
  if (!asset) {
    throw new HTTPException(404, {
      message: WHITEBOARD_MESSAGES.assetNotFound,
    });
  }
  return asset;
}

/** Streams a stored board image; only the four raster types are ever served. */
export async function streamBoardAsset(
  asset: Pick<
    typeof whiteboardAssetTable.$inferSelect,
    "objectKey" | "mimeType"
  >,
  cacheControl: string,
): Promise<Response> {
  if (!(BOARD_IMAGE_TYPES as readonly string[]).includes(asset.mimeType)) {
    throw new HTTPException(404, {
      message: WHITEBOARD_MESSAGES.assetNotFound,
    });
  }
  try {
    const object = await getPrivateObject(asset.objectKey);
    return new Response(object.body as BodyInit, {
      headers: {
        "Cache-Control": cacheControl,
        "Content-Disposition": "inline",
        "Content-Length": object.contentLength?.toString() || "",
        "Content-Type": asset.mimeType,
        "Content-Security-Policy": "default-src 'none'",
        "X-Content-Type-Options": "nosniff",
        ETag: object.etag || "",
      },
    });
  } catch {
    throw new HTTPException(404, {
      message: WHITEBOARD_MESSAGES.assetNotFound,
    });
  }
}

/** Storage keys of these boards' images, read before the rows cascade away. */
export async function boardAssetKeys(whiteboardIds: readonly string[]) {
  if (whiteboardIds.length === 0) return [];
  const rows = await db
    .select({ objectKey: whiteboardAssetTable.objectKey })
    .from(whiteboardAssetTable)
    .where(inArray(whiteboardAssetTable.whiteboardId, [...whiteboardIds]));
  return rows.map((row) => row.objectKey);
}

/** Storage keys of every board image in a project or a workspace. */
export async function projectBoardAssetKeys(projectId: string) {
  const rows = await db
    .select({ objectKey: whiteboardAssetTable.objectKey })
    .from(whiteboardAssetTable)
    .innerJoin(
      whiteboardTable,
      eq(whiteboardTable.id, whiteboardAssetTable.whiteboardId),
    )
    .where(eq(whiteboardTable.projectId, projectId));
  return rows.map((row) => row.objectKey);
}

export async function workspaceBoardAssetKeys(workspaceId: string) {
  const rows = await db
    .select({ objectKey: whiteboardAssetTable.objectKey })
    .from(whiteboardAssetTable)
    .where(eq(whiteboardAssetTable.workspaceId, workspaceId));
  return rows.map((row) => row.objectKey);
}

/** Best-effort removal of stored images after their rows were deleted. */
export async function deleteBoardAssetObjects(keys: readonly string[]) {
  for (let start = 0; start < keys.length; start += 50) {
    await deleteS3Keys(keys.slice(start, start + 50)).catch((error) => {
      console.error("Stored whiteboard images remain", error);
    });
  }
}
