import { and, eq, getTableColumns } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { taskReminderSentTable, taskTable } from "../../database/schema";
import { publishEvent } from "../../events";
import { validateDateRange } from "../../utils/validate-dates";
import { withAssigneeIds } from "../assignees";
import { boardDescription, descriptionDeferred } from "../description-pages";
import { liveTaskCondition } from "../scope";

const returnedColumns = {
  ...getTableColumns(taskTable),
  description: boardDescription,
  descriptionDeferred,
};

function sameInstant(a: Date | null, b: Date | null) {
  return (a?.getTime() ?? null) === (b?.getTime() ?? null);
}

/**
 * What a schedule drag writes: the start and due dates together, and nothing
 * else, so a stale board cannot undo a newer edit. A date left undefined
 * keeps its stored value. The row is locked while the range is checked, so
 * the check sees the dates the write lands on.
 */
async function updateTaskDates({
  id,
  startDate,
  dueDate,
  currentUserId,
}: {
  id: string;
  startDate: Date | null | undefined;
  dueDate: Date | null | undefined;
  currentUserId: string;
}) {
  const { before, task } = await db.transaction(async (tx) => {
    const [before] = await tx
      .select(returnedColumns)
      .from(taskTable)
      .where(and(eq(taskTable.id, id), liveTaskCondition))
      .for("update");
    if (!before) throw new HTTPException(404, { message: "Task not found" });

    const nextStart = startDate === undefined ? before.startDate : startDate;
    const nextDue = dueDate === undefined ? before.dueDate : dueDate;
    validateDateRange(nextStart, nextDue);

    const dueChanged = !sameInstant(before.dueDate, nextDue);
    if (sameInstant(before.startDate, nextStart) && !dueChanged) {
      return { before, task: before };
    }
    // A new due date must trigger fresh reminders.
    if (dueChanged) {
      await tx
        .delete(taskReminderSentTable)
        .where(eq(taskReminderSentTable.taskId, id));
    }
    const [task] = await tx
      .update(taskTable)
      .set({ startDate: nextStart, dueDate: nextDue })
      .where(eq(taskTable.id, id))
      .returning(returnedColumns);
    if (!task) {
      throw new HTTPException(500, { message: "Failed to update task dates" });
    }
    return { before, task };
  });

  if (task !== before) {
    await publishEvent("task.updated", {
      taskId: task.id,
      projectId: task.projectId,
      title: task.title,
      status: task.status,
      userId: currentUserId,
    });
  }
  if (!sameInstant(before.startDate, task.startDate)) {
    await publishEvent("task.start_date_changed", {
      taskId: task.id,
      projectId: task.projectId,
      userId: currentUserId,
      oldStartDate: before.startDate,
      newStartDate: task.startDate,
      title: task.title,
      type: "start_date_changed",
    });
  }
  if (!sameInstant(before.dueDate, task.dueDate)) {
    await publishEvent("task.due_date_changed", {
      taskId: task.id,
      projectId: task.projectId,
      userId: currentUserId,
      oldDueDate: before.dueDate,
      newDueDate: task.dueDate,
      title: task.title,
      type: "due_date_changed",
    });
  }

  return withAssigneeIds(task);
}

export default updateTaskDates;
