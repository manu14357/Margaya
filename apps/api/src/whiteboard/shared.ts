import { eq, getTableColumns, inArray } from "drizzle-orm";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import { userTable, whiteboardTable } from "../database/schema";
import { workspacePermissionChecker } from "../utils/require-workspace-permission";
import { isWorkspacePendingDeletion } from "../workspace-deletion/lock";
import {
  canManageBoard,
  WHITEBOARD_MESSAGES,
  type WhiteboardCaller,
  whiteboardCapabilities,
} from "./rules";

export type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type Reader = Transaction | typeof db;

export type WhiteboardRecord = typeof whiteboardTable.$inferSelect;

/** Every column except the stored document. */
const { contentYjs: _contentYjs, ...summaryColumns } =
  getTableColumns(whiteboardTable);

export const whiteboardSummaryColumns = summaryColumns;

export type WhiteboardSummaryRecord = Omit<WhiteboardRecord, "contentYjs">;

/**
 * The caller's whiteboard permissions, read once per request. A workspace
 * pending deletion is read-only, so nobody may create or edit (this also
 * keeps board sockets from writing).
 */
export async function whiteboardCallerOf(
  c: Context,
): Promise<WhiteboardCaller> {
  const workspaceId = c.get("workspaceId") as string | undefined;
  const [can, locked] = await Promise.all([
    workspacePermissionChecker(c),
    workspaceId ? isWorkspacePendingDeletion(workspaceId) : false,
  ]);
  return {
    userId: c.get("userId"),
    canRead: can({ whiteboard: ["read"] }),
    canCreate: !locked && can({ whiteboard: ["create"] }),
    canUpdate: !locked && can({ whiteboard: ["update"] }),
    isManager: !locked && can({ whiteboard: ["delete"] }),
  };
}

/**
 * The live board row, or 404 when it is missing or in the trash.
 * `forUpdate` locks the row for the rest of the transaction.
 */
export async function loadWhiteboard(
  reader: Reader,
  whiteboardId: string,
  { forUpdate = false }: { forUpdate?: boolean } = {},
): Promise<WhiteboardRecord> {
  const query = reader
    .select()
    .from(whiteboardTable)
    .where(eq(whiteboardTable.id, whiteboardId))
    .limit(1);
  const [board] = forUpdate ? await query.for("update") : await query;
  if (!board || board.deletedAt) {
    throw new HTTPException(404, { message: WHITEBOARD_MESSAGES.notFound });
  }
  return board;
}

type People = Map<string, { id: string; name: string; image: string | null }>;

async function peopleOf(
  reader: Reader,
  rows: readonly WhiteboardSummaryRecord[],
): Promise<People> {
  const ids = [
    ...new Set(
      rows.flatMap((row) =>
        [row.createdById, row.updatedById, row.lockedById].filter(
          (id): id is string => Boolean(id),
        ),
      ),
    ),
  ];
  if (ids.length === 0) return new Map();
  const users = await reader
    .select({ id: userTable.id, name: userTable.name, image: userTable.image })
    .from(userTable)
    .where(inArray(userTable.id, ids));
  return new Map(users.map((user) => [user.id, user]));
}

function summaryOf(
  row: WhiteboardSummaryRecord,
  caller: WhiteboardCaller,
  people: People,
) {
  const person = (id: string | null) => (id ? (people.get(id) ?? null) : null);
  const locker = person(row.lockedById);
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    title: row.title,
    icon: row.icon,
    isLocked: row.isLocked,
    lockedBy:
      row.isLocked && locker ? { id: locker.id, name: locker.name } : null,
    lockedAt: row.lockedAt,
    archivedAt: row.archivedAt,
    // The link is a capability: only people who can manage it see it.
    publicToken: canManageBoard(row, caller) ? row.publicToken : null,
    publishedAt: row.publicToken ? row.publishedAt : null,
    elementCount: row.elementCount,
    contentVersion: row.contentVersion,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdBy: person(row.createdById),
    updatedBy: person(row.updatedById),
  };
}

/**
 * List rows as summaries. Lists spanning projects pass the caller per row:
 * a restricted project's role can lower their rights there.
 */
export async function toWhiteboardSummaries(
  rows: readonly WhiteboardSummaryRecord[],
  caller:
    | WhiteboardCaller
    | ((row: WhiteboardSummaryRecord) => WhiteboardCaller),
  reader: Reader = db,
) {
  const people = await peopleOf(reader, rows);
  return rows.map((row) =>
    summaryOf(row, typeof caller === "function" ? caller(row) : caller, people),
  );
}

/** The Whiteboard response: the summary plus the caller's capabilities. */
export async function toWhiteboardResponse(
  row: WhiteboardSummaryRecord,
  caller: WhiteboardCaller,
  reader: Reader = db,
) {
  const people = await peopleOf(reader, [row]);
  return {
    ...summaryOf(row, caller, people),
    capabilities: whiteboardCapabilities(row, caller),
  };
}

export async function getWhiteboardResponse(
  whiteboardId: string,
  caller: WhiteboardCaller,
  reader: Reader = db,
) {
  return toWhiteboardResponse(
    await loadWhiteboard(reader, whiteboardId),
    caller,
    reader,
  );
}

export type WhiteboardResponse = Awaited<
  ReturnType<typeof toWhiteboardResponse>
>;

/** Ids only: events never carry board content. */
export function whiteboardEventPayload(
  board: Pick<WhiteboardRecord, "id" | "projectId" | "workspaceId">,
  userId: string | null,
) {
  return {
    whiteboardId: board.id,
    projectId: board.projectId,
    workspaceId: board.workspaceId,
    userId,
  };
}
