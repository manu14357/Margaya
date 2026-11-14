import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { whiteboardTable } from "../../database/schema";
import { publishEvent } from "../../events";
import {
  canEditBoard,
  editableStateError,
  WHITEBOARD_MESSAGES,
  type WhiteboardCaller,
} from "../rules";
import {
  loadWhiteboard,
  toWhiteboardResponse,
  type WhiteboardRecord,
  whiteboardEventPayload,
} from "../shared";
import { assertValidIcon } from "./create-whiteboard";

/** 409 when locked or archived, 403 without whiteboard:update. */
export function assertCanEdit(
  board: WhiteboardRecord,
  caller: WhiteboardCaller,
) {
  const stateError = editableStateError(board);
  if (stateError) throw new HTTPException(409, { message: stateError });
  if (!canEditBoard(board, caller)) {
    throw new HTTPException(403, { message: "Insufficient permissions" });
  }
}

/** Renames the board or changes its icon; unchanged values publish nothing. */
export async function updateWhiteboard({
  whiteboardId,
  input,
  caller,
}: {
  whiteboardId: string;
  input: { title?: string; icon?: string | null };
  caller: WhiteboardCaller;
}) {
  if (input.title === undefined && input.icon === undefined) {
    throw new HTTPException(400, { message: WHITEBOARD_MESSAGES.noFields });
  }
  assertValidIcon(input.icon);
  const result = await db.transaction(async (tx) => {
    const board = await loadWhiteboard(tx, whiteboardId, { forUpdate: true });
    assertCanEdit(board, caller);
    const patch: Partial<Pick<WhiteboardRecord, "title" | "icon">> = {};
    const title = input.title?.trim();
    if (title !== undefined && title !== board.title) patch.title = title;
    if (input.icon !== undefined && input.icon !== board.icon) {
      patch.icon = input.icon;
    }
    if (Object.keys(patch).length === 0) return { board, changed: [] };
    const [updated] = await tx
      .update(whiteboardTable)
      .set({ ...patch, updatedAt: new Date(), updatedById: caller.userId })
      .where(eq(whiteboardTable.id, board.id))
      .returning();
    return { board: updated ?? board, changed: Object.keys(patch) };
  });
  if (result.changed.length > 0) {
    await publishEvent("whiteboard.updated", {
      ...whiteboardEventPayload(result.board, caller.userId),
      change: "details",
      changed: result.changed,
    });
  }
  return toWhiteboardResponse(result.board, caller);
}
