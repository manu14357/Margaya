import { eq } from "drizzle-orm";
import db from "../../database";
import { projectTable, whiteboardTable } from "../../database/schema";
import type {
  ControlMessage,
  OfflineRejectedReason,
} from "../../page/collab/protocol";
import { isEditableState, type WhiteboardCaller } from "../rules";
import type { WhiteboardRecord } from "../shared";

// What a board room knows besides the content: the state that decides who
// may write. Refreshed on board events, after every persist and on a timer.

export type BoardMeta = {
  whiteboardId: string;
  workspaceId: string;
  projectId: string;
  isLocked: boolean;
  archivedAt: Date | null;
  contentVersion: number;
};

export type BoardMetaResult =
  | { status: "ok"; meta: BoardMeta }
  /** Missing, in the trash, or its project is in the trash. */
  | { status: "gone" }
  /** Whiteboards are off for the board's project. */
  | { status: "feature-off"; meta: BoardMeta };

export type BoardLoadResult =
  | { status: "ok"; meta: BoardMeta; state: Uint8Array | null }
  | { status: "gone" }
  | { status: "feature-off" };

export function boardMetaOf(
  row: Pick<
    WhiteboardRecord,
    | "id"
    | "workspaceId"
    | "projectId"
    | "isLocked"
    | "archivedAt"
    | "contentVersion"
  >,
): BoardMeta {
  return {
    whiteboardId: row.id,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    isLocked: row.isLocked,
    archivedAt: row.archivedAt,
    contentVersion: row.contentVersion,
  };
}

/** Whether two metas differ in anything that decides writing. */
export function boardMetaChanged(before: BoardMeta | null, after: BoardMeta) {
  return (
    !before ||
    before.projectId !== after.projectId ||
    before.isLocked !== after.isLocked ||
    (before.archivedAt?.getTime() ?? null) !==
      (after.archivedAt?.getTime() ?? null)
  );
}

const metaColumns = {
  id: whiteboardTable.id,
  workspaceId: whiteboardTable.workspaceId,
  projectId: whiteboardTable.projectId,
  isLocked: whiteboardTable.isLocked,
  archivedAt: whiteboardTable.archivedAt,
  deletedAt: whiteboardTable.deletedAt,
  contentVersion: whiteboardTable.contentVersion,
  enabled: projectTable.whiteboardsEnabled,
  projectDeletedAt: projectTable.deletedAt,
};

async function readRow(whiteboardId: string) {
  const [row] = await db
    .select(metaColumns)
    .from(whiteboardTable)
    .innerJoin(projectTable, eq(projectTable.id, whiteboardTable.projectId))
    .where(eq(whiteboardTable.id, whiteboardId))
    .limit(1);
  return row;
}

export async function readBoardMeta(
  whiteboardId: string,
): Promise<BoardMetaResult> {
  const row = await readRow(whiteboardId);
  if (!row || row.deletedAt || row.projectDeletedAt) return { status: "gone" };
  const meta = boardMetaOf(row);
  return row.enabled ? { status: "ok", meta } : { status: "feature-off", meta };
}

/** The stored state a room starts from (null for a board never saved). */
export async function loadBoardState(
  whiteboardId: string,
): Promise<BoardLoadResult> {
  const [row] = await db
    .select({ ...metaColumns, contentYjs: whiteboardTable.contentYjs })
    .from(whiteboardTable)
    .innerJoin(projectTable, eq(projectTable.id, whiteboardTable.projectId))
    .where(eq(whiteboardTable.id, whiteboardId))
    .limit(1);
  if (!row || row.deletedAt || row.projectDeletedAt) return { status: "gone" };
  if (!row.enabled) return { status: "feature-off" };
  return {
    status: "ok",
    meta: boardMetaOf(row),
    state: row.contentYjs ? new Uint8Array(row.contentYjs) : null,
  };
}

/** whiteboard:update on a board that is neither locked nor archived. */
export function canWriteBoard(meta: BoardMeta, caller: WhiteboardCaller) {
  return caller.canRead && caller.canUpdate && isEditableState(meta);
}

export function boardOfflineRejectedReason(
  meta: BoardMeta,
): OfflineRejectedReason {
  if (meta.archivedAt !== null) return "archived";
  if (meta.isLocked) return "locked";
  return "readOnly";
}

/**
 * The `state` control message, in the page room's shape so one client
 * protocol reads both. Boards have no private access level.
 */
export function boardStateMessage(
  meta: BoardMeta,
  canWrite: boolean,
): ControlMessage {
  return {
    kind: "state",
    canWrite,
    isLocked: meta.isLocked,
    isArchived: meta.archivedAt !== null,
    access: "public",
    projectId: meta.projectId,
    contentVersion: meta.contentVersion,
  };
}
