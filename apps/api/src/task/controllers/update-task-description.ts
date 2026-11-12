import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { type AiAssistInput, nextAiProvenance } from "../../ai/provenance";
import db from "../../database";
import { taskTable } from "../../database/schema";
import { publishEvent } from "../../events";
import { syncMentions } from "../../mention/sync";
import { deleteOrphanedAssets } from "../../storage/cleanup-assets";
import { recordDescriptionVersion } from "../../task-description-version/track";
import { withAssigneeIds } from "../assignees";

async function updateTaskDescription({
  id,
  description,
  currentUserId,
  forceNewVersion = false,
  ai,
}: {
  id: string;
  description: string;
  currentUserId: string;
  /** The request's workspace and its AI claim, for the AI content label. */
  ai?: { workspaceId?: string; assist?: AiAssistInput };
  /** A restore: always a new history version, never merged into one. */
  forceNewVersion?: boolean;
}) {
  const existingTask = await db.query.taskTable.findFirst({
    where: eq(taskTable.id, id),
  });

  if (!existingTask) {
    throw new HTTPException(404, {
      message: "Task not found",
    });
  }

  const aiProvenance = await nextAiProvenance({
    existing: existingTask.aiProvenance,
    changed: (existingTask.description ?? "") !== description,
    workspaceId: ai?.workspaceId,
    userId: currentUserId,
    assist: ai?.assist,
  });

  const [updatedTask] = await db
    .update(taskTable)
    .set({
      description,
      ...(aiProvenance !== undefined ? { aiProvenance } : {}),
    })
    .where(eq(taskTable.id, id))
    .returning();

  if (!updatedTask) {
    throw new HTTPException(500, {
      message: "Failed to update task description",
    });
  }

  await recordDescriptionVersion({
    taskId: updatedTask.id,
    previous: existingTask.description,
    previousSavedAt: existingTask.updatedAt,
    next: description,
    authorId: currentUserId,
    forceNew: forceNewVersion,
  }).catch((error) => {
    console.error("Failed to record a description version:", error);
  });

  await publishEvent("task.description_changed", {
    taskId: updatedTask.id,
    projectId: updatedTask.projectId,
    userId: currentUserId,
    oldDescription: existingTask.description,
    newDescription: description,
    type: "description_changed",
  });

  deleteOrphanedAssets(existingTask.description, description, {
    taskId: id,
  }).catch(() => {});

  // Indexes the description's mentions; members this edit newly mentions
  // (not the editor) are subscribed and notified.
  await syncMentions({
    taskId: updatedTask.id,
    commentId: null,
    previous: existingTask.description,
    next: description,
    actorId: currentUserId,
    mode: "interactive",
  });

  return withAssigneeIds(updatedTask);
}

export default updateTaskDescription;
