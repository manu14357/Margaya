import { jsonToYjsState, markdownToJson } from "@margaya/editor-schema";
import { and, eq, isNull } from "drizzle-orm";
import db from "../../database";
import { pageTable, projectTable } from "../../database/schema";
import type { PageRecord } from "../controllers/shared";
import {
  canSeePage,
  isEditableState,
  isPageOwner,
  type PageCaller,
} from "../rules";
import type { PageAccess } from "../types";
import type { ControlMessage, OfflineRejectedReason } from "./protocol";

// What a room knows about its page besides the content: the state that
// decides who may see and write it. Refreshed on page events, after every
// persist (under the same row lock) and on a timer.

export type PageMeta = {
  pageId: string;
  workspaceId: string;
  projectId: string | null;
  access: PageAccess;
  ownerId: string | null;
  isLocked: boolean;
  archivedAt: Date | null;
  contentVersion: number;
};

export type MetaResult =
  | { status: "ok"; meta: PageMeta }
  /** The row is gone. */
  | { status: "gone" }
  /** Pages are off for the page's project. */
  | { status: "feature-off"; meta: PageMeta };

export function metaOf(
  row: Pick<
    PageRecord,
    | "id"
    | "workspaceId"
    | "projectId"
    | "access"
    | "ownerId"
    | "isLocked"
    | "archivedAt"
    | "contentVersion"
  >,
): PageMeta {
  return {
    pageId: row.id,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    access: row.access,
    ownerId: row.ownerId,
    isLocked: row.isLocked,
    archivedAt: row.archivedAt,
    contentVersion: row.contentVersion,
  };
}

/** Whether two metas differ in anything that decides access or writing. */
export function metaStateChanged(before: PageMeta | null, after: PageMeta) {
  return (
    !before ||
    before.projectId !== after.projectId ||
    before.access !== after.access ||
    before.ownerId !== after.ownerId ||
    before.isLocked !== after.isLocked ||
    (before.archivedAt?.getTime() ?? null) !==
      (after.archivedAt?.getTime() ?? null)
  );
}

/** The page's meta and its project's Pages flag (one select with a join). */
export async function readPageMeta(pageId: string): Promise<MetaResult> {
  const [row] = await db
    .select({
      id: pageTable.id,
      workspaceId: pageTable.workspaceId,
      projectId: pageTable.projectId,
      access: pageTable.access,
      ownerId: pageTable.ownerId,
      isLocked: pageTable.isLocked,
      archivedAt: pageTable.archivedAt,
      contentVersion: pageTable.contentVersion,
      pagesEnabled: projectTable.pagesEnabled,
      projectDeletedAt: projectTable.deletedAt,
    })
    .from(pageTable)
    .leftJoin(projectTable, eq(projectTable.id, pageTable.projectId))
    .where(eq(pageTable.id, pageId))
    .limit(1);
  // A page of a trashed project reads as gone (C7).
  if (!row || row.projectDeletedAt) return { status: "gone" };
  const meta = metaOf(row);
  const pagesEnabled = row.projectId ? Boolean(row.pagesEnabled) : true;
  return pagesEnabled
    ? { status: "ok", meta }
    : { status: "feature-off", meta };
}

export type LoadResult =
  | { status: "ok"; meta: PageMeta; state: Uint8Array }
  | { status: "gone" }
  | { status: "feature-off" };

/**
 * The stored Yjs state a room starts from. A row without one (written
 * without the server helpers) is repaired from its markdown with a
 * compare-and-set, so every instance and every concurrent load ends up with
 * the same stored state.
 */
export async function loadPageState(pageId: string): Promise<LoadResult> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const [row] = await db
      .select({
        page: pageTable,
        pagesEnabled: projectTable.pagesEnabled,
        projectDeletedAt: projectTable.deletedAt,
      })
      .from(pageTable)
      .leftJoin(projectTable, eq(projectTable.id, pageTable.projectId))
      .where(eq(pageTable.id, pageId))
      .limit(1);
    if (!row || row.projectDeletedAt) return { status: "gone" };
    const { page } = row;
    if (page.projectId && !row.pagesEnabled) return { status: "feature-off" };
    if (page.contentYjs) {
      return {
        status: "ok",
        meta: metaOf(page),
        state: new Uint8Array(page.contentYjs),
      };
    }

    const state = jsonToYjsState(markdownToJson(page.contentMarkdown));
    const [won] = await db
      .update(pageTable)
      .set({ contentYjs: Buffer.from(state) })
      .where(and(eq(pageTable.id, pageId), isNull(pageTable.contentYjs)))
      .returning({ id: pageTable.id });
    if (won) return { status: "ok", meta: metaOf(page), state };
    // Another writer stored a state first: load theirs.
  }
  throw new Error(`Could not load the stored state of page ${pageId}`);
}

/** Whether the caller may write the page's content now. */
export function canWriteFor(meta: PageMeta, caller: PageCaller): boolean {
  return (
    canSeePage(meta, caller) &&
    caller.canUpdate &&
    isEditableState(meta) &&
    (meta.access === "public" || isPageOwner(meta, caller))
  );
}

export function offlineRejectedReason(meta: PageMeta): OfflineRejectedReason {
  if (meta.archivedAt !== null) return "archived";
  if (meta.isLocked) return "locked";
  return "readOnly";
}

export function stateMessage(
  meta: PageMeta,
  canWrite: boolean,
): ControlMessage {
  return {
    kind: "state",
    canWrite,
    isLocked: meta.isLocked,
    isArchived: meta.archivedAt !== null,
    access: meta.access,
    projectId: meta.projectId,
    contentVersion: meta.contentVersion,
  };
}
