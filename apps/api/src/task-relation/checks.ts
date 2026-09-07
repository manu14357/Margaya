import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import type db from "../database";
import { projectTable, taskRelationTable, taskTable } from "../database/schema";
import { inTriageColumnSql, liveTaskCondition } from "../task/scope";
import {
  formatTaskKey,
  type TaskSnapshot,
} from "../task-activity/task-snapshot";

export type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export const TRIAGE_LINK_MESSAGE = "Tasks waiting in intake can't be linked";
export const CIRCULAR_MESSAGE = "This would create a circular dependency";
export const CHAIN_TOO_LONG_MESSAGE =
  "This dependency chain is too long to check";
export const OWN_PARENT_MESSAGE = "A task can't be its own parent";
export const SAME_PROJECT_PARENT_MESSAGE =
  "The parent must be in the same project";
export const DESCENDANT_PARENT_MESSAGE =
  "A task can't be a subtask of its own subtask";

// pg_advisory_xact_lock class for a workspace's relation graph. Project
// ordering uses 1524, favorites 1525, module ordering 1526, estimates 1527.
const RELATION_GRAPH_LOCK = 1528;

// A walk that visits more tasks than this fails closed.
export const MAX_RELATION_WALK = 10_000;

/**
 * Serializes relation writes of one workspace, so two concurrent writes
 * can't each pass the loop check and close a loop together.
 */
export async function lockRelationGraph(tx: Transaction, workspaceId: string) {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(${RELATION_GRAPH_LOCK}, hashtext(${workspaceId}))`,
  );
}

export type LockedRelationTask = {
  id: string;
  projectId: string;
  title: string;
  number: number | null;
  slug: string;
  workspaceId: string;
  inTriage: boolean;
};

/** Locks the tasks (FOR UPDATE, ascending id); unknown and trashed ids are left out. */
export async function lockRelationTasks(
  tx: Transaction,
  taskIds: readonly string[],
): Promise<Map<string, LockedRelationTask>> {
  const rows = await tx
    .select({
      id: taskTable.id,
      projectId: taskTable.projectId,
      title: taskTable.title,
      number: taskTable.number,
      slug: projectTable.slug,
      workspaceId: projectTable.workspaceId,
      inTriage: inTriageColumnSql,
    })
    .from(taskTable)
    .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
    // Trashed tasks read as gone (C7), like unknown ids.
    .where(and(inArray(taskTable.id, [...new Set(taskIds)]), liveTaskCondition))
    .orderBy(asc(taskTable.id))
    .for("update", { of: taskTable });
  return new Map(
    rows.map((row) => [row.id, { ...row, inTriage: Boolean(row.inTriage) }]),
  );
}

export function snapshotOfLocked(task: LockedRelationTask): TaskSnapshot {
  return {
    id: task.id,
    key: formatTaskKey(task.slug, task.number),
    title: task.title,
    projectId: task.projectId,
  };
}

/**
 * Whether `targetId` is reachable from `startId` along `relationType` edges
 * inside the workspace: `down` follows source → target, `up` follows
 * target → source (a task's parents). The start itself counts as reached.
 * UNION keeps a visited set, so the walk ends on any graph, legacy loops
 * included; a walk past MAX_RELATION_WALK tasks answers `too_long`.
 */
export async function relationWalkReaches(
  tx: Transaction,
  {
    startId,
    targetId,
    relationType,
    direction,
    workspaceId,
  }: {
    startId: string;
    targetId: string;
    relationType: string;
    direction: "down" | "up";
    workspaceId: string;
  },
): Promise<"found" | "clear" | "too_long"> {
  const from =
    direction === "down"
      ? sql.raw("r.source_task_id")
      : sql.raw("r.target_task_id");
  const next =
    direction === "down"
      ? sql.raw("r.target_task_id")
      : sql.raw("r.source_task_id");

  const result = await tx.execute<{ found: boolean; visited: number }>(sql`
    with recursive reachable(task_id) as (
      select ${startId}::text
      union
      select ${next}
      from ${taskRelationTable} r
      join reachable on ${from} = reachable.task_id
      join ${taskTable} t on t.id = ${next}
      join ${projectTable} p on p.id = t.project_id
      where r.relation_type = ${relationType}
        and p.workspace_id = ${workspaceId}
    )
    select coalesce(bool_or(walked.task_id = ${targetId}), false) as found,
      count(*)::int as visited
    from (select task_id from reachable limit ${MAX_RELATION_WALK + 1}) walked
  `);

  const [row] = result.rows;
  if (row?.found) return "found";
  if (Number(row?.visited ?? 0) > MAX_RELATION_WALK) return "too_long";
  return "clear";
}

/** Refuses relations that touch a task waiting in intake. */
export function assertNotInTriage(...tasks: LockedRelationTask[]) {
  if (tasks.some((task) => task.inTriage)) {
    throw new HTTPException(400, { message: TRIAGE_LINK_MESSAGE });
  }
}

/**
 * The parent rules shared by `POST /task-relation` (subtask) and the parent
 * route: not itself, same project, not in intake, and not one of its own
 * descendants (every legacy parent is followed). No depth limit.
 */
export async function assertParentRules(
  tx: Transaction,
  {
    child,
    parent,
    workspaceId,
  }: {
    child: LockedRelationTask;
    parent: LockedRelationTask;
    workspaceId: string;
  },
) {
  if (child.id === parent.id) {
    throw new HTTPException(400, { message: OWN_PARENT_MESSAGE });
  }
  if (child.projectId !== parent.projectId) {
    throw new HTTPException(400, { message: SAME_PROJECT_PARENT_MESSAGE });
  }
  assertNotInTriage(child, parent);

  const walk = await relationWalkReaches(tx, {
    startId: parent.id,
    targetId: child.id,
    relationType: "subtask",
    direction: "up",
    workspaceId,
  });
  if (walk === "found") {
    throw new HTTPException(400, { message: DESCENDANT_PARENT_MESSAGE });
  }
  if (walk === "too_long") {
    throw new HTTPException(400, { message: CHAIN_TOO_LONG_MESSAGE });
  }
}
