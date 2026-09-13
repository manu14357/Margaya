import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { pageTable } from "../../database/schema";
import { publishEvent } from "../../events";
import {
  canManagePage,
  childrenMap,
  PAGE_MESSAGES,
  type PageCaller,
  subtreeIds,
} from "../rules";
import { nextPosition } from "../tree";
import {
  getPageResponse,
  loadVisiblePage,
  lockPageTree,
  pageEventPayload,
  projectParentMap,
} from "./shared";

/**
 * Archives a page and all its descendants, or restores them (K12). A
 * restored page whose parent is still archived moves to the root, at the
 * end. Owner or page manager; the state it is already in publishes nothing.
 */
async function setPageArchived({
  pageId,
  archived,
  caller,
}: {
  pageId: string;
  archived: boolean;
  caller: PageCaller;
}) {
  const result = await db.transaction(async (tx) => {
    const located = await loadVisiblePage(tx, pageId, caller);
    if (located.projectId) await lockPageTree(tx, located.projectId);
    const page = await loadVisiblePage(tx, pageId, caller, { forUpdate: true });
    if (!canManagePage(page, caller)) {
      throw new HTTPException(403, { message: PAGE_MESSAGES.ownerOrManager });
    }
    if ((page.archivedAt !== null) === archived) {
      return { page, affected: [] as string[] };
    }

    const parentOf = page.projectId
      ? await projectParentMap(tx, page.projectId)
      : new Map([[page.id, page.parentId]]);
    const subtree = subtreeIds(page.id, childrenMap(parentOf));

    if (archived) {
      const rows = await tx
        .update(pageTable)
        .set({ archivedAt: new Date() })
        .where(
          and(inArray(pageTable.id, subtree), isNull(pageTable.archivedAt)),
        )
        .returning({ id: pageTable.id });
      return { page, affected: rows.map((row) => row.id) };
    }

    const rows = await tx
      .update(pageTable)
      .set({ archivedAt: null })
      .where(
        and(inArray(pageTable.id, subtree), isNotNull(pageTable.archivedAt)),
      )
      .returning({ id: pageTable.id });

    if (page.parentId && page.projectId) {
      const [parent] = await tx
        .select({ archivedAt: pageTable.archivedAt })
        .from(pageTable)
        .where(eq(pageTable.id, page.parentId));
      if (parent?.archivedAt) {
        await tx
          .update(pageTable)
          .set({
            parentId: null,
            position: await nextPosition(tx, page.projectId, null),
          })
          .where(eq(pageTable.id, page.id));
      }
    }
    return { page, affected: rows.map((row) => row.id) };
  });

  if (result.affected.length > 0) {
    await publishEvent(archived ? "page.archived" : "page.unarchived", {
      ...pageEventPayload(result.page, caller.userId),
      affectedPageIds: result.affected,
    });
  }
  return getPageResponse(pageId, caller);
}

export default setPageArchived;
