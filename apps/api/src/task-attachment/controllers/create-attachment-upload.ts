import { HTTPException } from "hono/http-exception";
import {
  assertStorageConfigured,
  createTaskImageUploadUrl,
  validateTaskAssetUploadInput,
} from "../../storage/s3";
import {
  normalizeAttachmentContentType,
  sanitizeAttachmentFilename,
} from "../filename";
import {
  ATTACHMENT_SURFACE,
  assertBelowAttachmentCap,
  countAttachments,
  loadAttachmentTaskContext,
  UPLOADS_NOT_CONFIGURED,
} from "../queries";

/** Validates an upload and returns a presigned PUT for the file's bytes. */
async function createAttachmentUpload({
  taskId,
  filename,
  contentType,
  size,
}: {
  taskId: string;
  filename: string;
  contentType: string;
  size: number;
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
  // Checked early for a quick answer; finalize re-checks under the lock.
  assertBelowAttachmentCap(await countAttachments(taskId));

  try {
    assertStorageConfigured();
    return await createTaskImageUploadUrl({
      workspaceId: context.workspaceId,
      projectId: context.projectId,
      taskId: context.taskId,
      surface: ATTACHMENT_SURFACE,
      filename: name,
      contentType: type,
      size,
    });
  } catch {
    // The storage error can name the configuration; never echo it.
    throw new HTTPException(503, { message: UPLOADS_NOT_CONFIGURED });
  }
}

export default createAttachmentUpload;
