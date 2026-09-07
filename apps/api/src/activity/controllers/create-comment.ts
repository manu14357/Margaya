import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  activityTable,
  projectTable,
  taskTable,
  userTable,
  workspaceUserTable,
} from "../../database/schema";
import { publishEvent } from "../../events";
import { syncMentions } from "../../mention/sync";
import { notifyTaskEvent } from "../../notification/recipients";
import { subscribeUsers } from "../../subscription/service";
import { plainTextPreview } from "../../utils/plain-text-preview";

export type CommentVisibility = "internal" | "public";
export type CommentOrigin = "app" | "public_board";

export type CreateCommentOptions = {
  /** B12 K10: internal by default; public comments show on the board. */
  visibility?: CommentVisibility;
  origin?: CommentOrigin;
  /** Public board comments are never parsed for mentions (K15). */
  parseMentions?: boolean;
};

async function isWorkspaceMemberOfTask(taskId: string, userId: string) {
  const [membership] = await db
    .select({ userId: workspaceUserTable.userId })
    .from(taskTable)
    .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
    .innerJoin(
      workspaceUserTable,
      and(
        eq(workspaceUserTable.workspaceId, projectTable.workspaceId),
        eq(workspaceUserTable.userId, userId),
      ),
    )
    .where(eq(taskTable.id, taskId))
    .limit(1);
  return Boolean(membership);
}

async function createComment(
  taskId: string,
  userId: string,
  content: string,
  external?: { userName: string; source: string },
  {
    visibility = "internal",
    origin = "app",
    parseMentions = true,
  }: CreateCommentOptions = {},
) {
  const [activity] = await db
    .insert(activityTable)
    .values({
      taskId,
      type: "comment",
      userId,
      content,
      visibility,
      ...(external
        ? {
            externalUserName: external.userName,
            externalSource: external.source,
          }
        : {}),
    })
    .returning();

  if (!activity) {
    throw new HTTPException(500, {
      message: "Failed to create activity",
    });
  }

  const [user] = await db
    .select({ name: userTable.name })
    .from(userTable)
    .where(eq(userTable.id, userId));

  const [task] = await db
    .select({ projectId: taskTable.projectId })
    .from(taskTable)
    .where(eq(taskTable.id, taskId));

  if (task) {
    await publishEvent("comment.created", {
      ...activity,
      comment: `**${user?.name}** commented:\n> ${content}`,
      projectId: task.projectId,
      visibility,
      origin,
    });
  }

  // Inline and awaited, so notifications exist when the request returns.
  // An imported comment is attributed to someone outside Margaya: the
  // importing member does not start watching the task.
  // Outsiders commenting on a public board don't start watching: they
  // couldn't receive the notifications anyway (B12 §3.9).
  if (
    !external &&
    (origin === "app" || (await isWorkspaceMemberOfTask(taskId, userId)))
  ) {
    await subscribeUsers(taskId, [userId], "commenter");
  }

  // Indexes the comment's mentions, subscribes and notifies the newly
  // mentioned members; they get the mention instead of the comment.
  const mentioned = parseMentions
    ? await syncMentions({
        taskId,
        commentId: activity.id,
        previous: null,
        next: content,
        actorId: userId,
        mode: "interactive",
      })
    : [];

  // Every watcher (assignees and subscribers) hears about the comment,
  // except the author, muted users and anyone the mention already notified.
  await notifyTaskEvent({
    taskId,
    kind: "comment",
    actorId: userId,
    excludeIds: mentioned,
    eventData: {
      commenterName: user?.name ?? null,
      commentId: activity.id,
      commentPreview: plainTextPreview(content),
    },
  });

  return activity;
}

export default createComment;
