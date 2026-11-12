import { and, asc, desc, eq, isNull, notInArray } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  projectTable,
  projectUpdateCommentTable,
  projectUpdateReactionTable,
  projectUpdateSubscriberTable,
  projectUpdateTable,
  userTable,
} from "../../database/schema";
import { publishEvent } from "../../events";
import { groupReactions, type ReactionEmoji } from "../../reaction/emoji";
import { COMMENT_NOT_FOUND, UPDATE_NOT_FOUND } from "../access";
import type { Caller } from "./updates";

// Comments, reactions, following and the workspace roll-up of project
// updates. Reactions notify nobody; comments notify the update's author and
// earlier commenters (notify.ts).

const PREVIEW_CHARS = 200;

async function updateRef(updateId: string) {
  const [row] = await db
    .select({
      id: projectUpdateTable.id,
      projectId: projectUpdateTable.projectId,
      workspaceId: projectUpdateTable.workspaceId,
    })
    .from(projectUpdateTable)
    .where(eq(projectUpdateTable.id, updateId))
    .limit(1);
  if (!row) throw new HTTPException(404, { message: UPDATE_NOT_FOUND });
  return row;
}

export async function listComments(updateId: string, caller: Caller) {
  const rows = await db
    .select({
      id: projectUpdateCommentTable.id,
      updateId: projectUpdateCommentTable.updateId,
      userId: projectUpdateCommentTable.userId,
      content: projectUpdateCommentTable.content,
      createdAt: projectUpdateCommentTable.createdAt,
      name: userTable.name,
      image: userTable.image,
    })
    .from(projectUpdateCommentTable)
    .leftJoin(userTable, eq(userTable.id, projectUpdateCommentTable.userId))
    .where(eq(projectUpdateCommentTable.updateId, updateId))
    .orderBy(
      asc(projectUpdateCommentTable.createdAt),
      asc(projectUpdateCommentTable.id),
    );
  return rows.map((row) => ({
    id: row.id,
    updateId: row.updateId,
    author:
      row.userId && row.name !== null
        ? { id: row.userId, name: row.name, image: row.image ?? null }
        : null,
    content: row.content,
    canDelete: caller.canManage || row.userId === caller.userId,
    createdAt: row.createdAt,
  }));
}

export async function addComment(
  updateId: string,
  content: string,
  caller: Caller,
) {
  const update = await updateRef(updateId);
  const text = content.trim();
  const [row] = await db
    .insert(projectUpdateCommentTable)
    .values({ updateId, userId: caller.userId, content: text })
    .returning({ id: projectUpdateCommentTable.id });
  if (!row) throw new HTTPException(500, { message: "Couldn't add comment" });
  await publishEvent("project_update.comment_created", {
    updateId,
    commentId: row.id,
    projectId: update.projectId,
    workspaceId: update.workspaceId,
    userId: caller.userId,
    commentPreview: text.slice(0, PREVIEW_CHARS),
  });
  const comments = await listComments(updateId, caller);
  const created = comments.find((comment) => comment.id === row.id);
  if (!created) throw new HTTPException(404, { message: COMMENT_NOT_FOUND });
  return created;
}

export async function deleteComment(commentId: string, caller: Caller) {
  const [row] = await db
    .select({
      userId: projectUpdateCommentTable.userId,
      updateId: projectUpdateCommentTable.updateId,
      projectId: projectUpdateTable.projectId,
      workspaceId: projectUpdateTable.workspaceId,
    })
    .from(projectUpdateCommentTable)
    .innerJoin(
      projectUpdateTable,
      eq(projectUpdateTable.id, projectUpdateCommentTable.updateId),
    )
    .where(eq(projectUpdateCommentTable.id, commentId))
    .limit(1);
  if (!row) throw new HTTPException(404, { message: COMMENT_NOT_FOUND });
  if (!caller.canManage && row.userId !== caller.userId) {
    throw new HTTPException(403, {
      message: "Only the author or a project manager can delete this comment",
    });
  }
  await db
    .delete(projectUpdateCommentTable)
    .where(eq(projectUpdateCommentTable.id, commentId));
  await publishEvent("project_update.comment_deleted", {
    updateId: row.updateId,
    commentId,
    projectId: row.projectId,
    workspaceId: row.workspaceId,
    userId: caller.userId,
  });
  return { id: commentId, deleted: true as const };
}

async function reactionGroupsOf(updateId: string, userId: string) {
  const rows = await db
    .select({
      emoji: projectUpdateReactionTable.emoji,
      userId: projectUpdateReactionTable.userId,
      name: userTable.name,
      image: userTable.image,
      createdAt: projectUpdateReactionTable.createdAt,
    })
    .from(projectUpdateReactionTable)
    .innerJoin(userTable, eq(userTable.id, projectUpdateReactionTable.userId))
    .where(eq(projectUpdateReactionTable.updateId, updateId))
    .orderBy(
      asc(projectUpdateReactionTable.createdAt),
      asc(projectUpdateReactionTable.id),
    );
  return groupReactions(
    rows.map((row) => ({ ...row, commentId: null })),
    userId,
  );
}

/** Adds or removes the caller's reaction; idempotent. */
export async function setReaction(
  updateId: string,
  emoji: ReactionEmoji,
  add: boolean,
  caller: Caller,
) {
  const update = await updateRef(updateId);
  const changed = add
    ? await db
        .insert(projectUpdateReactionTable)
        .values({ updateId, userId: caller.userId, emoji })
        .onConflictDoNothing()
        .returning({ id: projectUpdateReactionTable.id })
    : await db
        .delete(projectUpdateReactionTable)
        .where(
          and(
            eq(projectUpdateReactionTable.updateId, updateId),
            eq(projectUpdateReactionTable.userId, caller.userId),
            eq(projectUpdateReactionTable.emoji, emoji),
          ),
        )
        .returning({ id: projectUpdateReactionTable.id });
  if (changed.length > 0) {
    await publishEvent("project_update.reaction_changed", {
      updateId,
      projectId: update.projectId,
      workspaceId: update.workspaceId,
      userId: caller.userId,
    });
  }
  return reactionGroupsOf(updateId, caller.userId);
}

async function leadOf(projectId: string): Promise<string | null> {
  const [row] = await db
    .select({ leadUserId: projectTable.leadUserId })
    .from(projectTable)
    .where(eq(projectTable.id, projectId))
    .limit(1);
  return row?.leadUserId ?? null;
}

/**
 * Who follows a project's updates: subscribed rows plus the lead, minus
 * muted rows. Callers still check that each can see the project.
 */
export async function followerIds(projectId: string): Promise<string[]> {
  const [rows, lead] = await Promise.all([
    db
      .select({
        userId: projectUpdateSubscriberTable.userId,
        subscribed: projectUpdateSubscriberTable.subscribed,
      })
      .from(projectUpdateSubscriberTable)
      .where(eq(projectUpdateSubscriberTable.projectId, projectId)),
    leadOf(projectId),
  ]);
  const ids = new Set(
    rows.filter((row) => row.subscribed).map((row) => row.userId),
  );
  const muted = new Set(
    rows.filter((row) => !row.subscribed).map((row) => row.userId),
  );
  if (lead && !muted.has(lead)) ids.add(lead);
  return [...ids];
}

export async function getFollowState(projectId: string, userId: string) {
  const [[row], lead] = await Promise.all([
    db
      .select({ subscribed: projectUpdateSubscriberTable.subscribed })
      .from(projectUpdateSubscriberTable)
      .where(
        and(
          eq(projectUpdateSubscriberTable.projectId, projectId),
          eq(projectUpdateSubscriberTable.userId, userId),
        ),
      )
      .limit(1),
    leadOf(projectId),
  ]);
  const isLead = lead === userId;
  return { following: row ? row.subscribed : isLead, isLead };
}

export async function setFollowState(
  projectId: string,
  userId: string,
  following: boolean,
) {
  await db
    .insert(projectUpdateSubscriberTable)
    .values({ projectId, userId, subscribed: following })
    .onConflictDoUpdate({
      target: [
        projectUpdateSubscriberTable.projectId,
        projectUpdateSubscriberTable.userId,
      ],
      set: { subscribed: following, updatedAt: new Date() },
    });
  return getFollowState(projectId, userId);
}

/**
 * The latest update of each project the caller can see that has updates on,
 * newest first. One DISTINCT ON read over the (project, created_at) index.
 */
export async function latestUpdates(
  workspaceId: string,
  hiddenProjectIds: readonly string[],
  limit: number,
) {
  const rows = await db
    .selectDistinctOn([projectUpdateTable.projectId], {
      id: projectUpdateTable.id,
      projectId: projectUpdateTable.projectId,
      projectName: projectTable.name,
      health: projectUpdateTable.health,
      summary: projectUpdateTable.summary,
      aiProvenance: projectUpdateTable.aiProvenance,
      authorId: projectUpdateTable.authorId,
      authorName: userTable.name,
      authorImage: userTable.image,
      createdAt: projectUpdateTable.createdAt,
    })
    .from(projectUpdateTable)
    .innerJoin(projectTable, eq(projectTable.id, projectUpdateTable.projectId))
    .leftJoin(userTable, eq(userTable.id, projectUpdateTable.authorId))
    .where(
      and(
        eq(projectUpdateTable.workspaceId, workspaceId),
        eq(projectTable.updatesEnabled, true),
        isNull(projectTable.deletedAt),
        isNull(projectTable.archivedAt),
        hiddenProjectIds.length > 0
          ? notInArray(projectUpdateTable.projectId, [...hiddenProjectIds])
          : undefined,
      ),
    )
    .orderBy(projectUpdateTable.projectId, desc(projectUpdateTable.createdAt));
  return {
    updates: rows
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, limit)
      .map((row) => ({
        id: row.id,
        projectId: row.projectId,
        projectName: row.projectName,
        health: row.health,
        summary: row.summary,
        aiProvenance: row.aiProvenance ?? null,
        author:
          row.authorId && row.authorName !== null
            ? {
                id: row.authorId,
                name: row.authorName,
                image: row.authorImage ?? null,
              }
            : null,
        createdAt: row.createdAt,
      })),
  };
}
