import { eq, getTableColumns, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { savedViewTable, userTable } from "../../database/schema";
import { VIEW_NOT_FOUND } from "../access";
import {
  readViewDisplay,
  readViewDisplayProperties,
  readViewFilters,
} from "../normalize";
import type { ViewScope } from "../types";

export type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Reader = Pick<Transaction, "select">;

export type SavedViewRecord = typeof savedViewTable.$inferSelect;

/** The caller, with what their role lets them do to views. */
export type ViewCaller = {
  userId: string;
  /** view:update: edit, lock and delete their own views. */
  canUpdateOwn: boolean;
  /** view:delete: edit, lock and delete anyone's shared views. */
  canManageAny: boolean;
};

const owner = alias(userTable, "view_owner");
const locker = alias(userTable, "view_locker");

type ViewUser = { id: string; name: string; image: string | null };

type ViewRow = SavedViewRecord & {
  owner: ViewUser | null;
  locker: ViewUser | null;
};

export function viewScopeOf(view: { projectId: string | null }): ViewScope {
  return view.projectId ? "project" : "workspace";
}

/** Views matching `where`, each with its owner's and locker's display fields. */
export async function selectViews(
  reader: Reader,
  where: SQL | undefined,
  { orderBy = [], limit }: { orderBy?: SQL[]; limit?: number } = {},
): Promise<ViewRow[]> {
  const query = reader
    .select({
      ...getTableColumns(savedViewTable),
      ownerUserId: owner.id,
      ownerName: owner.name,
      ownerImage: owner.image,
      lockerUserId: locker.id,
      lockerName: locker.name,
      lockerImage: locker.image,
    })
    .from(savedViewTable)
    .leftJoin(owner, eq(owner.id, savedViewTable.ownerId))
    .leftJoin(locker, eq(locker.id, savedViewTable.lockedBy))
    .where(where)
    .orderBy(...orderBy);
  const rows = await (limit ? query.limit(limit) : query);

  return rows.map(
    ({
      ownerUserId,
      ownerName,
      ownerImage,
      lockerUserId,
      lockerName,
      lockerImage,
      ...view
    }) => ({
      ...view,
      owner:
        ownerUserId && ownerName !== null
          ? { id: ownerUserId, name: ownerName, image: ownerImage }
          : null,
      locker:
        lockerUserId && lockerName !== null
          ? { id: lockerUserId, name: lockerName, image: lockerImage }
          : null,
    }),
  );
}

/** Owner with view:update, or anyone with view:delete. */
export function canManageView(
  view: Pick<SavedViewRecord, "ownerId">,
  caller: ViewCaller,
): boolean {
  return (
    caller.canManageAny ||
    (caller.canUpdateOwn &&
      view.ownerId !== null &&
      view.ownerId === caller.userId)
  );
}

export function toSavedView(row: ViewRow, caller: ViewCaller) {
  const scope = viewScopeOf(row);
  const canManage = canManageView(row, caller);
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    name: row.name,
    description: row.description,
    filters: readViewFilters(row.filters),
    display: readViewDisplay(row.display, scope),
    displayProperties: readViewDisplayProperties(row.displayProperties),
    access: row.access,
    isLocked: row.isLocked,
    lockedBy: row.isLocked ? row.locker : null,
    ownerId: row.ownerId,
    owner: row.owner,
    canEdit: canManage,
    canDelete: canManage,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export type SavedViewResponse = ReturnType<typeof toSavedView>;

export async function getViewResponse(
  viewId: string,
  caller: ViewCaller,
  reader: Reader = db,
): Promise<SavedViewResponse> {
  const [row] = await selectViews(reader, eq(savedViewTable.id, viewId));
  if (!row) throw new HTTPException(404, { message: VIEW_NOT_FOUND });
  return toSavedView(row, caller);
}

/**
 * Reads the view row with FOR UPDATE, so lock checks and writes can't
 * interleave. Privacy is re-checked on the locked row: the view may have
 * turned private since `viewAccess` let the request in.
 */
export async function lockViewRow(
  tx: Transaction,
  viewId: string,
  userId: string,
): Promise<SavedViewRecord> {
  const [view] = await tx
    .select()
    .from(savedViewTable)
    .where(eq(savedViewTable.id, viewId))
    .for("update");
  if (!view || (view.access === "private" && view.ownerId !== userId)) {
    throw new HTTPException(404, { message: VIEW_NOT_FOUND });
  }
  return view;
}

export function viewEventPayload(
  view: Pick<SavedViewRecord, "id" | "workspaceId" | "projectId" | "access">,
  userId: string,
) {
  return {
    viewId: view.id,
    workspaceId: view.workspaceId,
    projectId: view.projectId,
    userId,
    access: view.access,
  };
}
