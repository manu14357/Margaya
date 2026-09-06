import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { assetTable } from "../../database/schema";
import { publishEvent } from "../../events";
import { deleteS3Keys } from "../../storage/cleanup-assets";
import { ATTACHMENT_NOT_FOUND, isTaskAttachment } from "../queries";

/**
 * Deletes a panel attachment: the uploader may (with task:update), anyone
 * else also needs task:delete. The stored object goes first (best effort,
 * failures are logged), then the row.
 */
async function deleteAttachment({
  taskId,
  attachmentId,
  userId,
  canDeleteTasks,
}: {
  taskId: string;
  attachmentId: string;
  userId: string;
  canDeleteTasks: () => Promise<boolean>;
}) {
  const [asset] = await db
    .select()
    .from(assetTable)
    .where(and(eq(assetTable.id, attachmentId), isTaskAttachment(taskId)))
    .limit(1);
  if (!asset) throw new HTTPException(404, { message: ATTACHMENT_NOT_FOUND });

  if (asset.createdBy !== userId && !(await canDeleteTasks())) {
    throw new HTTPException(403, {
      message:
        "Only the uploader or someone who can delete tasks can remove this attachment",
    });
  }

  await deleteS3Keys([asset.objectKey]);
  const [deleted] = await db
    .delete(assetTable)
    .where(eq(assetTable.id, asset.id))
    .returning({ id: assetTable.id });
  if (!deleted) throw new HTTPException(404, { message: ATTACHMENT_NOT_FOUND });

  await publishEvent("task.attachment_removed", {
    taskId,
    projectId: asset.projectId,
    userId,
    attachmentId: asset.id,
    filename: asset.filename,
    size: asset.size,
    mimeType: asset.mimeType,
  });

  return { id: asset.id };
}

export default deleteAttachment;
