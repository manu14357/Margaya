import { and, desc, eq, ilike, isNotNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import { userTable, whiteboardTable } from "../database/schema";
import { publishEvent } from "../events";
import { escapeLikePattern } from "../search/like-pattern";
import { boardAssetKeys, deleteBoardAssetObjects } from "../whiteboard/assets";
import {
  canManageBoard,
  WHITEBOARD_MESSAGES,
  type WhiteboardCaller,
} from "../whiteboard/rules";
import {
  type Reader,
  toWhiteboardResponse,
  type WhiteboardRecord,
  whiteboardEventPayload,
} from "../whiteboard/shared";
import { DEFAULT_TRASH_PAGE_SIZE } from "./schema";
import { purgeAtFor, trashRetentionDays } from "./settings";

// Whiteboard trash. Deleting a board stamps it (whiteboard/controllers/
// lifecycle.ts) and leaves its content, images and task links alone until
// it is deleted for good here. A restore puts it back in the archive, the
// state it was deleted from.

const deleter = alias(userTable, "whiteboard_trash_deleter");

/** A project's trashed boards, newest first. */
export async function listWhiteboardTrash(
  projectId: string,
  caller: WhiteboardCaller,
  query: { search?: string; page?: number; limit?: number },
) {
  const limit = query.limit ?? DEFAULT_TRASH_PAGE_SIZE;
  const page = query.page ?? 1;
  const days = trashRetentionDays();
  const text = query.search?.trim();
  const where = and(
    eq(whiteboardTable.projectId, projectId),
    isNotNull(whiteboardTable.deletedAt),
    text
      ? ilike(whiteboardTable.title, `%${escapeLikePattern(text)}%`)
      : undefined,
  );
  const [rows, [total]] = await Promise.all([
    db
      .select({
        id: whiteboardTable.id,
        title: whiteboardTable.title,
        icon: whiteboardTable.icon,
        createdById: whiteboardTable.createdById,
        deletedAt: whiteboardTable.deletedAt,
        deletedById: deleter.id,
        deletedByName: deleter.name,
      })
      .from(whiteboardTable)
      .leftJoin(deleter, eq(deleter.id, whiteboardTable.deletedById))
      .where(where)
      .orderBy(desc(whiteboardTable.deletedAt), desc(whiteboardTable.id))
      .limit(limit)
      .offset((page - 1) * limit),
    db
      .select({ value: sql<number>`count(*)::int` })
      .from(whiteboardTable)
      .where(where),
  ]);
  const count = total?.value ?? 0;
  return {
    items: rows.map((row) => {
      const deletedAt = row.deletedAt ?? new Date(0);
      return {
        id: row.id,
        projectId,
        title: row.title,
        icon: row.icon,
        canManage: canManageBoard(row, caller),
        deletedAt,
        deletedBy:
          row.deletedById && row.deletedByName !== null
            ? { id: row.deletedById, name: row.deletedByName }
            : null,
        purgeAt: purgeAtFor(deletedAt, days),
      };
    }),
    total: count,
    page,
    limit,
    hasMore: page * limit < count,
  };
}

async function loadTrashedBoard(
  reader: Reader,
  whiteboardId: string,
  caller: WhiteboardCaller,
  { forUpdate = false }: { forUpdate?: boolean } = {},
): Promise<WhiteboardRecord> {
  const query = reader
    .select()
    .from(whiteboardTable)
    .where(
      and(
        eq(whiteboardTable.id, whiteboardId),
        isNotNull(whiteboardTable.deletedAt),
      ),
    )
    .limit(1);
  const [board] = forUpdate ? await query.for("update") : await query;
  if (!board || !caller.canRead) {
    throw new HTTPException(404, { message: WHITEBOARD_MESSAGES.notInTrash });
  }
  if (!canManageBoard(board, caller)) {
    throw new HTTPException(403, {
      message: WHITEBOARD_MESSAGES.ownerOrManager,
    });
  }
  return board;
}

function trashEventPayload(board: WhiteboardRecord, userId: string | null) {
  return { ...whiteboardEventPayload(board, userId), title: board.title };
}

/** Brings a trashed board back into the archive. */
export async function restoreTrashedWhiteboard(
  whiteboardId: string,
  caller: WhiteboardCaller,
) {
  const board = await db.transaction(async (tx) => {
    const current = await loadTrashedBoard(tx, whiteboardId, caller, {
      forUpdate: true,
    });
    const [restored] = await tx
      .update(whiteboardTable)
      .set({ deletedAt: null, deletedById: null })
      .where(eq(whiteboardTable.id, current.id))
      .returning();
    return restored ?? current;
  });
  await publishEvent(
    "whiteboard.restored",
    trashEventPayload(board, caller.userId),
  );
  return toWhiteboardResponse(board, caller);
}

/**
 * Permanently deletes a trashed board; its images and task links go with
 * the row (the cascades), and the stored image files after the commit.
 */
export async function hardDeleteWhiteboard(
  board: WhiteboardRecord,
  userId: string | null,
) {
  const keys = await boardAssetKeys([board.id]);
  const [deleted] = await db
    .delete(whiteboardTable)
    .where(
      and(
        eq(whiteboardTable.id, board.id),
        isNotNull(whiteboardTable.deletedAt),
      ),
    )
    .returning({ id: whiteboardTable.id });
  if (!deleted) return false;
  await deleteBoardAssetObjects(keys);
  await publishEvent("whiteboard.purged", trashEventPayload(board, userId));
  return true;
}

export async function purgeTrashedWhiteboard(
  whiteboardId: string,
  caller: WhiteboardCaller,
) {
  const board = await loadTrashedBoard(db, whiteboardId, caller);
  if (!(await hardDeleteWhiteboard(board, caller.userId))) {
    throw new HTTPException(404, { message: WHITEBOARD_MESSAGES.notInTrash });
  }
  return { id: board.id, projectId: board.projectId };
}
