import { and, eq, isNotNull, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { HTTPException } from "hono/http-exception";
import { withAgentVia } from "../../ai-agent/attribution";
import { withAutomationMarker } from "../../automation-rule/context";
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
  /**
   * Reply to this comment of the same task. Threads are one level deep: a
   * reply to a reply joins its top-level comment's thread.
   */
  parentId?: string;
};

const PARENT_NOT_FOUND = "Parent comment not found";
export const PUBLIC_REPLY_NEEDS_PUBLIC_PARENT =
  "A reply can only be public when the comment it answers is public";

const PARENT_FOREIGN_KEY = "activity_parent_id_activity_id_fk";

/**
 * The parent was deleted after `resolveReplyParent` found it: the insert
 * breaks the parent foreign key. Any other failure is a real error.
 */
function isParentGone(error: unknown) {
  const cause = error instanceof Error ? (error.cause ?? error) : error;
  return (
    typeof cause === "object" &&
    cause !== null &&
    "code" in cause &&
    cause.code === "23503" &&
    "constraint" in cause &&
    cause.constraint === PARENT_FOREIGN_KEY
  );
}

const threadTop = alias(activityTable, "thread_top");

/**
 * The top-level comment a reply attaches to, with its visibility, or a 404
 * when `parentId` is not a comment of this task. Checking the task keeps a
 * reply from naming (or probing for) a comment the caller cannot see.
 */
async function resolveReplyParent(taskId: string, parentId: string) {
  const [parent] = await db
    .select({
      id: activityTable.id,
      parentId: activityTable.parentId,
      visibility: activityTable.visibility,
      topVisibility: threadTop.visibility,
    })
    .from(activityTable)
    .leftJoin(threadTop, eq(threadTop.id, activityTable.parentId))
    .where(
      and(
        eq(activityTable.id, parentId),
        eq(activityTable.taskId, taskId),
        eq(activityTable.type, "comment"),
        isNotNull(activityTable.content),
      ),
    )
    .limit(1);
  if (!parent) {
    throw new HTTPException(404, { message: PARENT_NOT_FOUND });
  }
  return parent.parentId
    ? { id: parent.parentId, visibility: parent.topVisibility ?? "internal" }
    : { id: parent.id, visibility: parent.visibility };
}

/**
 * The people already in a thread: the top-level comment's author and
 * everyone who replied, without the new reply's author.
 */
async function threadParticipantIds(
  parentId: string,
  actorId: string,
): Promise<string[]> {
  const rows = await db
    .selectDistinct({ userId: activityTable.userId })
    .from(activityTable)
    .where(
      and(
        eq(activityTable.type, "comment"),
        or(
          eq(activityTable.id, parentId),
          eq(activityTable.parentId, parentId),
        ),
      ),
    );
  return rows
    .map((row) => row.userId)
    .filter((id): id is string => Boolean(id) && id !== actorId);
}

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
    parentId: requestedParentId,
  }: CreateCommentOptions = {},
) {
  const parent = requestedParentId
    ? await resolveReplyParent(taskId, requestedParentId)
    : null;
  // The public board lists comments flat: a public answer to an internal
  // comment would show there without the question it answers.
  if (parent && visibility === "public" && parent.visibility !== "public") {
    throw new HTTPException(400, {
      message: PUBLIC_REPLY_NEEDS_PUBLIC_PARENT,
    });
  }
  const parentId = parent?.id ?? null;

  const [activity] = await db
    .insert(activityTable)
    .values({
      taskId,
      type: "comment",
      userId,
      content,
      visibility,
      parentId,
      // An agent's comment says who it acted for (AI-generated marker); an
      // automation rule's comment carries the "Automation" marker.
      eventData: withAutomationMarker(withAgentVia(null)),
      ...(external
        ? {
            externalUserName: external.userName,
            externalSource: external.source,
          }
        : {}),
    })
    .returning()
    .catch((error: unknown) => {
      // Deleted between the check above and this insert: the same answer
      // as a parent that was never there.
      if (parentId && isParentGone(error)) {
        throw new HTTPException(404, { message: PARENT_NOT_FOUND });
      }
      throw error;
    });

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
      comment: `**${user?.name ?? (userId ? "" : "Automation")}** commented:\n> ${content}`,
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
  // The system actor "Automation" (no user) watches nothing.
  if (
    !external &&
    userId &&
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
  // A reply also reaches the people already in its thread, watching or not.
  await notifyTaskEvent({
    taskId,
    kind: "comment",
    actorId: userId,
    excludeIds: mentioned,
    directIds: parentId ? await threadParticipantIds(parentId, userId) : [],
    eventData: {
      commenterName: user?.name ?? null,
      commentId: activity.id,
      commentPreview: plainTextPreview(content),
      ...(parentId ? { parentCommentId: parentId } : {}),
    },
  });

  return activity;
}

export default createComment;
