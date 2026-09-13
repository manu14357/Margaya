import { and, eq, inArray, isNull } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import {
  assetTable,
  favoriteTable,
  pageTable,
  projectTable,
  recentVisitTable,
} from "../../database/schema";
import { publishEvent } from "../../events";
import { featureDisabledMessage } from "../../project/features";
import {
  canManagePage,
  childrenMap,
  editableStateError,
  PAGE_MESSAGES,
  type PageCaller,
  subtreeIds,
} from "../rules";
import { assertProjectPageRoom, nextPosition } from "../tree";
import {
  getPageResponse,
  loadVisiblePage,
  lockPageTree,
  projectParentMap,
} from "./shared";

/**
 * Moves a page with its whole subtree to another project of the workspace,
 * where it becomes the last top-level page. Files, favorites and recent
 * visits follow; links to the old URL keep resolving by page id.
 */
async function movePageToProject({
  pageId,
  targetProjectId,
  caller,
}: {
  pageId: string;
  targetProjectId: string;
  caller: PageCaller;
}) {
  const page = await loadVisiblePage(db, pageId, caller);
  if (!canManagePage(page, caller)) {
    throw new HTTPException(403, { message: PAGE_MESSAGES.ownerOrManager });
  }
  const stateError = editableStateError(page);
  if (stateError) throw new HTTPException(409, { message: stateError });
  const fromProjectId = page.projectId;
  if (!fromProjectId)
    throw new HTTPException(404, { message: PAGE_MESSAGES.notFound });
  if (targetProjectId === fromProjectId) {
    throw new HTTPException(400, { message: PAGE_MESSAGES.sameProject });
  }

  const [target] = await db
    .select({ pagesEnabled: projectTable.pagesEnabled })
    .from(projectTable)
    .where(
      and(
        eq(projectTable.id, targetProjectId),
        eq(projectTable.workspaceId, page.workspaceId),
        isNull(projectTable.archivedAt),
        isNull(projectTable.deletedAt),
      ),
    )
    .limit(1);
  if (!target) {
    throw new HTTPException(404, { message: PAGE_MESSAGES.projectNotFound });
  }
  if (!target.pagesEnabled) {
    throw new HTTPException(403, { message: featureDisabledMessage("pages") });
  }

  const pageIds = await db.transaction(async (tx) => {
    for (const projectId of [fromProjectId, targetProjectId].sort()) {
      await lockPageTree(tx, projectId);
    }
    const current = await loadVisiblePage(tx, pageId, caller, {
      forUpdate: true,
    });
    const error = editableStateError(current);
    if (error) throw new HTTPException(409, { message: error });
    if (current.projectId !== fromProjectId) {
      throw new HTTPException(409, {
        message: "The page moved meanwhile. Try again.",
      });
    }

    const subtree = subtreeIds(
      current.id,
      childrenMap(await projectParentMap(tx, fromProjectId)),
    );
    await assertProjectPageRoom(
      tx,
      targetProjectId,
      subtree.length,
      PAGE_MESSAGES.targetProjectLimit,
    );

    const position = await nextPosition(tx, targetProjectId, null);
    await tx
      .update(pageTable)
      .set({ projectId: targetProjectId })
      .where(inArray(pageTable.id, subtree));
    await tx
      .update(pageTable)
      .set({ parentId: null, position })
      .where(eq(pageTable.id, current.id));
    await tx
      .update(assetTable)
      .set({ projectId: targetProjectId })
      .where(inArray(assetTable.pageId, subtree));
    await tx
      .update(favoriteTable)
      .set({ projectId: targetProjectId })
      .where(
        and(
          eq(favoriteTable.entityType, "page"),
          inArray(favoriteTable.entityId, subtree),
        ),
      );
    await tx
      .update(recentVisitTable)
      .set({ projectId: targetProjectId })
      .where(
        and(
          eq(recentVisitTable.entityType, "page"),
          inArray(recentVisitTable.entityId, subtree),
        ),
      );
    return subtree;
  });

  await publishEvent("page.moved", {
    pageId: page.id,
    projectId: targetProjectId,
    workspaceId: page.workspaceId,
    userId: caller.userId,
    fromProjectId,
    toProjectId: targetProjectId,
    pageIds,
  });
  return getPageResponse(pageId, caller);
}

export default movePageToProject;
