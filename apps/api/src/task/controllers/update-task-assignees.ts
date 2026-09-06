import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { taskTable } from "../../database/schema";
import {
  normalizeAssigneeIds,
  patchTarget,
  resolvePatchAssignees,
} from "../assignee-rules";
import {
  changeTaskAssignees,
  publishAssigneeChanges,
} from "../assignee-writes";

/**
 * Moves one task to the assignees `target` computes from its current ones,
 * then publishes the per-user events. Returns the task with `assigneeIds`,
 * read in the same transaction. No effective change writes and publishes
 * nothing.
 */
export async function writeTaskAssignees({
  taskId,
  currentUserId,
  target,
}: {
  taskId: string;
  currentUserId: string;
  target: (current: string[]) => readonly string[];
}) {
  const { change, task } = await db.transaction(async (tx) => {
    const change = await changeTaskAssignees(tx, taskId, target);
    const [task] = await tx
      .select()
      .from(taskTable)
      .where(eq(taskTable.id, taskId))
      .limit(1);
    if (!task) throw new HTTPException(404, { message: "Task not found" });
    return { change, task };
  });

  await publishAssigneeChanges({ changes: [change], userId: currentUserId });

  return { ...task, assigneeIds: change.after };
}

/** `PUT /task/assignees/{id}`: the complete list; [] unassigns everyone. */
export async function setTaskAssigneesController({
  id,
  assigneeIds,
  currentUserId,
}: {
  id: string;
  assigneeIds: string[];
  currentUserId: string;
}) {
  const target = normalizeAssigneeIds(assigneeIds);
  return writeTaskAssignees({
    taskId: id,
    currentUserId,
    target: () => target,
  });
}

/** `PATCH /task/assignees/{id}`: removals first, then additions. */
export async function updateTaskAssigneesController({
  id,
  add,
  remove,
  currentUserId,
}: {
  id: string;
  add?: string[];
  remove?: string[];
  currentUserId: string;
}) {
  const lists = resolvePatchAssignees({ add, remove });
  return writeTaskAssignees({
    taskId: id,
    currentUserId,
    target: (current) => patchTarget(current, lists),
  });
}
