import { and, count, eq, isNull, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import * as Y from "yjs";
import db from "../../database";
import { whiteboardTable } from "../../database/schema";
import { publishEvent } from "../../events";
import {
  type BoardElement,
  type BoardSettings,
  DEFAULT_BOARD_SETTINGS,
  encodeBoardState,
  sanitizeElements,
} from "../board";
import { currentBoardContent } from "../content";
import { projectionsOf, syncTaskLinks } from "../persistence";
import {
  isSingleEmoji,
  WHITEBOARD_LIMITS,
  WHITEBOARD_MESSAGES,
  type WhiteboardCaller,
} from "../rules";
import {
  loadWhiteboard,
  type Transaction,
  toWhiteboardResponse,
  whiteboardEventPayload,
} from "../shared";

export function assertValidIcon(icon: string | null | undefined) {
  if (icon !== undefined && icon !== null && !isSingleEmoji(icon)) {
    throw new HTTPException(400, { message: WHITEBOARD_MESSAGES.invalidIcon });
  }
}

/** Serializes creates per project so the board limit holds. */
async function assertProjectRoom(tx: Transaction, projectId: string) {
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${`whiteboards:${projectId}`}))`,
  );
  const [row] = await tx
    .select({ total: count() })
    .from(whiteboardTable)
    .where(
      and(
        eq(whiteboardTable.projectId, projectId),
        isNull(whiteboardTable.deletedAt),
      ),
    );
  if ((row?.total ?? 0) >= WHITEBOARD_LIMITS.boardsPerProject) {
    throw new HTTPException(409, { message: WHITEBOARD_MESSAGES.projectLimit });
  }
}

/** Inserts a board with `elements` as its first content. */
async function insertBoard(input: {
  workspaceId: string;
  projectId: string;
  title: string;
  icon: string | null;
  elements: BoardElement[];
  settings: BoardSettings;
  caller: WhiteboardCaller;
}) {
  const state = encodeBoardState(input.elements, input.settings);
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  const projections = projectionsOf(doc);
  doc.destroy();

  const board = await db.transaction(async (tx) => {
    await assertProjectRoom(tx, input.projectId);
    const [row] = await tx
      .insert(whiteboardTable)
      .values({
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        title: input.title,
        icon: input.icon,
        contentYjs: Buffer.from(projections.state),
        contentText: projections.contentText,
        elementCount: projections.elementCount,
        createdById: input.caller.userId,
        updatedById: input.caller.userId,
      })
      .returning();
    if (!row) throw new Error("Whiteboard insert returned no row");
    await syncTaskLinks(tx, row, projections.elements);
    return row;
  });

  await publishEvent("whiteboard.created", {
    ...whiteboardEventPayload(board, input.caller.userId),
    title: board.title,
  });
  return toWhiteboardResponse(board, input.caller);
}

/** A new board in the project, blank or from template elements. */
export async function createWhiteboard({
  workspaceId,
  input,
  caller,
}: {
  workspaceId: string;
  input: {
    projectId: string;
    title?: string;
    icon?: string | null;
    elements?: unknown[];
  };
  caller: WhiteboardCaller;
}) {
  assertValidIcon(input.icon);
  return insertBoard({
    workspaceId,
    projectId: input.projectId,
    title: (input.title ?? "").trim(),
    icon: input.icon ?? null,
    elements: sanitizeElements(input.elements ?? []),
    settings: { ...DEFAULT_BOARD_SETTINGS },
    caller,
  });
}

/**
 * A copy of the board (its live content when a room is open here) in the
 * same project. The title is the client's; nothing is appended.
 */
export async function duplicateWhiteboard({
  whiteboardId,
  title,
  caller,
}: {
  whiteboardId: string;
  title?: string;
  caller: WhiteboardCaller;
}) {
  const source = await loadWhiteboard(db, whiteboardId);
  const content = await currentBoardContent(source);
  return insertBoard({
    workspaceId: source.workspaceId,
    projectId: source.projectId,
    title: (title ?? source.title).trim(),
    icon: source.icon,
    elements: content.elements,
    settings: content.settings,
    caller,
  });
}
