import { HTTPException } from "hono/http-exception";
import { publishEvent } from "../../events";
import { hardDeleteLiveTask } from "../../trash/hard-delete";
import { INTAKE_ITEM_DELETED, type IntakeItemDeletedEvent } from "../events";
import { isOpenIntakeStatus } from "../status";
import { requireIntakeItem } from "./shared";

export const ACCEPTED_NOT_DELETABLE =
  "Accepted requests are tasks now. Delete the task instead.";
export const DELETE_FORBIDDEN =
  "Only admins or the requester can delete this request";

/**
 * Deletes a request and its task permanently (assets, relations,
 * task.deleted, task.purged): requests skip the trash, which only holds
 * board tasks. The FK cascade removes the request row. Needs task:delete,
 * or the requester withdrawing an open request.
 */
export async function deleteIntakeItem({
  itemId,
  workspaceId,
  userId,
  canDeleteTasks,
  canCreateIntake,
}: {
  itemId: string;
  workspaceId: string;
  userId: string;
  canDeleteTasks: boolean;
  canCreateIntake: boolean;
}) {
  const item = await requireIntakeItem(itemId);
  if (item.status === "accepted") {
    throw new HTTPException(409, { message: ACCEPTED_NOT_DELETABLE });
  }
  const withdrawing =
    item.submittedBy?.id === userId &&
    canCreateIntake &&
    isOpenIntakeStatus(item.status);
  if (!canDeleteTasks && !withdrawing) {
    throw new HTTPException(403, { message: DELETE_FORBIDDEN });
  }

  if (!(await hardDeleteLiveTask(item.taskId, userId))) {
    throw new HTTPException(404, { message: "Task not found" });
  }

  const deleted: IntakeItemDeletedEvent = {
    intakeItemId: item.id,
    taskId: item.taskId,
    projectId: item.projectId,
    workspaceId,
    userId,
  };
  await publishEvent(INTAKE_ITEM_DELETED, deleted);

  return { id: item.id, taskId: item.taskId, projectId: item.projectId };
}
