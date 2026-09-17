import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import db from "../database";
import { activityTable, reactionTable } from "../database/schema";
import { voteCounts } from "../publication/votes";
import {
  groupReactions,
  isReactionEmoji,
  REACTION_EMOJI,
  type ReactionGroup,
} from "../reaction/emoji";
import type { PublicCounts } from "./query";
import type { ResolvedBoard } from "./types";

// Batched counts for public task rows (B12 §3.7): one grouped query per
// feature that is on, never per task.

const TOP_REACTIONS = 3;

/** The top task reactions per task (task-level only), ties by picker order. */
export async function topTaskReactions(taskIds: readonly string[]) {
  const result = new Map<string, { emoji: string; count: number }[]>();
  if (taskIds.length === 0) return result;
  const rows = await db
    .select({
      taskId: reactionTable.taskId,
      emoji: reactionTable.emoji,
      count: sql<number>`count(*)::int`,
    })
    .from(reactionTable)
    .where(
      and(
        inArray(reactionTable.taskId, [...taskIds]),
        isNull(reactionTable.commentId),
      ),
    )
    .groupBy(reactionTable.taskId, reactionTable.emoji);
  for (const row of rows) {
    if (!isReactionEmoji(row.emoji)) continue;
    const list = result.get(row.taskId) ?? [];
    list.push({ emoji: row.emoji, count: row.count });
    result.set(row.taskId, list);
  }
  for (const [taskId, list] of result) {
    list.sort(
      (a, b) =>
        b.count - a.count ||
        REACTION_EMOJI.indexOf(a.emoji as never) -
          REACTION_EMOJI.indexOf(b.emoji as never),
    );
    result.set(taskId, list.slice(0, TOP_REACTIONS));
  }
  return result;
}

/** Public comment counts per task (uses the partial index). */
export async function publicCommentCounts(taskIds: readonly string[]) {
  const result = new Map<string, number>();
  if (taskIds.length === 0) return result;
  const rows = await db
    .select({
      taskId: activityTable.taskId,
      count: sql<number>`count(*)::int`,
    })
    .from(activityTable)
    .where(
      and(
        inArray(activityTable.taskId, [...taskIds]),
        eq(activityTable.type, "comment"),
        eq(activityTable.visibility, "public"),
      ),
    )
    .groupBy(activityTable.taskId);
  for (const row of rows) result.set(row.taskId, row.count);
  return result;
}

/** The counts each row carries, only for the features the board has on. */
export async function boardRowCounts(
  board: Pick<ResolvedBoard, "settings">,
  taskIds: readonly string[],
): Promise<Map<string, PublicCounts>> {
  const { votesEnabled, reactionsEnabled, commentsEnabled } = board.settings;
  const [votes, reactions, comments] = await Promise.all([
    votesEnabled ? voteCounts(taskIds) : null,
    reactionsEnabled ? topTaskReactions(taskIds) : null,
    commentsEnabled ? publicCommentCounts(taskIds) : null,
  ]);
  return new Map(
    taskIds.map((id) => [
      id,
      {
        ...(votes ? { votes: votes.get(id) ?? { up: 0, down: 0 } } : {}),
        ...(reactions ? { reactions: reactions.get(id) ?? [] } : {}),
        ...(comments ? { comments: comments.get(id) ?? 0 } : {}),
      },
    ]),
  );
}

/** B10's groups without names: counts and whether the viewer reacted. */
export function publicReactionGroups(groups: readonly ReactionGroup[]) {
  return groups.map(({ emoji, count, reacted }) => ({ emoji, count, reacted }));
}

/** Reaction groups of several comments, for the viewer, in one query. */
export async function commentReactionGroups(
  commentIds: readonly string[],
  viewerId: string | null,
) {
  const result = new Map<string, ReturnType<typeof publicReactionGroups>>();
  if (commentIds.length === 0) return result;
  const rows = await db
    .select({
      commentId: reactionTable.commentId,
      emoji: reactionTable.emoji,
      userId: reactionTable.userId,
      createdAt: reactionTable.createdAt,
    })
    .from(reactionTable)
    .where(inArray(reactionTable.commentId, [...commentIds]))
    .orderBy(asc(reactionTable.createdAt), asc(reactionTable.id));
  const byComment = new Map<string, typeof rows>();
  for (const row of rows) {
    if (!row.commentId) continue;
    const list = byComment.get(row.commentId) ?? [];
    list.push(row);
    byComment.set(row.commentId, list);
  }
  for (const [commentId, list] of byComment) {
    result.set(
      commentId,
      publicReactionGroups(
        groupReactions(
          list.map((row) => ({ ...row, name: "", image: null })),
          viewerId ?? "",
        ),
      ),
    );
  }
  return result;
}

/** The task's own reaction groups, for the viewer. */
export async function taskReactionGroups(
  taskId: string,
  viewerId: string | null,
) {
  const rows = await db
    .select({
      commentId: reactionTable.commentId,
      emoji: reactionTable.emoji,
      userId: reactionTable.userId,
      createdAt: reactionTable.createdAt,
    })
    .from(reactionTable)
    .where(
      and(eq(reactionTable.taskId, taskId), isNull(reactionTable.commentId)),
    )
    .orderBy(asc(reactionTable.createdAt), asc(reactionTable.id));
  return publicReactionGroups(
    groupReactions(
      rows.map((row) => ({ ...row, name: "", image: null })),
      viewerId ?? "",
    ),
  );
}
