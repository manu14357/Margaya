import { and, asc, eq, isNull, type SQL } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  activityTable,
  reactionTable,
  taskTable,
  userTable,
} from "../../database/schema";
import { publishEvent } from "../../events";
import {
  groupReactions,
  groupTaskReactions,
  isReactionEmoji,
  type ReactionEmoji,
  UNSUPPORTED_REACTION,
} from "../emoji";

// Reactions create no notifications and no activity rows (B10 K9). Adds
// and removes are idempotent; an event is published only for a real change.

type Target = {
  taskId: string;
  projectId: string;
  commentId: string | null;
};

function assertEmoji(value: string): ReactionEmoji {
  if (!isReactionEmoji(value)) {
    throw new HTTPException(400, { message: UNSUPPORTED_REACTION });
  }
  return value;
}

async function reactionRows(where: SQL) {
  return db
    .select({
      commentId: reactionTable.commentId,
      emoji: reactionTable.emoji,
      userId: reactionTable.userId,
      name: userTable.name,
      image: userTable.image,
      createdAt: reactionTable.createdAt,
    })
    .from(reactionTable)
    .innerJoin(userTable, eq(userTable.id, reactionTable.userId))
    .where(where)
    .orderBy(asc(reactionTable.createdAt), asc(reactionTable.id));
}

function targetCondition(target: Target): SQL {
  return target.commentId === null
    ? (and(
        eq(reactionTable.taskId, target.taskId),
        isNull(reactionTable.commentId),
      ) as SQL)
    : eq(reactionTable.commentId, target.commentId);
}

async function taskTarget(taskId: string): Promise<Target> {
  const [task] = await db
    .select({ projectId: taskTable.projectId })
    .from(taskTable)
    .where(eq(taskTable.id, taskId))
    .limit(1);
  if (!task) throw new HTTPException(404, { message: "Task not found" });
  return { taskId, projectId: task.projectId, commentId: null };
}

async function commentTarget(commentId: string): Promise<Target> {
  const [comment] = await db
    .select({ taskId: activityTable.taskId, projectId: taskTable.projectId })
    .from(activityTable)
    .innerJoin(taskTable, eq(taskTable.id, activityTable.taskId))
    .where(
      and(eq(activityTable.id, commentId), eq(activityTable.type, "comment")),
    )
    .limit(1);
  if (!comment) throw new HTTPException(404, { message: "Comment not found" });
  return { ...comment, commentId };
}

async function toggle(
  target: Target,
  emoji: ReactionEmoji,
  userId: string,
  add: boolean,
) {
  const changed = add
    ? await db
        .insert(reactionTable)
        .values({
          taskId: target.taskId,
          commentId: target.commentId,
          userId,
          emoji,
        })
        .onConflictDoNothing()
        .returning({ id: reactionTable.id })
    : await db
        .delete(reactionTable)
        .where(
          and(
            targetCondition(target),
            eq(reactionTable.userId, userId),
            eq(reactionTable.emoji, emoji),
          ),
        )
        .returning({ id: reactionTable.id });

  if (changed.length > 0) {
    await publishEvent(add ? "reaction.added" : "reaction.removed", {
      taskId: target.taskId,
      projectId: target.projectId,
      commentId: target.commentId,
      userId,
      emoji,
    });
  }
  return groupReactions(await reactionRows(targetCondition(target)), userId);
}

/** The task's and every comment's reactions, in one query. */
export async function getTaskReactions(taskId: string, userId: string) {
  return groupTaskReactions(
    await reactionRows(eq(reactionTable.taskId, taskId)),
    userId,
  );
}

export async function setTaskReaction(
  taskId: string,
  emojiKey: string,
  userId: string,
  add: boolean,
) {
  const emoji = assertEmoji(emojiKey);
  return toggle(await taskTarget(taskId), emoji, userId, add);
}

export async function setCommentReaction(
  commentId: string,
  emojiKey: string,
  userId: string,
  add: boolean,
) {
  const emoji = assertEmoji(emojiKey);
  return toggle(await commentTarget(commentId), emoji, userId, add);
}
