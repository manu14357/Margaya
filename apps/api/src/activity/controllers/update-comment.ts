import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { type AiAssistInput, nextAiProvenance } from "../../ai/provenance";
import db from "../../database";
import { activityTable, taskTable } from "../../database/schema";
import { publishEvent } from "../../events";
import { syncMentions } from "../../mention/sync";
import { deleteOrphanedAssets } from "../../storage/cleanup-assets";

/**
 * Edits the caller's own comment. Public board edits pass
 * `parseMentions: false`: their text is never indexed for mentions (B12 K15).
 */
async function updateComment(
  userId: string,
  id: string,
  content: string,
  {
    parseMentions = true,
    origin = "app",
    aiAssist,
    workspaceId,
  }: {
    parseMentions?: boolean;
    origin?: "app" | "public_board";
    /** The caller accepted AI-written text (ai/provenance.ts). */
    aiAssist?: AiAssistInput;
    workspaceId?: string;
  } = {},
) {
  const [existing] = await db
    .select({
      id: activityTable.id,
      content: activityTable.content,
      taskId: activityTable.taskId,
      userId: activityTable.userId,
      aiProvenance: activityTable.aiProvenance,
    })
    .from(activityTable)
    .where(and(eq(activityTable.id, id), eq(activityTable.type, "comment")))
    .limit(1);

  if (!existing) {
    throw new HTTPException(404, { message: "Comment not found" });
  }
  // The route already checked the caller can see the comment's workspace,
  // so a comment they did not write is forbidden rather than hidden.
  if (existing.userId !== userId) {
    throw new HTTPException(403, {
      message: "Only the comment's author can edit it",
    });
  }

  const aiProvenance = await nextAiProvenance({
    existing: existing.aiProvenance,
    changed: existing.content !== content,
    workspaceId,
    userId,
    assist: aiAssist,
  });

  const [updated] = await db
    .update(activityTable)
    .set({
      content,
      ...(aiProvenance !== undefined ? { aiProvenance } : {}),
    })
    .where(
      and(
        eq(activityTable.id, id),
        eq(activityTable.userId, userId),
        eq(activityTable.type, "comment"),
      ),
    )
    .returning();

  if (!updated) {
    throw new HTTPException(404, { message: "Comment not found" });
  }

  const [task] = await db
    .select({ projectId: taskTable.projectId })
    .from(taskTable)
    .where(eq(taskTable.id, updated.taskId))
    .limit(1);

  if (task) {
    await publishEvent("comment.updated", {
      ...updated,
      projectId: task.projectId,
      userId,
      origin,
    });
  }

  // Only mentions this edit adds notify (and subscribe); the index follows
  // the new content. Edits send no comment notification.
  if (parseMentions) {
    await syncMentions({
      taskId: updated.taskId,
      commentId: updated.id,
      previous: existing.content,
      next: content,
      actorId: userId,
      mode: "interactive",
    });
  }

  deleteOrphanedAssets(existing.content, content, {
    taskId: existing.taskId,
  }).catch(() => {});

  return updated;
}

export default updateComment;
