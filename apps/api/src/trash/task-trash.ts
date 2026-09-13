import { and, eq, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import {
  columnTable,
  projectTable,
  taskRelationTable,
  taskTable,
} from "../database/schema";
import { publishEvent } from "../events";
import { withAssigneeIds } from "../task/assignees";
import { entryColumn, PLANNED_STATUS } from "../task/scope";
import { MAX_RELATION_WALK } from "../task-relation/checks";
import { hardDeleteTasks } from "./hard-delete";

// Task trash (C7). Deleting a task stamps `deletedAt`/`deletedBy` on it and
// on its live sub-tasks (every level), all sharing `trashBatchId` = the
// deleted task's id. Restoring or purging works on that batch, so sub-tasks
// deleted on their own earlier keep their own batch. Comments, relations,
// attachments and time entries stay untouched until a purge.

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export const PROJECT_IN_TRASH_MESSAGE =
  "This task's project is in the trash. Restore the project first.";
export const DELETED_WITH_PARENT_MESSAGE =
  "This task was deleted together with its parent task. Restore the parent task instead.";

export type TrashedTaskEvent = {
  taskId: string;
  projectId: string;
  title: string;
  status: string;
  trashBatchId: string;
};

/**
 * The live sub-tasks below the roots, any depth, roots excluded. Walks at
 * most MAX_RELATION_WALK tasks, so a corrupt graph can't run away.
 */
async function liveDescendants(
  tx: Transaction,
  rootIds: string[],
): Promise<Map<string, string>> {
  if (rootIds.length === 0) return new Map();
  const result = await tx.execute<{ task_id: string; root_id: string }>(sql`
    with recursive below(task_id, root_id) as (
      select r.target_task_id, r.source_task_id
      from ${taskRelationTable} r
      join ${taskTable} t on t.id = r.target_task_id
      where r.relation_type = 'subtask'
        and r.source_task_id in (${sql.join(
          rootIds.map((id) => sql`${id}`),
          sql`, `,
        )})
        and t.deleted_at is null
      union
      select r.target_task_id, below.root_id
      from ${taskRelationTable} r
      join below on r.source_task_id = below.task_id
      join ${taskTable} t on t.id = r.target_task_id
      where r.relation_type = 'subtask' and t.deleted_at is null
    )
    select task_id, root_id from below limit ${MAX_RELATION_WALK}
  `);
  const byTask = new Map<string, string>();
  for (const row of result.rows) {
    if (!byTask.has(row.task_id)) byTask.set(row.task_id, row.root_id);
  }
  return byTask;
}

/**
 * Moves live tasks and their live sub-tasks to the trash. A requested task
 * that is a sub-task of another requested task joins that task's batch.
 * Publishes task.deleted for every trashed task (its meaning is "moved to
 * the trash"). Returns the trashed rows, roots first.
 */
export async function trashTasks(taskIds: string[], userId: string | null) {
  const requested = [...new Set(taskIds)];
  if (requested.length === 0) return [];
  const now = new Date();

  const trashed = await db.transaction(async (tx) => {
    const roots = await tx
      .select({ id: taskTable.id })
      .from(taskTable)
      .where(and(inArray(taskTable.id, requested), isNull(taskTable.deletedAt)))
      .for("update");
    const rootIds = roots.map((row) => row.id);
    // Each task maps to the requested task it hangs under; a requested task
    // below another requested task joins that one's batch.
    const below = await liveDescendants(tx, rootIds);
    const batchOf = (id: string): string => {
      let current = id;
      for (let hops = 0; hops < 64; hops++) {
        const up = below.get(current);
        if (!up || up === current) return current;
        current = up;
      }
      return current;
    };

    const byBatch = new Map<string, string[]>();
    for (const id of new Set([...rootIds, ...below.keys()])) {
      const batch = batchOf(id);
      byBatch.set(batch, [...(byBatch.get(batch) ?? []), id]);
    }

    const rows: (typeof taskTable.$inferSelect)[] = [];
    for (const [batch, ids] of byBatch) {
      const updated = await tx
        .update(taskTable)
        .set({ deletedAt: now, deletedBy: userId, trashBatchId: batch })
        .where(and(inArray(taskTable.id, ids), isNull(taskTable.deletedAt)))
        .returning();
      rows.push(...updated);
    }
    return rows.sort(
      (a, b) =>
        Number(b.id === b.trashBatchId) - Number(a.id === a.trashBatchId),
    );
  });

  for (const task of trashed) {
    await publishEvent("task.deleted", {
      taskId: task.id,
      projectId: task.projectId,
      userId,
      title: task.title,
      // Lets integrations skip a request deleted while still in intake.
      status: task.status,
      trashBatchId: task.trashBatchId,
      type: "deleted",
    });
  }
  return trashed;
}

/** Trashes one live task with its sub-tasks; 404 when it is not live. */
export async function trashTask(taskId: string, userId: string) {
  const [root] = (await trashTasks([taskId], userId)).filter(
    (task) => task.id === taskId,
  );
  if (!root) throw new HTTPException(404, { message: "Task not found" });
  return withAssigneeIds(root);
}

async function loadTrashedTask(taskId: string) {
  const [task] = await db
    .select({
      task: taskTable,
      projectDeletedAt: projectTable.deletedAt,
      workspaceId: projectTable.workspaceId,
    })
    .from(taskTable)
    .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
    .where(and(eq(taskTable.id, taskId), isNotNull(taskTable.deletedAt)))
    .limit(1);
  if (!task) {
    throw new HTTPException(404, { message: "Task not found in the trash" });
  }
  return task;
}

/**
 * Where restored tasks land: their own column when it still exists (by
 * slug, which is what the board reads), `planned` stays planned, anything
 * else goes to the project's entry column, else planned.
 */
async function landingFor(
  tx: Transaction,
  projectId: string,
): Promise<(status: string) => { status: string; columnId: string | null }> {
  const columns = await tx
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
  const bySlug = new Map(columns.map((column) => [column.slug, column]));
  const entry = entryColumn(columns);
  return (status) => {
    if (status === PLANNED_STATUS) return { status, columnId: null };
    const own = bySlug.get(status);
    if (own) return { status: own.slug, columnId: own.id };
    return entry
      ? { status: entry.slug, columnId: entry.id }
      : { status: PLANNED_STATUS, columnId: null };
  };
}

/**
 * Restores the tasks of one batch inside a project, putting each back in its
 * column (or the entry column when that is gone). Returns the restored rows.
 */
export async function restoreBatch(
  tx: Transaction,
  projectId: string,
  batchId: string,
) {
  const members = await tx
    .select({ id: taskTable.id, status: taskTable.status })
    .from(taskTable)
    .where(
      and(
        eq(taskTable.trashBatchId, batchId),
        eq(taskTable.projectId, projectId),
        isNotNull(taskTable.deletedAt),
      ),
    )
    .for("update");
  if (members.length === 0) return [];
  const land = await landingFor(tx, projectId);
  const byLanding = new Map<
    string,
    { columnId: string | null; ids: string[] }
  >();
  for (const member of members) {
    const landing = land(member.status);
    const entry = byLanding.get(landing.status) ?? {
      columnId: landing.columnId,
      ids: [],
    };
    entry.ids.push(member.id);
    byLanding.set(landing.status, entry);
  }
  const restored: (typeof taskTable.$inferSelect)[] = [];
  for (const [status, { columnId, ids }] of byLanding) {
    const rows = await tx
      .update(taskTable)
      .set({
        deletedAt: null,
        deletedBy: null,
        trashBatchId: null,
        status,
        columnId,
      })
      .where(inArray(taskTable.id, ids))
      .returning();
    restored.push(...rows);
  }
  return restored;
}

export async function publishRestored(
  tasks: (typeof taskTable.$inferSelect)[],
  userId: string | null,
  batchId: string,
) {
  for (const task of tasks) {
    await publishEvent("task.restored", {
      taskId: task.id,
      projectId: task.projectId,
      userId,
      title: task.title,
      status: task.status,
      trashBatchId: batchId,
      type: "restored",
    });
  }
}

/**
 * Restores a trashed task and the sub-tasks deleted with it. Blocked while
 * its project is in the trash, and for a sub-task that went with its parent.
 */
export async function restoreTrashedTask(taskId: string, userId: string) {
  const { task, projectDeletedAt } = await loadTrashedTask(taskId);
  if (projectDeletedAt || task.trashBatchId === task.projectId) {
    throw new HTTPException(409, { message: PROJECT_IN_TRASH_MESSAGE });
  }
  if (task.trashBatchId && task.trashBatchId !== task.id) {
    throw new HTTPException(409, { message: DELETED_WITH_PARENT_MESSAGE });
  }
  const batchId = task.trashBatchId ?? task.id;
  const restored = await db.transaction(async (tx) => {
    // The project must still be live when the rows flip back.
    const [project] = await tx
      .select({ deletedAt: projectTable.deletedAt })
      .from(projectTable)
      .where(eq(projectTable.id, task.projectId))
      .for("share");
    if (!project || project.deletedAt) {
      throw new HTTPException(409, { message: PROJECT_IN_TRASH_MESSAGE });
    }
    return restoreBatch(tx, task.projectId, batchId);
  });
  await publishRestored(restored, userId, batchId);
  const root = restored.find((row) => row.id === taskId);
  if (!root) throw new HTTPException(404, { message: "Task not found" });
  return withAssigneeIds(root);
}

/**
 * Permanently deletes a trashed task and the sub-tasks deleted with it.
 * A sub-task that went with its parent is purged with the parent.
 */
export async function purgeTrashedTask(taskId: string, userId: string | null) {
  const { task } = await loadTrashedTask(taskId);
  if (task.trashBatchId && task.trashBatchId !== task.id) {
    throw new HTTPException(409, {
      message:
        "This task was deleted together with its parent task. Delete the parent task permanently instead.",
    });
  }
  const members = await db
    .select({ id: taskTable.id })
    .from(taskTable)
    .where(
      and(
        isNotNull(taskTable.deletedAt),
        eq(taskTable.projectId, task.projectId),
        eq(taskTable.trashBatchId, task.trashBatchId ?? task.id),
      ),
    );
  const ids = [...new Set([task.id, ...members.map((member) => member.id)])];
  await hardDeleteTasks(ids, userId);
  return withAssigneeIds({ ...task });
}

/**
 * Permanently deletes every task in a live project's trash. Returns how many
 * tasks were deleted.
 */
export async function emptyProjectTrash(
  projectId: string,
  userId: string | null,
) {
  const rows = await db
    .select({ id: taskTable.id })
    .from(taskTable)
    .where(
      and(eq(taskTable.projectId, projectId), isNotNull(taskTable.deletedAt)),
    );
  const ids = rows.map((row) => row.id);
  await hardDeleteTasks(ids, userId);
  return ids.length;
}
