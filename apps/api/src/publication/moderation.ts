import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { HTTPException } from "hono/http-exception";
import { PUBLIC_REPLY_NEEDS_PUBLIC_PARENT } from "../activity/controllers/create-comment";
import deleteComment from "../activity/controllers/delete-comment";
import db from "../database";
import {
  activityTable,
  projectPublicationTable,
  projectTable,
  publicBoardBlockTable,
  taskTable,
  userTable,
  workspaceUserTable,
} from "../database/schema";
import { publishEvent } from "../events";
import { formatTaskKey } from "../task-activity/task-snapshot";
import { plainTextPreview } from "../utils/plain-text-preview";
import { afterKeyset, decodeKeyset, encodeKeyset, timeKey } from "./keyset";

// Moderation of a public board (B12 K17, §3.3 P6-P11).

export const MODERATION_MESSAGES = {
  commentNotFound: "Comment not found",
  needsBoard: "Public comments need a published board with comments turned on",
  notAuthor: "Only the author can change this comment's visibility",
  onlyPublic: "Moderators can only remove public comments",
  personNotFound: "Person not found",
  selfBlock: "You can't block yourself",
} as const;

export type AuthorKind = "member" | "external" | "guest";

/** Member of the workspace, a guest account, or another account. */
export function authorKind(
  isMember: boolean,
  isAnonymous: boolean | null,
): AuthorKind {
  if (isMember) return "member";
  return isAnonymous ? "guest" : "external";
}

function memberJoin(workspaceId: unknown) {
  return and(
    eq(workspaceUserTable.workspaceId, sql`${workspaceId}`),
    eq(workspaceUserTable.userId, userTable.id),
  );
}

/** Whether the project is published with comments on (P7's rule). */
export async function publicCommentsOpen(projectId: string) {
  const [row] = await db
    .select({ id: projectPublicationTable.id })
    .from(projectPublicationTable)
    .where(
      and(
        eq(projectPublicationTable.projectId, projectId),
        sql`${projectPublicationTable.publishedAt} is not null`,
        eq(projectPublicationTable.commentsEnabled, true),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/** Whether the task's project is published with comments on. */
export async function publicCommentsOpenForTask(taskId: string) {
  const [task] = await db
    .select({ projectId: taskTable.projectId })
    .from(taskTable)
    .where(eq(taskTable.id, taskId))
    .limit(1);
  return task ? publicCommentsOpen(task.projectId) : false;
}

/** P6: the project's public comments, newest first. */
export async function listPublicComments(
  projectId: string,
  { cursor, limit = 20 }: { cursor?: string; limit?: number },
) {
  const after = cursor ? decodeKeyset(cursor) : null;
  const rows = await db
    .select({
      commentId: activityTable.id,
      taskId: activityTable.taskId,
      number: taskTable.number,
      slug: projectTable.slug,
      taskTitle: taskTable.title,
      content: activityTable.content,
      createdAt: activityTable.createdAt,
      createdAtKey: timeKey(activityTable.createdAt),
      authorId: userTable.id,
      authorName: userTable.name,
      authorImage: userTable.image,
      isAnonymous: userTable.isAnonymous,
      memberId: workspaceUserTable.userId,
    })
    .from(activityTable)
    .innerJoin(taskTable, eq(taskTable.id, activityTable.taskId))
    .innerJoin(projectTable, eq(projectTable.id, taskTable.projectId))
    .leftJoin(userTable, eq(userTable.id, activityTable.userId))
    .leftJoin(workspaceUserTable, memberJoin(projectTable.workspaceId))
    .where(
      and(
        eq(taskTable.projectId, projectId),
        // Comments of trashed tasks read as gone (C7).
        isNull(taskTable.deletedAt),
        eq(activityTable.type, "comment"),
        eq(activityTable.visibility, "public"),
        after
          ? afterKeyset(
              activityTable.createdAt,
              activityTable.id,
              after,
              "desc",
            )
          : undefined,
      ),
    )
    .orderBy(desc(activityTable.createdAt), desc(activityTable.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map((row) => ({
      commentId: row.commentId,
      taskId: row.taskId,
      taskKey: formatTaskKey(row.slug, row.number),
      taskTitle: row.taskTitle,
      excerpt: plainTextPreview(row.content, 200),
      createdAt: row.createdAt,
      author: row.authorId
        ? {
            id: row.authorId,
            name: row.authorName ?? "",
            image: row.authorImage ?? null,
            kind: authorKind(Boolean(row.memberId), row.isAnonymous),
          }
        : null,
    })),
    nextCursor:
      rows.length > limit && last
        ? encodeKeyset(last.createdAtKey, last.commentId)
        : null,
  };
}

const threadParent = alias(activityTable, "thread_parent");

async function loadComment(commentId: string) {
  const [comment] = await db
    .select({
      id: activityTable.id,
      taskId: activityTable.taskId,
      userId: activityTable.userId,
      visibility: activityTable.visibility,
      projectId: taskTable.projectId,
      // A reply's thread: the top-level comment it answers, if any.
      parentVisibility: threadParent.visibility,
    })
    .from(activityTable)
    .innerJoin(taskTable, eq(taskTable.id, activityTable.taskId))
    .leftJoin(threadParent, eq(threadParent.id, activityTable.parentId))
    .where(
      and(eq(activityTable.id, commentId), eq(activityTable.type, "comment")),
    )
    .limit(1);
  if (!comment) {
    throw new HTTPException(404, {
      message: MODERATION_MESSAGES.commentNotFound,
    });
  }
  return comment;
}

/** P7: the author flips their comment; a moderator only hides one. */
export async function setCommentVisibility({
  commentId,
  userId,
  visibility,
  canUpdateTasks,
  canShare,
}: {
  commentId: string;
  userId: string;
  visibility: "internal" | "public";
  canUpdateTasks: boolean;
  canShare: boolean;
}) {
  const comment = await loadComment(commentId);
  const isAuthor = comment.userId === userId && canUpdateTasks;
  if (comment.visibility !== visibility) {
    if (isAuthor) {
      if (
        visibility === "public" &&
        !(await publicCommentsOpen(comment.projectId))
      ) {
        throw new HTTPException(409, {
          message: MODERATION_MESSAGES.needsBoard,
        });
      }
      if (
        visibility === "public" &&
        comment.parentVisibility !== null &&
        comment.parentVisibility !== "public"
      ) {
        throw new HTTPException(400, {
          message: PUBLIC_REPLY_NEEDS_PUBLIC_PARENT,
        });
      }
    } else if (!(canShare && visibility === "internal")) {
      throw new HTTPException(403, { message: MODERATION_MESSAGES.notAuthor });
    }
  } else if (!isAuthor && !canShare) {
    throw new HTTPException(403, { message: MODERATION_MESSAGES.notAuthor });
  }

  const [updated] =
    comment.visibility === visibility
      ? await db
          .select()
          .from(activityTable)
          .where(eq(activityTable.id, commentId))
      : await db
          .update(activityTable)
          // Visibility is not an edit: keep `updatedAt`, which marks a
          // comment "(edited)".
          .set({ visibility, updatedAt: sql`${activityTable.updatedAt}` })
          .where(eq(activityTable.id, commentId))
          .returning();
  if (!updated) {
    throw new HTTPException(404, {
      message: MODERATION_MESSAGES.commentNotFound,
    });
  }
  if (comment.visibility !== visibility) {
    await publishEvent("comment.updated", {
      ...updated,
      projectId: comment.projectId,
      userId,
      changes: ["visibility"],
      visibility,
      origin: "app",
    });
  }
  return updated;
}

/** P8: a moderator removes a public comment (never an internal one). */
export async function moderatorDeleteComment(
  commentId: string,
  userId: string,
) {
  const comment = await loadComment(commentId);
  if (comment.visibility !== "public") {
    throw new HTTPException(403, { message: MODERATION_MESSAGES.onlyPublic });
  }
  const deleted = await deleteComment(userId, commentId, { asModerator: true });
  return { id: deleted.id, taskId: deleted.taskId };
}

type BlockRow = {
  userId: string;
  name: string;
  image: string | null;
  isAnonymous: boolean | null;
  memberId: string | null;
  blockedById: string | null;
  blockedByName: string | null;
  createdAt: Date;
};

const blockedBy = sql.identifier("blocked_by_user");

async function blockRows(projectId: string, userId?: string) {
  const rows = await db
    .select({
      userId: publicBoardBlockTable.userId,
      name: userTable.name,
      image: userTable.image,
      isAnonymous: userTable.isAnonymous,
      memberId: workspaceUserTable.userId,
      blockedById: publicBoardBlockTable.blockedBy,
      blockedByName: sql<string | null>`(
        select ${blockedBy}.${sql.identifier("name")} from ${userTable} as ${blockedBy}
        where ${blockedBy}.${sql.identifier("id")} = ${publicBoardBlockTable.blockedBy}
      )`,
      createdAt: publicBoardBlockTable.createdAt,
    })
    .from(publicBoardBlockTable)
    .innerJoin(userTable, eq(userTable.id, publicBoardBlockTable.userId))
    .innerJoin(
      projectTable,
      eq(projectTable.id, publicBoardBlockTable.projectId),
    )
    .leftJoin(workspaceUserTable, memberJoin(projectTable.workspaceId))
    .where(
      and(
        eq(publicBoardBlockTable.projectId, projectId),
        userId ? eq(publicBoardBlockTable.userId, userId) : undefined,
      ),
    )
    .orderBy(desc(publicBoardBlockTable.createdAt));
  return rows as BlockRow[];
}

function blockView(row: BlockRow) {
  return {
    userId: row.userId,
    name: row.name,
    image: row.image,
    kind: authorKind(Boolean(row.memberId), row.isAnonymous),
    blockedBy: row.blockedById
      ? { id: row.blockedById, name: row.blockedByName ?? "" }
      : null,
    createdAt: row.createdAt,
  };
}

/** P9 */
export async function listBlocks(projectId: string) {
  return (await blockRows(projectId)).map(blockView);
}

type BlockActor = { projectId: string; workspaceId: string; userId: string };

/** P10: idempotent; optionally hides every public comment of that person. */
export async function blockParticipant(
  actor: BlockActor,
  targetUserId: string,
  { hideComments = false }: { hideComments?: boolean },
) {
  if (targetUserId === actor.userId) {
    throw new HTTPException(400, { message: MODERATION_MESSAGES.selfBlock });
  }
  const [target] = await db
    .select({ id: userTable.id })
    .from(userTable)
    .where(eq(userTable.id, targetUserId))
    .limit(1);
  if (!target) {
    throw new HTTPException(404, {
      message: MODERATION_MESSAGES.personNotFound,
    });
  }

  const { hidden, inserted } = await db.transaction(async (tx) => {
    const added = await tx
      .insert(publicBoardBlockTable)
      .values({
        projectId: actor.projectId,
        userId: targetUserId,
        blockedBy: actor.userId,
      })
      .onConflictDoNothing()
      .returning({ userId: publicBoardBlockTable.userId });
    if (!hideComments) return { hidden: [], inserted: added.length > 0 };
    const projectTasks = tx
      .select({ id: taskTable.id })
      .from(taskTable)
      .where(eq(taskTable.projectId, actor.projectId));
    const rows = await tx
      .update(activityTable)
      .set({
        visibility: "internal",
        updatedAt: sql`${activityTable.updatedAt}`,
      })
      .where(
        and(
          eq(activityTable.userId, targetUserId),
          eq(activityTable.type, "comment"),
          eq(activityTable.visibility, "public"),
          inArray(activityTable.taskId, projectTasks),
        ),
      )
      .returning({ id: activityTable.id, taskId: activityTable.taskId });
    return { hidden: rows, inserted: added.length > 0 };
  });

  // One hint per affected task, not per comment.
  for (const taskId of new Set(hidden.map((row) => row.taskId))) {
    await publishEvent("comment.updated", {
      taskId,
      projectId: actor.projectId,
      userId: actor.userId,
      changes: ["visibility"],
      visibility: "internal",
      origin: "app",
    });
  }
  if (inserted || hidden.length > 0) {
    await publishEvent("publication.participant_blocked", {
      ...actor,
      targetUserId,
      hiddenComments: hidden.length,
    });
  }

  const [row] = await blockRows(actor.projectId, targetUserId);
  if (!row) throw new HTTPException(500, { message: "Failed to block" });
  return { ...blockView(row), hiddenComments: hidden.length };
}

/** P11 */
export async function unblockParticipant(
  actor: BlockActor,
  targetUserId: string,
) {
  const removed = await db
    .delete(publicBoardBlockTable)
    .where(
      and(
        eq(publicBoardBlockTable.projectId, actor.projectId),
        eq(publicBoardBlockTable.userId, targetUserId),
      ),
    )
    .returning({ userId: publicBoardBlockTable.userId });
  if (removed.length > 0) {
    await publishEvent("publication.participant_unblocked", {
      ...actor,
      targetUserId,
      hiddenComments: 0,
    });
  }
  return { userId: targetUserId };
}

/** Whether a person is blocked on a board (the participation gate). */
export async function isBlockedOnBoard(projectId: string, userId: string) {
  const [row] = await db
    .select({ userId: publicBoardBlockTable.userId })
    .from(publicBoardBlockTable)
    .where(
      and(
        eq(publicBoardBlockTable.projectId, projectId),
        eq(publicBoardBlockTable.userId, userId),
      ),
    )
    .limit(1);
  return Boolean(row);
}
