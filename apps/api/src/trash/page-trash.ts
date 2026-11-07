import {
  and,
  desc,
  eq,
  ilike,
  isNotNull,
  isNull,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import { pageReferenceTable, pageTable, userTable } from "../database/schema";
import { removeEntityReferences } from "../entity-reference/registry";
import { publishEvent } from "../events";
import { cleanUpDeletedPageAssets, pageAssets } from "../page/assets";
import {
  getPageResponse,
  lockPageTree,
  type PageRecord,
  type Transaction,
} from "../page/controllers/shared";
import {
  canSeePage,
  canTrashPage,
  PAGE_MESSAGES,
  type PageCaller,
} from "../page/rules";
import { assertProjectPageRoom, nextPosition } from "../page/tree";
import { escapeLikePattern } from "../search/like-pattern";
import { DEFAULT_TRASH_PAGE_SIZE } from "./schema";
import { purgeAtFor, trashRetentionDays } from "./settings";

// Page trash (C7). Deleting a page stamps it (page/controllers/delete-page.ts)
// and leaves its comments, versions, links and files alone until it is deleted
// permanently here. A restore puts it back in the archive at the top level,
// the state it was deleted from. A private page stays its owner's alone.

const deleter = alias(userTable, "page_trash_deleter");

/**
 * SQL twin of `canSeePage` for the trash. A page's project was already checked
 * by the route.
 */
function visibleTrashCondition(caller: PageCaller): SQL {
  const conditions = [
    eq(pageTable.access, "public"),
    eq(pageTable.ownerId, caller.userId),
  ];
  if (caller.isManager) conditions.push(isNull(pageTable.ownerId));
  return or(...conditions) as SQL;
}

/** A project's trashed pages the caller can see, newest first. */
export async function listPageTrash(
  projectId: string,
  caller: PageCaller,
  query: { search?: string; page?: number; limit?: number },
) {
  const limit = query.limit ?? DEFAULT_TRASH_PAGE_SIZE;
  const page = query.page ?? 1;
  const days = trashRetentionDays();
  const text = query.search?.trim();
  const where = and(
    eq(pageTable.projectId, projectId),
    isNotNull(pageTable.deletedAt),
    visibleTrashCondition(caller),
    text ? ilike(pageTable.title, `%${escapeLikePattern(text)}%`) : undefined,
  );

  const [rows, [total]] = await Promise.all([
    db
      .select({
        id: pageTable.id,
        title: pageTable.title,
        logoKind: pageTable.logoKind,
        logoValue: pageTable.logoValue,
        access: pageTable.access,
        ownerId: pageTable.ownerId,
        deletedAt: pageTable.deletedAt,
        deletedById: deleter.id,
        deletedByName: deleter.name,
      })
      .from(pageTable)
      .leftJoin(deleter, eq(deleter.id, pageTable.deletedById))
      .where(where)
      .orderBy(desc(pageTable.deletedAt), desc(pageTable.id))
      .limit(limit)
      .offset((page - 1) * limit),
    db
      .select({ value: sql<number>`count(*)::int` })
      .from(pageTable)
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
        logoKind: row.logoKind,
        logoValue: row.logoValue,
        access: row.access,
        canManage: canTrashPage(row, caller),
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

async function loadTrashedPage(
  reader: Transaction | typeof db,
  pageId: string,
  caller: PageCaller,
  { forUpdate = false }: { forUpdate?: boolean } = {},
): Promise<PageRecord> {
  const query = reader
    .select()
    .from(pageTable)
    .where(and(eq(pageTable.id, pageId), isNotNull(pageTable.deletedAt)))
    .limit(1);
  const [page] = forUpdate ? await query.for("update") : await query;
  if (!page || !canSeePage(page, caller)) {
    throw new HTTPException(404, { message: PAGE_MESSAGES.notInTrash });
  }
  if (!canTrashPage(page, caller)) {
    throw new HTTPException(403, { message: PAGE_MESSAGES.deleteForbidden });
  }
  return page;
}

function trashEventPayload(page: PageRecord, userId: string | null) {
  // Access and title let workspace webhooks skip private pages (D14).
  return {
    pageId: page.id,
    projectId: page.projectId,
    workspaceId: page.workspaceId,
    userId,
    access: page.access,
    title: page.title,
  };
}

/** Brings a trashed page back into the archive, at the top level. */
export async function restoreTrashedPage(pageId: string, caller: PageCaller) {
  const page = await db.transaction(async (tx) => {
    const located = await loadTrashedPage(tx, pageId, caller);
    if (located.projectId) await lockPageTree(tx, located.projectId);
    const current = await loadTrashedPage(tx, pageId, caller, {
      forUpdate: true,
    });
    const position = current.projectId
      ? await nextPosition(tx, current.projectId, null)
      : 0;
    if (current.projectId)
      await assertProjectPageRoom(tx, current.projectId, 1);
    await tx
      .update(pageTable)
      .set({ deletedAt: null, deletedById: null, parentId: null, position })
      .where(eq(pageTable.id, pageId));
    return current;
  });
  await publishEvent("page.restored", trashEventPayload(page, caller.userId));
  return getPageResponse(pageId, caller);
}

/**
 * Permanently deletes a page with its comments, watchers, versions and
 * references (the cascades). Links to it, favorites, recent visits and its
 * files are cleaned up after the commit, best effort.
 */
export async function hardDeletePage(page: PageRecord, userId: string | null) {
  const assets = await pageAssets(page.id);
  const [deleted] = await db
    .delete(pageTable)
    .where(and(eq(pageTable.id, page.id), isNotNull(pageTable.deletedAt)))
    .returning({ id: pageTable.id });
  if (!deleted) return false;

  try {
    await db
      .delete(pageReferenceTable)
      .where(
        and(
          eq(pageReferenceTable.entityType, "page"),
          eq(pageReferenceTable.entityId, page.id),
        ),
      );
    await removeEntityReferences("page", [page.id]);
    await cleanUpDeletedPageAssets(page, assets);
  } catch (error) {
    console.error("Page delete cleanup failed:", error);
  }

  await publishEvent("page.purged", trashEventPayload(page, userId));
  return true;
}

/** Permanently deletes a trashed page. */
export async function purgeTrashedPage(pageId: string, caller: PageCaller) {
  const page = await loadTrashedPage(db, pageId, caller);
  if (!(await hardDeletePage(page, caller.userId))) {
    throw new HTTPException(404, { message: PAGE_MESSAGES.notInTrash });
  }
  return { id: page.id, projectId: page.projectId };
}
