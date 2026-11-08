import { and, eq, inArray, ne, or, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  projectTable,
  taskRelationTable,
  taskTable,
} from "../../database/schema";
import {
  hiddenForCurrentRequest,
  notHiddenProject,
} from "../../project/visibility";
import { liveTaskCondition } from "../../task/scope";
import {
  assertNotInTriage,
  assertParentRules,
  CHAIN_TOO_LONG_MESSAGE,
  CIRCULAR_MESSAGE,
  HIDDEN_LINK_MESSAGE,
  type LockedRelationTask,
  lockRelationGraph,
  lockRelationTasks,
  relationWalkReaches,
  snapshotOfLocked,
  type Transaction,
} from "../checks";
import { publishRelationEvent } from "../events";
import {
  isDirectionalRelationType,
  normalizeRelationInput,
  type RelationInputName,
  type StoredRelation,
} from "../types";

export const MAX_TASK_RELATIONS = 200;
const RELATION_EXISTS = "This relation already exists";

async function workspaceTaskIds(taskIds: string[], workspaceId: string) {
  const rows = await db
    .select({ id: taskTable.id })
    .from(taskTable)
    .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
    .where(
      and(
        inArray(taskTable.id, taskIds),
        eq(projectTable.workspaceId, workspaceId),
        // A trashed task can't be linked (C7).
        liveTaskCondition,
        // Nor one in a restricted project the caller cannot see.
        notHiddenProject(
          projectTable.id,
          await hiddenForCurrentRequest(workspaceId),
        ),
      ),
    );
  return new Set(rows.map((row) => row.id));
}

/** A child has one parent; a second one is a change, not an addition. */
async function assertCanAddParent(
  tx: Transaction,
  parent: LockedRelationTask,
  child: LockedRelationTask,
  workspaceId: string,
) {
  const parents = await tx
    .select({ sourceTaskId: taskRelationTable.sourceTaskId })
    .from(taskRelationTable)
    .where(
      and(
        eq(taskRelationTable.targetTaskId, child.id),
        eq(taskRelationTable.relationType, "subtask"),
      ),
    );
  if (parents.some((row) => row.sourceTaskId === parent.id)) {
    throw new HTTPException(409, { message: RELATION_EXISTS });
  }
  if (parents.length > 0) {
    throw new HTTPException(409, {
      message: "This task already has a parent. Change the parent instead.",
    });
  }
  await assertParentRules(tx, { child, parent, workspaceId });
}

/**
 * One non-subtask relation per pair (either direction), at most 200 per
 * task, and no loop of the same directional type.
 */
async function assertCanRelate(
  tx: Transaction,
  stored: StoredRelation,
  workspaceId: string,
) {
  const a = stored.sourceTaskId;
  const b = stored.targetTaskId;
  const pair = await tx
    .select({ relationType: taskRelationTable.relationType })
    .from(taskRelationTable)
    .where(
      and(
        ne(taskRelationTable.relationType, "subtask"),
        or(
          and(
            eq(taskRelationTable.sourceTaskId, a),
            eq(taskRelationTable.targetTaskId, b),
          ),
          and(
            eq(taskRelationTable.sourceTaskId, b),
            eq(taskRelationTable.targetTaskId, a),
          ),
        ),
      ),
    );
  if (pair.some((row) => row.relationType === stored.relationType)) {
    throw new HTTPException(409, { message: RELATION_EXISTS });
  }
  if (pair.length > 0) {
    throw new HTTPException(409, {
      message:
        "These tasks are already related. Remove the existing relation first.",
    });
  }

  const [counts] = await tx
    .select({
      first:
        sql<number>`count(*) filter (where ${taskRelationTable.sourceTaskId} = ${a} or ${taskRelationTable.targetTaskId} = ${a})`.mapWith(
          Number,
        ),
      second:
        sql<number>`count(*) filter (where ${taskRelationTable.sourceTaskId} = ${b} or ${taskRelationTable.targetTaskId} = ${b})`.mapWith(
          Number,
        ),
    })
    .from(taskRelationTable)
    .where(
      and(
        ne(taskRelationTable.relationType, "subtask"),
        or(
          inArray(taskRelationTable.sourceTaskId, [a, b]),
          inArray(taskRelationTable.targetTaskId, [a, b]),
        ),
      ),
    );
  if (
    (counts?.first ?? 0) >= MAX_TASK_RELATIONS ||
    (counts?.second ?? 0) >= MAX_TASK_RELATIONS
  ) {
    throw new HTTPException(400, {
      message: `A task can have at most ${MAX_TASK_RELATIONS} relations`,
    });
  }

  if (isDirectionalRelationType(stored.relationType)) {
    const walkFromTarget = {
      startId: b,
      targetId: a,
      relationType: stored.relationType,
      direction: "down",
      workspaceId,
    } as const;
    const walk = await relationWalkReaches(tx, walkFromTarget);
    if (walk === "clear") return;

    // The loop is refused either way, but saying why would reveal a chain
    // through tasks the caller can't see. Only what they can see gets named.
    const hidden = await hiddenForCurrentRequest(workspaceId);
    const seen =
      hidden.length === 0
        ? walk
        : await relationWalkReaches(tx, {
            ...walkFromTarget,
            skipProjectIds: hidden,
          });
    if (seen === "found") {
      throw new HTTPException(400, { message: CIRCULAR_MESSAGE });
    }
    if (seen === "too_long") {
      throw new HTTPException(400, { message: CHAIN_TOO_LONG_MESSAGE });
    }
    throw new HTTPException(400, { message: HIDDEN_LINK_MESSAGE });
  }
}

async function createTaskRelation({
  sourceTaskId,
  targetTaskId,
  relationType,
  userId,
  workspaceId,
}: {
  sourceTaskId: string;
  targetTaskId: string;
  relationType: RelationInputName;
  userId: string;
  workspaceId: string;
}) {
  const stored = normalizeRelationInput({
    sourceTaskId,
    targetTaskId,
    relationType,
  });

  if (stored.sourceTaskId === stored.targetTaskId) {
    throw new HTTPException(400, {
      message: "Cannot create a relation between a task and itself",
    });
  }

  // Messages name the request's roles, before any flip.
  const notFound = (taskId: string) =>
    new HTTPException(404, {
      message:
        taskId === sourceTaskId
          ? "Source task not found"
          : "Target task not found",
    });

  const found = await workspaceTaskIds(
    [sourceTaskId, targetTaskId],
    workspaceId,
  );
  if (!found.has(sourceTaskId)) throw notFound(sourceTaskId);
  if (!found.has(targetTaskId)) throw notFound(targetTaskId);

  const { relation, snapshots } = await db.transaction(async (tx) => {
    await lockRelationGraph(tx, workspaceId);
    const locked = await lockRelationTasks(tx, [
      stored.sourceTaskId,
      stored.targetTaskId,
    ]);
    const source = locked.get(stored.sourceTaskId);
    const target = locked.get(stored.targetTaskId);
    if (!source || source.workspaceId !== workspaceId) {
      throw notFound(stored.sourceTaskId);
    }
    if (!target || target.workspaceId !== workspaceId) {
      throw notFound(stored.targetTaskId);
    }
    assertNotInTriage(source, target);

    if (stored.relationType === "subtask") {
      await assertCanAddParent(tx, source, target, workspaceId);
    } else {
      await assertCanRelate(tx, stored, workspaceId);
    }

    const [relation] = await tx
      .insert(taskRelationTable)
      .values(stored)
      .returning();
    if (!relation) {
      throw new HTTPException(500, {
        message: "Failed to create task relation",
      });
    }
    return {
      relation,
      snapshots: new Map([
        [source.id, snapshotOfLocked(source)],
        [target.id, snapshotOfLocked(target)],
      ]),
    };
  });

  await publishRelationEvent("task-relation.created", {
    relation,
    userId,
    origin: "user",
    snapshots,
  });

  return relation;
}

export default createTaskRelation;
