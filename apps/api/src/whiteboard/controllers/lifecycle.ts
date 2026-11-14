import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { whiteboardTable } from "../../database/schema";
import { publishEvent } from "../../events";
import { boardRoomHooks } from "../content";
import {
  canManageBoard,
  WHITEBOARD_MESSAGES,
  type WhiteboardCaller,
} from "../rules";
import {
  loadWhiteboard,
  toWhiteboardResponse,
  type WhiteboardRecord,
  whiteboardEventPayload,
} from "../shared";

// Lock, archive and trash. The creator with whiteboard:update or anyone
// with whiteboard:delete may do each; the state a board is already in
// changes nothing and publishes nothing.

function assertCanManage(board: WhiteboardRecord, caller: WhiteboardCaller) {
  if (!canManageBoard(board, caller)) {
    throw new HTTPException(403, {
      message: WHITEBOARD_MESSAGES.ownerOrManager,
    });
  }
}

/** Locks (read-only for everyone, the creator included) or unlocks. */
export async function setWhiteboardLock({
  whiteboardId,
  locked,
  caller,
}: {
  whiteboardId: string;
  locked: boolean;
  caller: WhiteboardCaller;
}) {
  const result = await db.transaction(async (tx) => {
    const board = await loadWhiteboard(tx, whiteboardId, { forUpdate: true });
    assertCanManage(board, caller);
    if (board.isLocked === locked) return { board, changed: false };
    const [updated] = await tx
      .update(whiteboardTable)
      .set({
        isLocked: locked,
        lockedById: locked ? caller.userId : null,
        lockedAt: locked ? new Date() : null,
      })
      .where(eq(whiteboardTable.id, board.id))
      .returning();
    return { board: updated ?? board, changed: true };
  });
  if (result.changed) {
    await publishEvent("whiteboard.updated", {
      ...whiteboardEventPayload(result.board, caller.userId),
      change: locked ? "locked" : "unlocked",
    });
  }
  return toWhiteboardResponse(result.board, caller);
}

/** Archives (which also revokes a public link) or restores from the archive. */
export async function setWhiteboardArchived({
  whiteboardId,
  archived,
  caller,
}: {
  whiteboardId: string;
  archived: boolean;
  caller: WhiteboardCaller;
}) {
  const result = await db.transaction(async (tx) => {
    const board = await loadWhiteboard(tx, whiteboardId, { forUpdate: true });
    assertCanManage(board, caller);
    if ((board.archivedAt !== null) === archived) {
      return { board, changed: false };
    }
    const [updated] = await tx
      .update(whiteboardTable)
      .set(
        archived
          ? {
              archivedAt: new Date(),
              publicToken: null,
              publishedAt: null,
              publishedById: null,
            }
          : { archivedAt: null },
      )
      .where(eq(whiteboardTable.id, board.id))
      .returning();
    return { board: updated ?? board, changed: true };
  });
  if (result.changed) {
    await publishEvent("whiteboard.updated", {
      ...whiteboardEventPayload(result.board, caller.userId),
      change: archived ? "archived" : "unarchived",
      title: result.board.title,
    });
  }
  return toWhiteboardResponse(result.board, caller);
}

/** Moves an archived board to the trash; its rooms close first. */
export async function deleteWhiteboard({
  whiteboardId,
  caller,
}: {
  whiteboardId: string;
  caller: WhiteboardCaller;
}) {
  const check = (board: WhiteboardRecord) => {
    if (board.archivedAt === null) {
      throw new HTTPException(409, {
        message: WHITEBOARD_MESSAGES.deleteNotArchived,
      });
    }
    assertCanManage(board, caller);
  };
  check(await loadWhiteboard(db, whiteboardId));
  boardRoomHooks().closeRooms([whiteboardId]);

  const board = await db.transaction(async (tx) => {
    const current = await loadWhiteboard(tx, whiteboardId, { forUpdate: true });
    check(current);
    const [deleted] = await tx
      .update(whiteboardTable)
      .set({
        deletedAt: new Date(),
        deletedById: caller.userId,
        publicToken: null,
        publishedAt: null,
        publishedById: null,
      })
      .where(eq(whiteboardTable.id, current.id))
      .returning();
    return deleted ?? current;
  });

  await publishEvent("whiteboard.deleted", {
    ...whiteboardEventPayload(board, caller.userId),
    title: board.title,
  });
  return { id: board.id, projectId: board.projectId };
}
