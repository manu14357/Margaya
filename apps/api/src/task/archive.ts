import { and, eq, isNotNull, isNull, ne, type SQL, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import { columnTable, taskTable } from "../database/schema";
import { publishEvent } from "../events";
import { assertTasksNotInTriage } from "../intake/guards";
import { withAssigneeIds } from "./assignees";
import {
  completedColumn,
  entryColumn,
  PLANNED_STATUS,
  type TaskGroup,
} from "./scope";

// D7 write-side helpers. Archiving sets `task.archived_at` and keeps the
// column, dates and completion; restoring clears it. Being archived is
// separate from the task's group.

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Reader = Pick<Transaction, "select">;

/** SET value that archives now, keeping an earlier archive time. */
export function archivedAtStamp(now: Date): SQL {
  // Encoded through the column, so the stamp is stored in UTC like every
  // other drizzle write (see completedAtAssignment in scope.ts).
  return sql`coalesce(${taskTable.archivedAt}, ${sql.param(now, taskTable.archivedAt)})`;
}

/**
 * SET value for echo-style status writes (the full update, integrations):
 * a different status restores an archived task, the same one keeps it
 * archived. Evaluated against the row before the update.
 */
export function archivedAtAfterStatusWrite(status: string): SQL {
  return sql`case when ${taskTable.status} = ${status} then ${taskTable.archivedAt} else null end`;
}

export type StatusLanding = {
  status: string;
  columnId: string | null;
  group: TaskGroup;
};

/**
 * Where a new task written with the legacy `archived` status lands: the
 * entry column (create), or the first completed column first (imports),
 * else `planned` when the project has no open column.
 */
export async function archivedTaskLanding(
  reader: Reader,
  projectId: string,
  prefer: "entry" | "completed",
): Promise<StatusLanding> {
  const columns = await reader
    .select({
      id: columnTable.id,
      slug: columnTable.slug,
      position: columnTable.position,
      group: columnTable.group,
    })
    .from(columnTable)
    .where(
      and(
        eq(columnTable.projectId, projectId),
        ne(columnTable.group, "triage"),
      ),
    );
  const column =
    (prefer === "completed" ? completedColumn(columns) : null) ??
    entryColumn(columns);
  return column
    ? { status: column.slug, columnId: column.id, group: column.group }
    : { status: PLANNED_STATUS, columnId: null, group: "backlog" };
}

type ArchivedTask = { id: string; projectId: string; title: string };

/** Publishes task.archived or task.unarchived (activity and realtime). */
export async function publishArchiveChange(
  archived: boolean,
  task: ArchivedTask,
  userId: string | null,
): Promise<void> {
  await publishEvent(archived ? "task.archived" : "task.unarchived", {
    taskId: task.id,
    projectId: task.projectId,
    userId,
    title: task.title,
    type: archived ? "archived" : "unarchived",
  });
}

/**
 * Archives or restores one task. A task already in that state is returned
 * unchanged and publishes nothing.
 */
export async function setTaskArchived({
  taskId,
  archived,
  userId,
}: {
  taskId: string;
  archived: boolean;
  userId: string;
}) {
  // Intake requests leave triage only by being accepted (B7).
  await assertTasksNotInTriage([taskId]);
  const [changed] = await db
    .update(taskTable)
    .set({ archivedAt: archived ? new Date() : null })
    .where(
      and(
        eq(taskTable.id, taskId),
        archived
          ? isNull(taskTable.archivedAt)
          : isNotNull(taskTable.archivedAt),
      ),
    )
    .returning();

  if (changed) {
    await publishArchiveChange(archived, changed, userId);
    return withAssigneeIds(changed);
  }

  const [task] = await db
    .select()
    .from(taskTable)
    .where(eq(taskTable.id, taskId))
    .limit(1);
  if (!task) throw new HTTPException(404, { message: "Task not found" });
  return withAssigneeIds(task);
}
