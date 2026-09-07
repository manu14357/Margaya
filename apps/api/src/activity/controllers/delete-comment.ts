import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { activityTable, taskTable } from "../../database/schema";
import { publishEvent } from "../../events";
import { deleteOrphanedAssets } from "../../storage/cleanup-assets";

/**
 * Deletes a comment. Only its author may, unless `asModerator`: a public
 * board moderator removing a public comment (B12 P8).
 */
async function deleteComment(
  userId: string,
  id: string,
  {
    asModerator = false,
    origin = "app",
  }: { asModerator?: boolean; origin?: "app" | "public_board" } = {},
) {
  const [existing] = await db
    .select({
      id: activityTable.id,
      content: activityTable.content,
      taskId: activityTable.taskId,
      userId: activityTable.userId,
    })
    .from(activityTable)
    .where(and(eq(activityTable.id, id), eq(activityTable.type, "comment")))
    .limit(1);

  if (!existing) {
    throw new HTTPException(404, { message: "Comment not found" });
  }
  // The route already checked the caller can see the comment's workspace,
  // so a comment they did not write is forbidden rather than hidden.
  if (!asModerator && existing.userId !== userId) {
    throw new HTTPException(403, {
      message: "Only the comment's author can delete it",
    });
  }

  const [deletedComment] = await db
    .delete(activityTable)
    .where(
      and(
        eq(activityTable.id, id),
        asModerator ? undefined : eq(activityTable.userId, userId),
        eq(activityTable.type, "comment"),
      ),
    )
    .returning();

  if (!deletedComment) {
    throw new HTTPException(404, { message: "Comment not found" });
  }

  const [task] = await db
    .select({ projectId: taskTable.projectId })
    .from(taskTable)
    .where(eq(taskTable.id, deletedComment.taskId))
    .limit(1);

  if (task) {
    await publishEvent("comment.deleted", {
      ...deletedComment,
      projectId: task.projectId,
      userId,
      origin,
    });
  }

  deleteOrphanedAssets(existing.content, null, {
    taskId: existing.taskId,
  }).catch(() => {});

  return deletedComment;
}

export default deleteComment;
