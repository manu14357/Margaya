import { and, eq, inArray, ne } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { pageTable } from "../../database/schema";
import { publishEvent } from "../../events";
import {
  childrenMap,
  depthOf,
  fitsDepthLimit,
  isOwnDescendant,
  PAGE_MESSAGES,
  type PageCaller,
  placeAmongSiblings,
  privateParentAllows,
  subtreeHeight,
  subtreeIds,
} from "../rules";
import type { MovePageInTreeInput } from "../schema";
import { positionsOf, siblingOrder, writeSiblingOrder } from "../tree";
import { removeOtherUsersReferences } from "./access-page";
import { assertParentNotArchived, loadParentPage } from "./parent";
import {
  loadVisiblePage,
  lockPageTree,
  pageEventPayload,
  projectParentMap,
  toPageSummary,
} from "./shared";
import { assertCanEdit } from "./update-page";

/**
 * Moves a page (with its subtree) under another parent of the same project,
 * right after `afterId` (first when null), renumbering the destination
 * siblings. Rules T1-T4 and T7; `updatedAt` is not bumped. A subtree placed
 * under a private parent becomes private.
 */
async function movePageInTree({
  pageId,
  input,
  caller,
}: {
  pageId: string;
  input: MovePageInTreeInput;
  caller: PageCaller;
}) {
  const result = await db.transaction(async (tx) => {
    const located = await loadVisiblePage(tx, pageId, caller);
    const projectId = located.projectId;
    if (!projectId)
      throw new HTTPException(404, { message: PAGE_MESSAGES.notFound });
    await lockPageTree(tx, projectId);
    const page = await loadVisiblePage(tx, pageId, caller, { forUpdate: true });
    assertCanEdit(page, caller);

    const parentOf = await projectParentMap(tx, projectId);
    const children = childrenMap(parentOf);
    const subtree = subtreeIds(page.id, children);
    const parentId = input.parentId;

    let madePrivate: string[] = [];
    if (parentId !== null) {
      const parent = await loadParentPage(tx, {
        parentId,
        workspaceId: page.workspaceId,
        projectId,
        caller,
      });
      if (isOwnDescendant(page.id, parent.id, parentOf)) {
        throw new HTTPException(400, { message: PAGE_MESSAGES.insideItself });
      }
      assertParentNotArchived(parent);
      if (
        !fitsDepthLimit(
          depthOf(parent.id, parentOf),
          subtreeHeight(page.id, children),
        )
      ) {
        throw new HTTPException(400, { message: PAGE_MESSAGES.tooDeep });
      }
      if (parent.access === "private") {
        const owners = await tx
          .select({
            id: pageTable.id,
            ownerId: pageTable.ownerId,
            access: pageTable.access,
          })
          .from(pageTable)
          .where(inArray(pageTable.id, subtree));
        if (
          !privateParentAllows(
            parent,
            owners.map((row) => row.ownerId),
            caller.userId,
          )
        ) {
          throw new HTTPException(409, {
            message: PAGE_MESSAGES.privateParent,
          });
        }
        madePrivate = owners
          .filter((row) => row.access !== "private")
          .map((row) => row.id);
      }
    }

    const order = placeAmongSiblings(
      await siblingOrder(tx, projectId, parentId),
      page.id,
      input.afterId ?? null,
    );
    if (!order) {
      throw new HTTPException(400, { message: PAGE_MESSAGES.notSibling });
    }

    const current = await positionsOf(tx, projectId, parentId);
    if (page.parentId !== parentId) {
      await tx
        .update(pageTable)
        .set({ parentId })
        .where(eq(pageTable.id, page.id));
      current.delete(page.id);
    }
    await writeSiblingOrder(tx, order, current);

    if (madePrivate.length > 0) {
      await tx
        .update(pageTable)
        .set({ access: "private" })
        .where(
          and(
            inArray(pageTable.id, madePrivate),
            ne(pageTable.access, "private"),
          ),
        );
    }

    parentOf.set(page.id, parentId);
    const [moved] = await tx
      .select()
      .from(pageTable)
      .where(eq(pageTable.id, page.id));
    if (!moved)
      throw new HTTPException(404, { message: PAGE_MESSAGES.notFound });
    return { moved, parentOf, madePrivate };
  });

  const payload = pageEventPayload(result.moved, caller.userId);
  await publishEvent("page.reordered", {
    ...payload,
    parentId: result.moved.parentId,
  });
  if (result.madePrivate.length > 0) {
    await removeOtherUsersReferences(result.madePrivate, caller.userId);
    await publishEvent("page.access_changed", {
      ...payload,
      access: "private",
      affectedPageIds: result.madePrivate,
    });
  }
  return toPageSummary(result.moved, caller, result.parentOf);
}

export default movePageInTree;
