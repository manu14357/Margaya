import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { taskTable } from "../../database/schema";
import updateTaskDescription from "../../task/controllers/update-task-description";
import updateTaskPriority from "../../task/controllers/update-task-priority";
import updateTaskTitle from "../../task/controllers/update-task-title";
import { publishIntakeItemUpdated } from "../events";
import { isOpenIntakeStatus } from "../status";
import { requireIntakeItem } from "./shared";

export const NOTHING_TO_UPDATE = "Provide a title, description or priority";
export const ONLY_REQUESTER_EDITS =
  "Only the requester can edit an open request";
export const REQUEST_CLOSED = "This request is closed";

/**
 * Edits a request's title, description or priority through the ordinary
 * task controllers, so activity, realtime and integrations behave exactly as
 * for task edits. Allowed with task:update, or for the requester (with
 * intake:create) while the request is open.
 */
export async function updateIntakeItem({
  itemId,
  workspaceId,
  userId,
  canUpdateTasks,
  canCreateIntake,
  input,
}: {
  itemId: string;
  workspaceId: string;
  userId: string;
  canUpdateTasks: boolean;
  canCreateIntake: boolean;
  input: { title?: string; description?: string; priority?: string };
}) {
  if (
    input.title === undefined &&
    input.description === undefined &&
    input.priority === undefined
  ) {
    throw new HTTPException(400, { message: NOTHING_TO_UPDATE });
  }

  const item = await requireIntakeItem(itemId);
  if (!canUpdateTasks) {
    const isRequester = item.submittedBy?.id === userId && canCreateIntake;
    if (!isRequester) {
      throw new HTTPException(403, { message: ONLY_REQUESTER_EDITS });
    }
    if (!isOpenIntakeStatus(item.status)) {
      throw new HTTPException(409, { message: REQUEST_CLOSED });
    }
  }

  const [task] = await db
    .select({ description: taskTable.description })
    .from(taskTable)
    .where(eq(taskTable.id, item.taskId))
    .limit(1);
  const current = { ...item.task, description: task?.description ?? "" };
  const id = item.taskId;

  if (input.title !== undefined && input.title !== current.title) {
    await updateTaskTitle({ id, title: input.title, currentUserId: userId });
  }
  if (
    input.description !== undefined &&
    input.description !== current.description
  ) {
    await updateTaskDescription({
      id,
      description: input.description,
      currentUserId: userId,
    });
  }
  if (input.priority !== undefined && input.priority !== current.priority) {
    await updateTaskPriority({
      id,
      priority: input.priority,
      currentUserId: userId,
    });
  }

  const updated = await requireIntakeItem(itemId);
  await publishIntakeItemUpdated({
    item: updated,
    workspaceId,
    userId,
    action: "edited",
    previousStatus: item.status,
  });
  return updated;
}
