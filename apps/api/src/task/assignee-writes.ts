import { asc, eq, inArray, type SQL, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import {
  projectTable,
  taskAssigneeTable,
  taskTable,
  userTable,
} from "../database/schema";
import { publishEvent } from "../events";
import { assertAssignableUsers } from "../utils/assert-assignable-user";
import {
  type AssigneePlan,
  type AssigneeSlot,
  assertAssigneeLimit,
  planAssigneeChange,
} from "./assignee-rules";
import { assigneeOrderBy } from "./assignees";

// The only writers of `task_assignee` and of the `task.userId` mirror (the
// startup repair excepted). Every writer runs inside the caller's
// transaction, locks the task rows first (ascending id order, so concurrent
// writers serialize without deadlocking) and keeps the mirror equal to the
// first assignee. Callers publish the returned changes after the commit.

export type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

const WRITE_BATCH = 1000;

function chunk<T>(items: readonly T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += WRITE_BATCH) {
    out.push(items.slice(i, i + WRITE_BATCH));
  }
  return out;
}

/** A task locked for an assignee write. */
export type LockedTask = {
  id: string;
  projectId: string;
  title: string;
  workspaceId: string;
};

/** What one write did to one task, published after the commit. */
export type AssigneeChange = {
  taskId: string;
  projectId: string;
  title: string;
  before: string[];
  after: string[];
  added: string[];
  removed: string[];
  firstBefore: string | null;
  firstAfter: string | null;
  changed: boolean;
};

/** Locks the tasks (FOR UPDATE, ascending id); unknown ids are left out. */
export async function lockTasksForAssignees(
  tx: Transaction,
  taskIds: readonly string[],
): Promise<LockedTask[]> {
  const sorted = [...new Set(taskIds)].sort();
  const locked: LockedTask[] = [];
  for (const batch of chunk(sorted)) {
    locked.push(
      ...(await tx
        .select({
          id: taskTable.id,
          projectId: taskTable.projectId,
          title: taskTable.title,
          workspaceId: projectTable.workspaceId,
        })
        .from(taskTable)
        .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
        .where(inArray(taskTable.id, batch))
        .orderBy(asc(taskTable.id))
        .for("update", { of: taskTable })),
    );
  }
  return locked;
}

async function currentSlots(
  tx: Transaction,
  taskIds: readonly string[],
): Promise<Map<string, AssigneeSlot[]>> {
  const slots = new Map<string, AssigneeSlot[]>(taskIds.map((id) => [id, []]));
  for (const batch of chunk(taskIds)) {
    const rows = await tx
      .select({
        taskId: taskAssigneeTable.taskId,
        userId: taskAssigneeTable.userId,
        position: taskAssigneeTable.position,
      })
      .from(taskAssigneeTable)
      .where(inArray(taskAssigneeTable.taskId, batch))
      .orderBy(asc(taskAssigneeTable.taskId), ...assigneeOrderBy);
    for (const { taskId, ...slot } of rows) slots.get(taskId)?.push(slot);
  }
  return slots;
}

function toChange(task: LockedTask, plan: AssigneePlan): AssigneeChange {
  return {
    taskId: task.id,
    projectId: task.projectId,
    title: task.title,
    before: plan.before,
    after: plan.after,
    added: plan.added,
    removed: plan.removed,
    firstBefore: plan.firstBefore,
    firstAfter: plan.firstAfter,
    changed: plan.changed,
  };
}

/**
 * Moves locked tasks to the assignee lists `target` returns for their
 * current ids. Checks the limit (400) and that every newly added user is
 * assignable (403) before writing anything; keeping a former member is
 * allowed. Changed tasks get their mirror and `updatedAt` rewritten; an
 * unchanged task is not written at all. Returns one change per task.
 */
export async function applyAssigneeChanges(
  tx: Transaction,
  tasks: readonly LockedTask[],
  target: (task: LockedTask, current: string[]) => readonly string[],
): Promise<AssigneeChange[]> {
  const slots = await currentSlots(
    tx,
    tasks.map((task) => task.id),
  );
  const planned = tasks.map((task) => {
    const current = slots.get(task.id) ?? [];
    const plan = planAssigneeChange(
      current,
      target(
        task,
        current.map((slot) => slot.userId),
      ),
    );
    assertAssigneeLimit(plan);
    return { task, plan };
  });

  const addedByWorkspace = new Map<string, Set<string>>();
  for (const { task, plan } of planned) {
    const added = addedByWorkspace.get(task.workspaceId) ?? new Set();
    for (const userId of plan.added) added.add(userId);
    addedByWorkspace.set(task.workspaceId, added);
  }
  for (const [workspaceId, userIds] of addedByWorkspace) {
    await assertAssignableUsers([...userIds], workspaceId, tx);
  }

  const changing = planned.filter(({ plan }) => plan.changed);
  if (changing.length === 0) {
    return planned.map(({ task, plan }) => toChange(task, plan));
  }

  const removals = changing.flatMap(({ task, plan }) =>
    plan.removed.map((userId) => sql`(${task.id}, ${userId})`),
  );
  for (const batch of chunk(removals)) {
    await tx
      .delete(taskAssigneeTable)
      .where(
        sql`(${taskAssigneeTable.taskId}, ${taskAssigneeTable.userId}) in (${sql.join(batch, sql`, `)})`,
      );
  }

  const inserts = changing.flatMap(({ task, plan }) =>
    plan.insert.map((slot) => ({ taskId: task.id, ...slot })),
  );
  for (const batch of chunk(inserts)) {
    await tx
      .insert(taskAssigneeTable)
      .values(batch)
      .onConflictDoNothing({
        target: [taskAssigneeTable.taskId, taskAssigneeTable.userId],
      });
  }

  // One UPDATE per resulting first assignee. Drizzle also stamps updatedAt,
  // so assignee edits count as task updates even when the first stays.
  const tasksByFirst = new Map<string | null, string[]>();
  for (const { task, plan } of changing) {
    const ids = tasksByFirst.get(plan.firstAfter) ?? [];
    ids.push(task.id);
    tasksByFirst.set(plan.firstAfter, ids);
  }
  for (const [firstAfter, taskIds] of tasksByFirst) {
    for (const batch of chunk(taskIds)) {
      await tx
        .update(taskTable)
        .set({ userId: firstAfter })
        .where(inArray(taskTable.id, batch));
    }
  }

  return planned.map(({ task, plan }) => toChange(task, plan));
}

/** Locks one task and applies `target` to it; 404 when it is gone. */
export async function changeTaskAssignees(
  tx: Transaction,
  taskId: string,
  target: (current: string[]) => readonly string[],
): Promise<AssigneeChange> {
  const [task] = await lockTasksForAssignees(tx, [taskId]);
  if (!task) throw new HTTPException(404, { message: "Task not found" });
  const [change] = await applyAssigneeChanges(tx, [task], (_, current) =>
    target(current),
  );
  if (!change) throw new HTTPException(404, { message: "Task not found" });
  return change;
}

/** Replaces the assignees: people who stay keep their order. */
export function setTaskAssignees(
  tx: Transaction,
  taskId: string,
  userIds: readonly string[],
) {
  return changeTaskAssignees(tx, taskId, () => userIds);
}

/** Appends users who aren't assigned yet, in the given order. */
export function addTaskAssignees(
  tx: Transaction,
  taskId: string,
  userIds: readonly string[],
) {
  return changeTaskAssignees(tx, taskId, (current) => [...current, ...userIds]);
}

/** Removes these users; the next one up becomes first. */
export function removeTaskAssignees(
  tx: Transaction,
  taskId: string,
  userIds: readonly string[],
) {
  const removing = new Set(userIds);
  return changeTaskAssignees(tx, taskId, (current) =>
    current.filter((id) => !removing.has(id)),
  );
}

/**
 * Rows for a task just inserted by create or import, at positions 0..n-1.
 * The caller put `userIds[0]` into the task's `userId` on insert.
 */
export async function insertInitialAssignees(
  tx: Transaction,
  taskId: string,
  userIds: readonly string[],
) {
  if (userIds.length === 0) return;
  await tx
    .insert(taskAssigneeTable)
    .values(userIds.map((userId, position) => ({ taskId, userId, position })))
    .onConflictDoNothing({
      target: [taskAssigneeTable.taskId, taskAssigneeTable.userId],
    });
}

async function userNames(userIds: readonly string[]) {
  const names = new Map<string, string>();
  for (const batch of chunk([...new Set(userIds)])) {
    const rows = await db
      .select({ id: userTable.id, name: userTable.name })
      .from(userTable)
      .where(inArray(userTable.id, batch));
    for (const row of rows) names.set(row.id, row.name);
  }
  return names;
}

/**
 * After the commit: per changed task, one `task.unassigned` per removed
 * user (current order), then one `task.assignee_changed` per added user
 * (new order), then one `task-relation.refresh` per affected project.
 */
export async function publishAssigneeChanges({
  changes,
  userId,
}: {
  changes: readonly AssigneeChange[];
  /** The actor. */
  userId: string | undefined;
}) {
  const changed = changes.filter((change) => change.changed);
  if (changed.length === 0) return;

  const names = await userNames(
    changed.flatMap((change) => [...change.removed, ...change.added]),
  );

  for (const change of changed) {
    const shared = {
      taskId: change.taskId,
      projectId: change.projectId,
      userId,
      title: change.title,
      assigneeIds: change.after,
    };
    for (const removedId of change.removed) {
      await publishEvent("task.unassigned", {
        ...shared,
        type: "unassigned",
        oldAssigneeId: removedId,
        oldAssignee: names.get(removedId) ?? null,
      });
    }
    for (const addedId of change.added) {
      await publishEvent("task.assignee_changed", {
        ...shared,
        type: "assignee_changed",
        oldAssignee: change.firstBefore,
        newAssignee: names.get(addedId),
        newAssigneeId: addedId,
      });
    }
  }

  for (const projectId of new Set(changed.map((change) => change.projectId))) {
    await publishEvent("task-relation.refresh", { projectId, userId });
  }
}

/**
 * The first remaining assignee of the outer `t` task row, as raw SQL for
 * repairs that must not touch `updated_at`.
 */
export const firstAssigneeOfTaskSql: SQL = sql`(
  select ta.user_id from ${taskAssigneeTable} as ta
  where ta.task_id = t.id
  order by ta.position, ta.created_at, ta.user_id
  limit 1
)`;

/**
 * Account deletion: removes the user from every task and moves each
 * affected mirror to the next assignee (or null) in one transaction, before
 * the user row goes. Publishes nothing and leaves `updated_at` alone.
 * Returns how many tasks lost the user.
 */
export async function removeUserFromAllAssignments(
  userId: string,
): Promise<number> {
  return db.transaction(async (tx) => {
    const assigned = await tx
      .select({ taskId: taskAssigneeTable.taskId })
      .from(taskAssigneeTable)
      .where(eq(taskAssigneeTable.userId, userId));
    const taskIds = [...new Set(assigned.map((row) => row.taskId))].sort();
    if (taskIds.length === 0) return 0;

    for (const batch of chunk(taskIds)) {
      await tx
        .select({ id: taskTable.id })
        .from(taskTable)
        .where(inArray(taskTable.id, batch))
        .orderBy(asc(taskTable.id))
        .for("update");
    }

    await tx
      .delete(taskAssigneeTable)
      .where(eq(taskAssigneeTable.userId, userId));

    for (const batch of chunk(taskIds)) {
      await tx.execute(sql`
        update ${taskTable} as t
        set assignee_id = ${firstAssigneeOfTaskSql}
        where t.id in (${sql.join(
          batch.map((id) => sql`${id}`),
          sql`, `,
        )})
          and t.assignee_id is distinct from ${firstAssigneeOfTaskSql}
      `);
    }
    return taskIds.length;
  });
}
