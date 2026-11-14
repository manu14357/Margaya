import { and, eq, inArray, sql } from "drizzle-orm";
import * as Y from "yjs";
import db from "../database";
import {
  projectTable,
  taskTable,
  whiteboardTable,
  whiteboardTaskLinkTable,
} from "../database/schema";
import { publishEvent } from "../events";
import {
  BOARD_LIMITS,
  type BoardElement,
  extractBoardText,
  readElements,
  taskIdsOf,
} from "./board";
import { WHITEBOARD_MESSAGES } from "./rules";
import type { Transaction, WhiteboardRecord } from "./shared";

// Saving a board document: pull, merge, push under the board row lock.
// Collaboration rooms run it with their live doc; REST writes without a
// room on this instance run it with a temporary doc. Both serialize on the
// row lock.

/** Transaction origins on board docs. */
export const BOARD_DOC_ORIGIN = {
  /** State read from the database (load, the persist pull). */
  db: "db",
  /** A server-made change (elements added through REST or MCP). */
  server: "server",
  /** The server removing or repairing invalid client content. */
  repair: "repair",
} as const;

export class WhiteboardTooLargeError extends Error {
  constructor(readonly bytes: number) {
    super(WHITEBOARD_MESSAGES.tooLarge);
  }
}

export type BoardPersistInput = {
  whiteboardId: string;
  doc: Y.Doc;
  /**
   * The contentVersion this doc last loaded or wrote; the stored state is
   * merged in first when the row's differs. Null always merges.
   */
  knownContentVersion: number | null;
  /** Runs first under the row lock; throw to abort (nothing is written). */
  guard?: (row: WhiteboardRecord) => void;
  /** Runs under the row lock after the pull (a server change). */
  mutate?: (doc: Y.Doc) => void;
  /** The last contributor; `updated_by_id` names them. */
  actorId: string | null;
  /** Everyone whose edits this save holds (ids only, for the history). */
  contributorIds?: readonly string[];
};

export type BoardPersistOutcome =
  | {
      status: "saved";
      board: WhiteboardRecord;
      changed: boolean;
      contentVersion: number;
    }
  | { status: "gone" }
  | { status: "feature-off" };

async function lockBoardRow(tx: Transaction, whiteboardId: string) {
  const [row] = await tx
    .select()
    .from(whiteboardTable)
    .where(eq(whiteboardTable.id, whiteboardId))
    .for("update");
  if (!row) return null;
  const [project] = await tx
    .select({
      enabled: projectTable.whiteboardsEnabled,
      deletedAt: projectTable.deletedAt,
    })
    .from(projectTable)
    .where(eq(projectTable.id, row.projectId))
    .limit(1);
  return { row, project };
}

/** The live elements of a doc (tombstones left out). */
export function liveElements(doc: Y.Doc): BoardElement[] {
  return readElements(doc, { includeDeleted: false });
}

/** Task ids of the board's cards that are tasks of the board's own project. */
async function projectTaskIds(
  reader: Pick<Transaction, "select">,
  projectId: string,
  taskIds: readonly string[],
): Promise<string[]> {
  const found: string[] = [];
  for (let start = 0; start < taskIds.length; start += 1000) {
    const chunk = taskIds.slice(start, start + 1000);
    const rows = await reader
      .select({ id: taskTable.id })
      .from(taskTable)
      .where(
        and(inArray(taskTable.id, chunk), eq(taskTable.projectId, projectId)),
      );
    for (const row of rows) found.push(row.id);
  }
  return found;
}

/** Rewrites the board's task links from its cards. */
export async function syncTaskLinks(
  tx: Transaction,
  board: Pick<WhiteboardRecord, "id" | "projectId">,
  elements: readonly BoardElement[],
) {
  const ids = await projectTaskIds(
    tx,
    board.projectId,
    taskIdsOf([...elements]),
  );
  await tx
    .delete(whiteboardTaskLinkTable)
    .where(eq(whiteboardTaskLinkTable.whiteboardId, board.id));
  if (ids.length > 0) {
    await tx
      .insert(whiteboardTaskLinkTable)
      .values(ids.map((taskId) => ({ whiteboardId: board.id, taskId })))
      .onConflictDoNothing();
  }
}

/** The text, count and size checks every stored state goes through. */
export function projectionsOf(doc: Y.Doc) {
  const state = Y.encodeStateAsUpdate(doc);
  if (state.byteLength > BOARD_LIMITS.maxDocumentBytes) {
    throw new WhiteboardTooLargeError(state.byteLength);
  }
  const elements = liveElements(doc);
  return {
    state,
    elements,
    contentText: extractBoardText(elements),
    elementCount: elements.length,
  };
}

/**
 * Persists a board doc: merges the stored state into it, applies `mutate`,
 * then writes the state, its text, element count and task links, and
 * publishes `whiteboard.content_saved` when the content changed. Throws
 * WhiteboardTooLargeError (nothing written) over the state limit.
 */
export async function persistBoardDocument(
  input: BoardPersistInput,
): Promise<BoardPersistOutcome> {
  const { doc } = input;
  const outcome = await db.transaction(async (tx) => {
    const locked = await lockBoardRow(tx, input.whiteboardId);
    if (!locked || locked.row.deletedAt || !locked.project) {
      return { status: "gone" as const };
    }
    if (locked.project.deletedAt) return { status: "gone" as const };
    if (!locked.project.enabled) return { status: "feature-off" as const };
    const { row } = locked;
    input.guard?.(row);

    if (
      row.contentYjs &&
      (input.knownContentVersion === null ||
        input.knownContentVersion !== row.contentVersion)
    ) {
      Y.applyUpdate(doc, row.contentYjs, BOARD_DOC_ORIGIN.db);
    }
    input.mutate?.(doc);

    const projections = projectionsOf(doc);
    const changed =
      !row.contentYjs ||
      !Buffer.from(projections.state).equals(Buffer.from(row.contentYjs));
    if (!changed) {
      return {
        status: "saved" as const,
        board: row,
        changed: false,
        contentVersion: row.contentVersion,
      };
    }

    const [board] = await tx
      .update(whiteboardTable)
      .set({
        contentYjs: Buffer.from(projections.state),
        contentText: projections.contentText,
        elementCount: projections.elementCount,
        contentVersion: sql`${whiteboardTable.contentVersion} + 1`,
        updatedAt: new Date(),
        ...(input.actorId ? { updatedById: input.actorId } : {}),
      })
      .where(eq(whiteboardTable.id, row.id))
      .returning();
    if (!board) return { status: "gone" as const };
    await syncTaskLinks(tx, board, projections.elements);
    return {
      status: "saved" as const,
      board,
      changed: true,
      contentVersion: board.contentVersion,
    };
  });

  if (outcome.status === "saved" && outcome.changed) {
    await publishEvent("whiteboard.content_saved", {
      whiteboardId: outcome.board.id,
      projectId: outcome.board.projectId,
      workspaceId: outcome.board.workspaceId,
      userId: input.actorId,
      contributorIds: [...(input.contributorIds ?? [])],
      contentVersion: outcome.contentVersion,
    });
  }
  return outcome;
}
