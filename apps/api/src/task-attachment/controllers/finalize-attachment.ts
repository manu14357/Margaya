import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { assetTable, taskTable } from "../../database/schema";
import { publishEvent } from "../../events";
import { deleteS3Keys } from "../../storage/cleanup-assets";
import {
  assertStorageConfigured,
  assertTaskImageKeyMatchesContext,
  InvalidUploadedAssetError,
  isImageContentType,
  validateTaskAssetUploadInput,
  verifyTaskAssetUpload,
} from "../../storage/s3";
import {
  normalizeAttachmentContentType,
  sanitizeAttachmentFilename,
} from "../filename";
import {
  ATTACHMENT_CAP_MESSAGE,
  ATTACHMENT_NOT_FOUND,
  ATTACHMENT_SURFACE,
  countAttachments,
  isBelowAttachmentCap,
  KEY_MISMATCH,
  loadAttachmentTaskContext,
  selectAttachments,
  toTaskAttachment,
  UPLOADS_NOT_CONFIGURED,
} from "../queries";

async function assetByKey(objectKey: string) {
  const [asset] = await db
    .select({
      id: assetTable.id,
      taskId: assetTable.taskId,
      surface: assetTable.surface,
    })
    .from(assetTable)
    .where(eq(assetTable.objectKey, objectKey))
    .limit(1);
  return asset ?? null;
}

async function readAttachment(assetId: string, apiBaseUrl: string) {
  const [row] = await selectAttachments(eq(assetTable.id, assetId));
  if (!row) throw new HTTPException(404, { message: ATTACHMENT_NOT_FOUND });
  return toTaskAttachment(row, apiBaseUrl);
}

/**
 * A key finalized before answers with the same attachment, so a retry is
 * harmless; a key recorded for another task or surface is refused.
 */
async function answerRetry(
  asset: { id: string; taskId: string | null; surface: string },
  taskId: string,
  apiBaseUrl: string,
) {
  if (asset.taskId !== taskId || asset.surface !== ATTACHMENT_SURFACE) {
    throw new HTTPException(400, { message: KEY_MISMATCH });
  }
  return readAttachment(asset.id, apiBaseUrl);
}

type Insert =
  | { status: "inserted"; id: string }
  | { status: "conflict" }
  | { status: "full" };

/**
 * Records an uploaded file as a panel attachment, after checking that its
 * key belongs to this task and that storage holds exactly the declared file.
 */
async function finalizeAttachment({
  taskId,
  userId,
  key,
  filename,
  contentType,
  size,
  apiBaseUrl,
}: {
  taskId: string;
  userId: string;
  key: string;
  filename: string;
  contentType: string;
  size: number;
  apiBaseUrl: string;
}) {
  const name = sanitizeAttachmentFilename(filename);
  const type = normalizeAttachmentContentType(contentType);
  try {
    validateTaskAssetUploadInput(type, size);
  } catch (error) {
    throw new HTTPException(400, {
      message: error instanceof Error ? error.message : "Invalid upload",
    });
  }

  const context = await loadAttachmentTaskContext(taskId);
  try {
    assertStorageConfigured();
  } catch {
    throw new HTTPException(503, { message: UPLOADS_NOT_CONFIGURED });
  }

  const objectKey = key.trim();
  const keyMatches = assertTaskImageKeyMatchesContext(objectKey, {
    workspaceId: context.workspaceId,
    projectId: context.projectId,
    taskId: context.taskId,
    surface: ATTACHMENT_SURFACE,
  });
  if (!keyMatches) throw new HTTPException(400, { message: KEY_MISMATCH });

  const recorded = await assetByKey(objectKey);
  if (recorded) return answerRetry(recorded, taskId, apiBaseUrl);

  let uploaded: Awaited<ReturnType<typeof verifyTaskAssetUpload>>;
  try {
    uploaded = await verifyTaskAssetUpload(objectKey, {
      size,
      contentType: type,
    });
  } catch (error) {
    if (error instanceof InvalidUploadedAssetError) {
      throw new HTTPException(400, { message: error.message });
    }
    throw new HTTPException(503, {
      message: "Unable to verify uploaded object.",
    });
  }

  const insert = await db.transaction(async (tx): Promise<Insert> => {
    // The task row lock serializes finalizes, so two uploads that both
    // passed the early check can't both take the last slot.
    const [task] = await tx
      .select({ id: taskTable.id })
      .from(taskTable)
      .where(eq(taskTable.id, taskId))
      .for("update");
    if (!task) throw new HTTPException(404, { message: "Task not found" });
    // A concurrent finalize of the same key may have committed meanwhile;
    // it must answer as a retry, never count as a new file.
    const [sameKey] = await tx
      .select({ id: assetTable.id })
      .from(assetTable)
      .where(eq(assetTable.objectKey, objectKey))
      .limit(1);
    if (sameKey) return { status: "conflict" };
    if (!isBelowAttachmentCap(await countAttachments(taskId, tx))) {
      return { status: "full" };
    }

    const [row] = await tx
      .insert(assetTable)
      .values({
        workspaceId: context.workspaceId,
        projectId: context.projectId,
        taskId,
        objectKey,
        filename: name,
        mimeType: uploaded.contentType,
        size: uploaded.size,
        kind: isImageContentType(uploaded.contentType) ? "image" : "attachment",
        surface: ATTACHMENT_SURFACE,
        createdBy: userId,
      })
      .onConflictDoNothing({ target: assetTable.objectKey })
      .returning({ id: assetTable.id });
    return row ? { status: "inserted", id: row.id } : { status: "conflict" };
  });

  if (insert.status === "full") {
    // Nothing will ever reference this object.
    await deleteS3Keys([objectKey]);
    throw new HTTPException(400, { message: ATTACHMENT_CAP_MESSAGE });
  }
  if (insert.status === "conflict") {
    // A concurrent finalize of the same key won the insert.
    const winner = await assetByKey(objectKey);
    if (!winner) throw new HTTPException(400, { message: KEY_MISMATCH });
    return answerRetry(winner, taskId, apiBaseUrl);
  }

  await publishEvent("task.attachment_added", {
    taskId,
    projectId: context.projectId,
    userId,
    attachmentId: insert.id,
    filename: name,
    size: uploaded.size,
    mimeType: uploaded.contentType,
  });

  return readAttachment(insert.id, apiBaseUrl);
}

export default finalizeAttachment;
