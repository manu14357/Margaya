import { and, eq, ne } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  columnTable,
  intakeItemTable,
  projectTable,
  taskTable,
} from "../../database/schema";
import { publishEvent } from "../../events";
import { projectDefaultAssignee } from "../../project/people";
import { changeTaskAssignees } from "../../task/assignee-writes";
import { assigneesOfTask } from "../../task/assignees";
import { nextTaskPosition } from "../../task/controllers/next-task-position";
import {
  ARCHIVED_STATUS,
  completedAtAssignment,
  PLANNED_STATUS,
  type TaskGroup,
} from "../../task/scope";
import { publishIntakeItemUpdated } from "../events";
import { assertTransition } from "../status";
import { lockIntakeItem, requireIntakeItem, triageUpdate } from "./shared";

export const CHOOSE_COLUMN = "Choose a column or the backlog";
export const COLUMN_NOT_FOUND = "Column not found";

type Target = {
  slug: string;
  columnId: string | null;
  name: string | null;
  group: TaskGroup;
};

async function resolveTarget(projectId: string, status: string) {
  if (status === ARCHIVED_STATUS) {
    throw new HTTPException(400, { message: CHOOSE_COLUMN });
  }
  if (status === PLANNED_STATUS) {
    return {
      slug: PLANNED_STATUS,
      columnId: null,
      name: null,
      group: "backlog",
    } satisfies Target;
  }
  const [column] = await db
    .select({
      id: columnTable.id,
      slug: columnTable.slug,
      name: columnTable.name,
      group: columnTable.group,
    })
    .from(columnTable)
    .where(
      and(
        eq(columnTable.projectId, projectId),
        eq(columnTable.slug, status),
        ne(columnTable.group, "triage"),
      ),
    )
    .limit(1);
  if (!column) throw new HTTPException(400, { message: COLUMN_NOT_FOUND });
  return {
    slug: column.slug,
    columnId: column.id,
    name: column.name,
    group: column.group,
  } satisfies Target;
}

/**
 * Accepts a request: its task moves to the end of the chosen column (or the
 * backlog), `completedAt` follows the column group, an unassigned task gets
 * the project's default assignee, and the board hears task.created (source
 * intake) for the first time. Needs neither
 * task:create nor custom fields (K9, K15).
 */
export async function acceptIntakeItem({
  itemId,
  projectId,
  workspaceId,
  userId,
  status,
}: {
  itemId: string;
  projectId: string;
  workspaceId: string;
  userId: string;
  status: string;
}) {
  const target = await resolveTarget(projectId, status);

  const { previousStatus, task } = await db.transaction(async (tx) => {
    const locked = await lockIntakeItem(tx, itemId);
    assertTransition(locked.status, "accept");

    // Serializes positions with task creates and moves, which lock the
    // project row when they claim a number.
    await tx
      .select({ id: projectTable.id })
      .from(projectTable)
      .where(eq(projectTable.id, projectId))
      .for("update");
    const position = await nextTaskPosition(
      tx,
      projectId,
      target.slug,
      target.columnId,
    );

    const [task] = await tx
      .update(taskTable)
      .set({
        status: target.slug,
        columnId: target.columnId,
        position,
        completedAt: completedAtAssignment(target.group, new Date()),
      })
      .where(eq(taskTable.id, locked.taskId))
      .returning();
    if (!task) throw new HTTPException(404, { message: "Task not found" });

    // A request nobody picked up goes to the project's default assignee.
    const defaultAssignee = await projectDefaultAssignee(projectId, tx);
    let accepted = task;
    if (defaultAssignee) {
      const change = await changeTaskAssignees(tx, task.id, (current) =>
        current.length > 0 ? current : [defaultAssignee],
      );
      if (change.changed) {
        accepted = { ...task, userId: change.firstAfter };
      }
    }

    await tx
      .update(intakeItemTable)
      .set(triageUpdate("accept", userId))
      .where(eq(intakeItemTable.id, itemId));

    return { previousStatus: locked.status, task: accepted };
  });

  const item = await requireIntakeItem(itemId);
  await publishIntakeItemUpdated({
    item,
    workspaceId,
    userId,
    action: "accepted",
    previousStatus,
    extras: { columnName: target.name, columnSlug: target.slug },
  });

  // The task is born for the board, integrations and assignees now. The
  // activity subscriber skips source intake: intake logs its own rows.
  const assigneeIds = await assigneesOfTask(task.id);
  await publishEvent("task.created", {
    ...task,
    taskId: task.id,
    userId: task.userId ?? "",
    assigneeIds,
    currentUserId: userId,
    type: "created",
    content: null,
    source: "intake",
  });

  return item;
}
