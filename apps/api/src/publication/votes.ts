import { and, eq, inArray, sql } from "drizzle-orm";
import db from "../database";
import {
  projectPublicationTable,
  taskTable,
  taskVoteTable,
} from "../database/schema";
import { publishEvent } from "../events";

// Public board votes (B12 K11): one row per (task, account), +1 or -1. The
// score is ups minus downs.

export type VoteValue = 1 | -1;
export type VoteCounts = { up: number; down: number };

const voteAlias = sql.identifier("order_vote");
const voteColumn = (name: string) => sql`${voteAlias}.${sql.identifier(name)}`;

/** ups minus downs for the outer task (0 without votes): B4's `voteScore`. */
export const voteScoreSql = sql<number>`(
  select coalesce(sum(${voteColumn("value")}), 0)::int
  from ${taskVoteTable} as ${voteAlias}
  where ${voteColumn("task_id")} = ${taskTable.id}
)`;

/** Upvotes of the outer task, the `voteScore` tie-breaker. */
export const voteUpsSql = sql<number>`(
  select count(*)::int
  from ${taskVoteTable} as ${voteAlias}
  where ${voteColumn("task_id")} = ${taskTable.id} and ${voteColumn("value")} = 1
)`;

/** Up and down counts per task, in one grouped query. */
export async function voteCounts(
  taskIds: readonly string[],
): Promise<Map<string, VoteCounts>> {
  const counts = new Map<string, VoteCounts>();
  if (taskIds.length === 0) return counts;
  const rows = await db
    .select({
      taskId: taskVoteTable.taskId,
      up: sql<number>`count(*) filter (where ${taskVoteTable.value} = 1)::int`,
      down: sql<number>`count(*) filter (where ${taskVoteTable.value} = -1)::int`,
    })
    .from(taskVoteTable)
    .where(inArray(taskVoteTable.taskId, [...taskIds]))
    .groupBy(taskVoteTable.taskId);
  for (const row of rows)
    counts.set(row.taskId, { up: row.up, down: row.down });
  return counts;
}

export async function voteState(taskId: string, userId: string | null) {
  const counts = (await voteCounts([taskId])).get(taskId) ?? { up: 0, down: 0 };
  let mine: VoteValue | null = null;
  if (userId) {
    const [row] = await db
      .select({ value: taskVoteTable.value })
      .from(taskVoteTable)
      .where(
        and(eq(taskVoteTable.taskId, taskId), eq(taskVoteTable.userId, userId)),
      )
      .limit(1);
    mine = row ? (row.value as VoteValue) : null;
  }
  return { ...counts, mine };
}

type VoteTarget = { taskId: string; projectId: string; userId: string };

async function publishVoteChanged(target: VoteTarget, value: VoteValue | null) {
  const state = await voteState(target.taskId, target.userId);
  await publishEvent("task.vote_changed", {
    taskId: target.taskId,
    projectId: target.projectId,
    userId: target.userId,
    value,
    up: state.up,
    down: state.down,
  });
  return state;
}

/** Sets the caller's vote; the same value again changes nothing. */
export async function setVote(target: VoteTarget, value: VoteValue) {
  const changed = await db
    .insert(taskVoteTable)
    .values({ taskId: target.taskId, userId: target.userId, value })
    .onConflictDoUpdate({
      target: [taskVoteTable.taskId, taskVoteTable.userId],
      set: { value, updatedAt: new Date() },
      setWhere: sql`${taskVoteTable.value} <> ${value}`,
    })
    .returning({ taskId: taskVoteTable.taskId });
  if (changed.length === 0) return voteState(target.taskId, target.userId);
  return publishVoteChanged(target, value);
}

/** Removes the caller's vote; nothing to remove changes nothing. */
export async function removeVote(target: VoteTarget) {
  const removed = await db
    .delete(taskVoteTable)
    .where(
      and(
        eq(taskVoteTable.taskId, target.taskId),
        eq(taskVoteTable.userId, target.userId),
      ),
    )
    .returning({ taskId: taskVoteTable.taskId });
  if (removed.length === 0) return voteState(target.taskId, target.userId);
  return publishVoteChanged(target, null);
}

/** The in-app read-only summary (P12). */
export async function taskVoteSummary(taskId: string) {
  const [publication] = await db
    .select({ votesEnabled: projectPublicationTable.votesEnabled })
    .from(taskTable)
    .innerJoin(
      projectPublicationTable,
      eq(projectPublicationTable.projectId, taskTable.projectId),
    )
    .where(eq(taskTable.id, taskId))
    .limit(1);
  const counts = (await voteCounts([taskId])).get(taskId) ?? { up: 0, down: 0 };
  return {
    enabled: publication?.votesEnabled ?? false,
    up: counts.up,
    down: counts.down,
    score: counts.up - counts.down,
  };
}
