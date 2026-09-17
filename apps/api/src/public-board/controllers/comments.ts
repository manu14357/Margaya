import { and, asc, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import createComment from "../../activity/controllers/create-comment";
import deleteComment from "../../activity/controllers/delete-comment";
import updateComment from "../../activity/controllers/update-comment";
import db from "../../database";
import {
  activityTable,
  userTable,
  workspaceUserTable,
} from "../../database/schema";
import {
  afterKeyset,
  decodeKeyset,
  encodeKeyset,
  timeKey,
} from "../../publication/keyset";
import { resolveBoardComment, resolveBoardTask } from "../board";
import { commentReactionGroups, type publicReactionGroups } from "../counts";
import {
  PARTICIPATION_MESSAGES,
  participationDecision,
} from "../participation";
import { sanitizePublicComment } from "../sanitize";
import type { PublicViewer, ResolvedBoard } from "../types";

// Public comments (B12 §3.4 Q5-Q8, §3.9).

export const NOT_YOUR_COMMENT = "You can only change your own comments";
export const DELETED_USER = "Deleted user";
const EDITED_AFTER_MS = 60_000;

type CommentRow = {
  id: string;
  content: string | null;
  createdAt: Date;
  updatedAt: Date;
  createdAtKey: string;
  authorId: string | null;
  authorName: string | null;
  authorImage: string | null;
  isAnonymous: boolean | null;
  memberId: string | null;
};

function selectComments(board: ResolvedBoard) {
  return db
    .select({
      id: activityTable.id,
      content: activityTable.content,
      createdAt: activityTable.createdAt,
      updatedAt: activityTable.updatedAt,
      createdAtKey: timeKey(activityTable.createdAt),
      authorId: userTable.id,
      authorName: userTable.name,
      authorImage: userTable.image,
      isAnonymous: userTable.isAnonymous,
      memberId: workspaceUserTable.userId,
    })
    .from(activityTable)
    .leftJoin(userTable, eq(userTable.id, activityTable.userId))
    .leftJoin(
      workspaceUserTable,
      and(
        eq(workspaceUserTable.workspaceId, board.workspaceId),
        eq(workspaceUserTable.userId, activityTable.userId),
      ),
    );
}

function publicComment(
  row: CommentRow,
  board: ResolvedBoard,
  viewer: PublicViewer,
  reactions: ReturnType<typeof publicReactionGroups> | null,
) {
  const isYou = Boolean(viewer.userId && row.authorId === viewer.userId);
  const canManage =
    isYou && participationDecision(viewer, board, "manageOwnComment").ok;
  return {
    id: row.id,
    content: row.content ?? "",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    edited: row.updatedAt.getTime() - row.createdAt.getTime() > EDITED_AFTER_MS,
    author: row.authorId
      ? {
          name: row.authorName ?? "",
          image: row.authorImage ?? null,
          badge: row.memberId
            ? ("member" as const)
            : row.isAnonymous
              ? ("guest" as const)
              : null,
          isYou,
        }
      : { name: DELETED_USER, image: null, badge: null, isYou: false },
    ...(reactions ? { reactions } : {}),
    can: { edit: canManage, delete: canManage },
  };
}

async function loadPublicComment(
  board: ResolvedBoard,
  viewer: PublicViewer,
  commentId: string,
) {
  const [row] = await selectComments(board)
    .where(eq(activityTable.id, commentId))
    .limit(1);
  if (!row) throw new HTTPException(404, { message: "Comment not found" });
  const reactions = board.settings.reactionsEnabled
    ? ((await commentReactionGroups([row.id], viewer.userId)).get(row.id) ?? [])
    : null;
  return publicComment(row, board, viewer, reactions);
}

/** Q5: oldest first, keyset on (created_at, id). */
export async function listPublicBoardComments(
  board: ResolvedBoard,
  viewer: PublicViewer,
  rawNumber: string,
  { cursor, limit = 50 }: { cursor?: string; limit?: number },
) {
  if (!board.settings.commentsEnabled) {
    throw new HTTPException(403, {
      message: PARTICIPATION_MESSAGES.commentsOff,
    });
  }
  const task = await resolveBoardTask(board, rawNumber);
  const after = cursor ? decodeKeyset(cursor) : null;
  const rows = await selectComments(board)
    .where(
      and(
        eq(activityTable.taskId, task.id),
        eq(activityTable.type, "comment"),
        eq(activityTable.visibility, "public"),
        after
          ? afterKeyset(activityTable.createdAt, activityTable.id, after, "asc")
          : undefined,
      ),
    )
    .orderBy(asc(activityTable.createdAt), asc(activityTable.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const reactions = board.settings.reactionsEnabled
    ? await commentReactionGroups(
        page.map((row) => row.id),
        viewer.userId,
      )
    : null;
  const last = page.at(-1);
  return {
    items: page.map((row) =>
      publicComment(
        row,
        board,
        viewer,
        reactions ? (reactions.get(row.id) ?? []) : null,
      ),
    ),
    nextCursor:
      rows.length > limit && last
        ? encodeKeyset(last.createdAtKey, last.id)
        : null,
  };
}

/** Q6. */
export async function createPublicBoardComment(
  board: ResolvedBoard,
  viewer: PublicViewer,
  rawNumber: string,
  rawContent: string,
) {
  const task = await resolveBoardTask(board, rawNumber);
  const content = sanitizePublicComment(rawContent);
  const created = await createComment(
    task.id,
    viewer.userId as string,
    content,
    undefined,
    { visibility: "public", origin: "public_board", parseMentions: false },
  );
  return loadPublicComment(board, viewer, created.id);
}

async function ownComment(
  board: ResolvedBoard,
  viewer: PublicViewer,
  commentId: string,
) {
  const comment = await resolveBoardComment(board, commentId);
  if (!viewer.userId || comment.userId !== viewer.userId) {
    throw new HTTPException(403, { message: NOT_YOUR_COMMENT });
  }
  return comment;
}

/** Q7. */
export async function updatePublicBoardComment(
  board: ResolvedBoard,
  viewer: PublicViewer,
  commentId: string,
  rawContent: string,
) {
  await ownComment(board, viewer, commentId);
  const content = sanitizePublicComment(rawContent);
  await updateComment(viewer.userId as string, commentId, content, {
    parseMentions: false,
    origin: "public_board",
  });
  return loadPublicComment(board, viewer, commentId);
}

/** Q8. */
export async function deletePublicBoardComment(
  board: ResolvedBoard,
  viewer: PublicViewer,
  commentId: string,
) {
  await ownComment(board, viewer, commentId);
  await deleteComment(viewer.userId as string, commentId, {
    origin: "public_board",
  });
  return { id: commentId };
}
