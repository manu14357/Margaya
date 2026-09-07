import { and, asc, eq, inArray } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  projectTable,
  taskRelationTable,
  taskTable,
} from "../../database/schema";
import { publishEvent } from "../../events";
import { liveTaskCondition } from "../../task/scope";
import {
  loadTaskSnapshots,
  type TaskSnapshot,
} from "../../task-activity/task-snapshot";
import {
  assertParentRules,
  lockRelationGraph,
  lockRelationTasks,
  snapshotOfLocked,
} from "../checks";
import { publishRelationEvent, type RelationRow } from "../events";
import { loadRelatedTasks } from "../related-tasks";

const PARENT_NOT_FOUND = "Parent task not found";

async function parentExists(parentTaskId: string, workspaceId: string) {
  const [row] = await db
    .select({ id: taskTable.id })
    .from(taskTable)
    .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
    .where(
      and(
        eq(taskTable.id, parentTaskId),
        eq(projectTable.workspaceId, workspaceId),
        // A trashed task can't become a parent (C7).
        liveTaskCondition,
      ),
    )
    .limit(1);
  return Boolean(row);
}

type ParentChange =
  | { changed: false; parentId: string | null }
  | {
      changed: true;
      parentId: string | null;
      childProjectId: string;
      removed: RelationRow[];
      created: RelationRow | null;
      snapshots: Map<string, TaskSnapshot>;
    };

/**
 * Sets, changes or clears a task's parent in one transaction: every current
 * parent row goes (legacy data can hold several) and the new one is added.
 * Asking for the current single parent, or null without one, changes
 * nothing and publishes nothing.
 */
async function setTaskParent({
  taskId,
  parentTaskId,
  userId,
  workspaceId,
}: {
  taskId: string;
  parentTaskId: string | null;
  userId: string;
  workspaceId: string;
}) {
  // Parents of other workspaces look exactly like missing ones.
  if (
    parentTaskId !== null &&
    !(await parentExists(parentTaskId, workspaceId))
  ) {
    throw new HTTPException(404, { message: PARENT_NOT_FOUND });
  }

  const change = await db.transaction(async (tx): Promise<ParentChange> => {
    await lockRelationGraph(tx, workspaceId);
    const locked = await lockRelationTasks(
      tx,
      parentTaskId ? [taskId, parentTaskId] : [taskId],
    );
    const child = locked.get(taskId);
    if (!child || child.workspaceId !== workspaceId) {
      throw new HTTPException(404, { message: "Task not found" });
    }
    const parent = parentTaskId ? locked.get(parentTaskId) : undefined;
    if (parentTaskId && (!parent || parent.workspaceId !== workspaceId)) {
      throw new HTTPException(404, { message: PARENT_NOT_FOUND });
    }

    // Only parents inside the workspace; legacy foreign rows stay untouched.
    const current = await tx
      .select({
        id: taskRelationTable.id,
        sourceTaskId: taskRelationTable.sourceTaskId,
        targetTaskId: taskRelationTable.targetTaskId,
        relationType: taskRelationTable.relationType,
        createdAt: taskRelationTable.createdAt,
      })
      .from(taskRelationTable)
      .innerJoin(taskTable, eq(taskTable.id, taskRelationTable.sourceTaskId))
      .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
      .where(
        and(
          eq(taskRelationTable.targetTaskId, taskId),
          eq(taskRelationTable.relationType, "subtask"),
          eq(projectTable.workspaceId, workspaceId),
        ),
      )
      .orderBy(asc(taskRelationTable.createdAt), asc(taskRelationTable.id));

    const unchanged =
      parentTaskId === null
        ? current.length === 0
        : current.length === 1 && current[0]?.sourceTaskId === parentTaskId;
    if (unchanged) return { changed: false, parentId: parentTaskId };

    if (parent) await assertParentRules(tx, { child, parent, workspaceId });

    if (current.length > 0) {
      await tx.delete(taskRelationTable).where(
        inArray(
          taskRelationTable.id,
          current.map((row) => row.id),
        ),
      );
    }
    const [created] = parent
      ? await tx
          .insert(taskRelationTable)
          .values({
            sourceTaskId: parent.id,
            targetTaskId: child.id,
            relationType: "subtask",
          })
          .returning()
      : [];

    const snapshots = await loadTaskSnapshots(
      current.map((row) => row.sourceTaskId),
      tx,
    );
    snapshots.set(child.id, snapshotOfLocked(child));
    if (parent) snapshots.set(parent.id, snapshotOfLocked(parent));

    return {
      changed: true,
      parentId: parent?.id ?? null,
      childProjectId: child.projectId,
      removed: current,
      created: created ?? null,
      snapshots,
    };
  });

  if (change.changed) {
    for (const relation of change.removed) {
      await publishRelationEvent("task-relation.deleted", {
        relation,
        userId,
        origin: "parent_change",
        snapshots: change.snapshots,
      });
    }
    if (change.created) {
      await publishRelationEvent("task-relation.created", {
        relation: change.created,
        userId,
        origin: "parent_change",
        snapshots: change.snapshots,
      });
    }
    const oldParentId = change.removed[0]?.sourceTaskId ?? null;
    await publishEvent("task.parent_changed", {
      taskId,
      projectId: change.childProjectId,
      userId,
      oldParent: oldParentId
        ? (change.snapshots.get(oldParentId) ?? null)
        : null,
      newParent: change.parentId
        ? (change.snapshots.get(change.parentId) ?? null)
        : null,
      type: "parent_changed",
    });
  }

  const parentTask = change.parentId
    ? ((await loadRelatedTasks([change.parentId], workspaceId)).get(
        change.parentId,
      ) ?? null)
    : null;
  return { taskId, parent: parentTask };
}

export default setTaskParent;
