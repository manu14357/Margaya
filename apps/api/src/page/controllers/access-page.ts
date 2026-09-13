import { and, eq, inArray, ne } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  favoriteTable,
  pageTable,
  recentVisitTable,
} from "../../database/schema";
import { publishEvent } from "../../events";
import {
  childrenMap,
  isPageOwner,
  PAGE_MESSAGES,
  type PageCaller,
  subtreeIds,
} from "../rules";
import type { PageAccess } from "../types";
import {
  getPageResponse,
  loadVisiblePage,
  pageEventPayload,
  projectParentMap,
} from "./shared";

/**
 * Pages that just turned private leave everyone else's favorites and recent
 * visits (the entity resolver hides them too; this is defense in depth).
 */
export async function removeOtherUsersReferences(
  pageIds: string[],
  ownerId: string,
) {
  if (pageIds.length === 0) return;
  await db
    .delete(favoriteTable)
    .where(
      and(
        eq(favoriteTable.entityType, "page"),
        inArray(favoriteTable.entityId, pageIds),
        ne(favoriteTable.userId, ownerId),
      ),
    );
  await db
    .delete(recentVisitTable)
    .where(
      and(
        eq(recentVisitTable.entityType, "page"),
        inArray(recentVisitTable.entityId, pageIds),
        ne(recentVisitTable.userId, ownerId),
      ),
    );
}

/**
 * Makes a page private (with every descendant, all of which must be the
 * owner's: T6) or public (only this page, never under a private parent:
 * T5). Owner only; not while archived.
 */
async function updatePageAccess({
  pageId,
  access,
  caller,
}: {
  pageId: string;
  access: PageAccess;
  caller: PageCaller;
}) {
  const result = await db.transaction(async (tx) => {
    const page = await loadVisiblePage(tx, pageId, caller, { forUpdate: true });
    if (!isPageOwner(page, caller) || !caller.canUpdate) {
      throw new HTTPException(403, { message: PAGE_MESSAGES.ownerOnlyAccess });
    }
    if (page.archivedAt !== null) {
      throw new HTTPException(409, { message: PAGE_MESSAGES.archived });
    }
    if (page.access === access) return { page, affected: [] as string[] };

    if (access === "public") {
      if (page.parentId) {
        const [parent] = await tx
          .select({ access: pageTable.access })
          .from(pageTable)
          .where(eq(pageTable.id, page.parentId));
        if (parent?.access === "private") {
          throw new HTTPException(409, {
            message: PAGE_MESSAGES.parentPrivate,
          });
        }
      }
      await tx
        .update(pageTable)
        .set({ access })
        .where(eq(pageTable.id, page.id));
      return { page, affected: [page.id] };
    }

    const parentOf = page.projectId
      ? await projectParentMap(tx, page.projectId)
      : new Map([[page.id, page.parentId]]);
    const subtree = subtreeIds(page.id, childrenMap(parentOf));
    const rows = await tx
      .select({
        id: pageTable.id,
        ownerId: pageTable.ownerId,
        access: pageTable.access,
      })
      .from(pageTable)
      .where(inArray(pageTable.id, subtree));
    if (rows.some((row) => row.ownerId !== caller.userId)) {
      throw new HTTPException(409, {
        message: PAGE_MESSAGES.foreignDescendants,
      });
    }
    const affected = rows
      .filter((row) => row.access !== "private")
      .map((row) => row.id);
    await tx
      .update(pageTable)
      .set({ access: "private" })
      .where(inArray(pageTable.id, affected));
    return { page, affected };
  });

  if (result.affected.length > 0) {
    if (access === "private") {
      await removeOtherUsersReferences(result.affected, caller.userId);
    }
    await publishEvent("page.access_changed", {
      ...pageEventPayload(result.page, caller.userId),
      access,
      affectedPageIds: result.affected,
    });
  }
  return getPageResponse(pageId, caller);
}

export default updatePageAccess;
