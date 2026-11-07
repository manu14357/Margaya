import { and, asc, eq, inArray } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import {
  pageCommentTable,
  userTable,
  workspaceUserTable,
} from "../database/schema";
import { publishEvent } from "../events";
import { newlyMentionedIds } from "../mention/diff";
import { plainTextPreview } from "../utils/plain-text-preview";
import {
  loadVisiblePage,
  type PageRecord,
  pageEventPayload,
} from "./controllers/shared";
import { canCommentOnPage, PAGE_MESSAGES, type PageCaller } from "./rules";
import { subscribeToPage } from "./watching";

// Comments on a page. Like task comments they need page:update; a viewer can
// read them. Public links never show them (public-page/read.ts reads none).

type CommentRow = typeof pageCommentTable.$inferSelect;

function canEditComment(
  comment: Pick<CommentRow, "userId">,
  page: Pick<PageRecord, "access" | "ownerId" | "archivedAt">,
  caller: PageCaller,
) {
  return comment.userId === caller.userId && canCommentOnPage(page, caller);
}

function canDeleteComment(
  comment: Pick<CommentRow, "userId">,
  caller: PageCaller,
) {
  return (
    (comment.userId === caller.userId && caller.canUpdate) || caller.isManager
  );
}

function toResponse(
  comment: CommentRow,
  author: { name: string; image: string | null } | null,
  page: PageRecord,
  caller: PageCaller,
) {
  return {
    id: comment.id,
    pageId: comment.pageId,
    userId: comment.userId,
    content: comment.content,
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
    user: author,
    canEdit: canEditComment(comment, page, caller),
    canDelete: canDeleteComment(comment, caller),
  };
}

async function authorOf(userId: string) {
  const [author] = await db
    .select({ name: userTable.name, image: userTable.image })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1);
  return author ?? null;
}

/** Mentions can name anyone in the text; only workspace members count. */
async function mentionedMembers(
  workspaceId: string,
  previous: string | null,
  content: string,
  actorId: string,
) {
  const ids = newlyMentionedIds(previous, content, actorId);
  if (ids.length === 0) return [];
  const rows = await db
    .select({ userId: workspaceUserTable.userId })
    .from(workspaceUserTable)
    .where(
      and(
        eq(workspaceUserTable.workspaceId, workspaceId),
        inArray(workspaceUserTable.userId, ids),
      ),
    );
  return rows.map((row) => row.userId);
}

function assertCanComment(page: PageRecord, caller: PageCaller) {
  if (!caller.canUpdate) {
    throw new HTTPException(403, { message: PAGE_MESSAGES.commentForbidden });
  }
  if (!canCommentOnPage(page, caller)) {
    throw new HTTPException(409, { message: PAGE_MESSAGES.commentArchived });
  }
}

/** Every comment on the page, oldest first, with its author. */
export async function listPageComments(pageId: string, caller: PageCaller) {
  const page = await loadVisiblePage(db, pageId, caller);
  const rows = await db
    .select({
      comment: pageCommentTable,
      name: userTable.name,
      image: userTable.image,
    })
    .from(pageCommentTable)
    .leftJoin(userTable, eq(userTable.id, pageCommentTable.userId))
    .where(eq(pageCommentTable.pageId, pageId))
    .orderBy(asc(pageCommentTable.createdAt), asc(pageCommentTable.id));
  return rows.map(({ comment, name, image }) =>
    toResponse(
      comment,
      name === null ? null : { name, image: image ?? null },
      page,
      caller,
    ),
  );
}

/** Adds a comment: its author and the people it mentions start watching. */
export async function createPageComment(
  pageId: string,
  content: string,
  caller: PageCaller,
) {
  const page = await loadVisiblePage(db, pageId, caller);
  assertCanComment(page, caller);
  const mentioned = await mentionedMembers(
    page.workspaceId,
    null,
    content,
    caller.userId,
  );

  const comment = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(pageCommentTable)
      .values({ pageId, userId: caller.userId, content })
      .returning();
    if (!row) {
      throw new HTTPException(500, { message: "Failed to save the comment" });
    }
    await subscribeToPage(pageId, [caller.userId, ...mentioned], tx);
    return row;
  });

  await publishEvent("page.comment_created", {
    ...pageEventPayload(page, caller.userId),
    commentId: comment.id,
    commentPreview: plainTextPreview(content),
    newlyMentionedUserIds: mentioned,
  });
  return toResponse(comment, await authorOf(caller.userId), page, caller);
}

async function loadComment(
  page: PageRecord,
  commentId: string,
): Promise<CommentRow> {
  const [comment] = await db
    .select()
    .from(pageCommentTable)
    .where(
      and(
        eq(pageCommentTable.id, commentId),
        eq(pageCommentTable.pageId, page.id),
      ),
    )
    .limit(1);
  if (!comment) {
    throw new HTTPException(404, { message: PAGE_MESSAGES.commentNotFound });
  }
  return comment;
}

/** Edits a comment: its author only, while the page takes comments. */
export async function updatePageComment(
  pageId: string,
  commentId: string,
  content: string,
  caller: PageCaller,
) {
  const page = await loadVisiblePage(db, pageId, caller);
  const comment = await loadComment(page, commentId);
  if (comment.userId !== caller.userId) {
    throw new HTTPException(403, {
      message: PAGE_MESSAGES.commentEditForbidden,
    });
  }
  assertCanComment(page, caller);
  const mentioned = await mentionedMembers(
    page.workspaceId,
    comment.content,
    content,
    caller.userId,
  );

  const updated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(pageCommentTable)
      .set({ content })
      .where(eq(pageCommentTable.id, commentId))
      .returning();
    if (!row) {
      throw new HTTPException(404, { message: PAGE_MESSAGES.commentNotFound });
    }
    await subscribeToPage(pageId, mentioned, tx);
    return row;
  });

  await publishEvent("page.comment_updated", {
    ...pageEventPayload(page, caller.userId),
    commentId,
    newlyMentionedUserIds: mentioned,
  });
  return toResponse(updated, await authorOf(caller.userId), page, caller);
}

/** Deletes a comment: its author, or a page manager to moderate. */
export async function deletePageComment(
  pageId: string,
  commentId: string,
  caller: PageCaller,
) {
  const page = await loadVisiblePage(db, pageId, caller);
  const comment = await loadComment(page, commentId);
  if (!canDeleteComment(comment, caller)) {
    throw new HTTPException(403, {
      message: PAGE_MESSAGES.commentDeleteForbidden,
    });
  }
  await db.delete(pageCommentTable).where(eq(pageCommentTable.id, commentId));
  await publishEvent("page.comment_deleted", {
    ...pageEventPayload(page, caller.userId),
    commentId,
  });
  return { id: commentId, pageId };
}
