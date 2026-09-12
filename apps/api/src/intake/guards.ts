import { and, inArray, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import { taskTable } from "../database/schema";
import { inTriageColumnSql } from "../task/scope";

// Accepting is the only way out of triage (B7 K6). Ordinary writes that would
// move a task out of its triage column (status, full update, bulk status,
// archive, move to another project) call this first. It checks the column,
// so declined and duplicate requests are covered too.

export const TRIAGE_TASK_MESSAGE =
  "This task is waiting in intake. Accept it from the Intake tab to put it on the board.";
export const TRIAGE_TASKS_MESSAGE =
  "Some of these tasks are waiting in intake.";

/** The ids among `taskIds` whose task sits in a triage column. */
export async function triageTaskIds(
  taskIds: readonly string[],
): Promise<string[]> {
  if (taskIds.length === 0) return [];
  const rows = await db
    .select({ id: taskTable.id })
    .from(taskTable)
    .where(and(inArray(taskTable.id, [...taskIds]), sql`${inTriageColumnSql}`));
  return rows.map((row) => row.id);
}

/**
 * 409 when any of the tasks waits in intake. Bulk routes pass the plural
 * message, whatever the selection size.
 */
export async function assertTasksNotInTriage(
  taskIds: readonly string[],
  message: string = taskIds.length === 1
    ? TRIAGE_TASK_MESSAGE
    : TRIAGE_TASKS_MESSAGE,
): Promise<void> {
  const inTriage = await triageTaskIds(taskIds);
  if (inTriage.length === 0) return;
  throw new HTTPException(409, { message });
}
