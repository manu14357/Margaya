import { createId } from "@paralleldrive/cuid2";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { pageTable } from "../../database/schema";
import { publishEvent } from "../../events";
import { buildPageContent, currentPageDocument } from "../content";
import { syncPageReferences } from "../references";
import {
  duplicateTitle,
  PAGE_MESSAGES,
  type PageCaller,
  placeAmongSiblings,
} from "../rules";
import {
  assertProjectPageRoom,
  positionsOf,
  siblingOrder,
  writeSiblingOrder,
} from "../tree";
import {
  getPageResponse,
  loadVisiblePage,
  lockPageTree,
  pageEventPayload,
} from "./shared";

/**
 * Copies one page (not its children) as "{title} (copy)", owned by the
 * caller, right after the source, unlocked, with the source's current
 * content as a fresh Yjs document. References are copied, versions are not.
 */
async function duplicatePage({
  pageId,
  caller,
}: {
  pageId: string;
  caller: PageCaller;
}) {
  const source = await loadVisiblePage(db, pageId, caller);
  const projectId = source.projectId;
  if (!projectId)
    throw new HTTPException(404, { message: PAGE_MESSAGES.notFound });
  const json = await currentPageDocument(source);
  const content = buildPageContent(json);

  const copy = await db.transaction(async (tx) => {
    await lockPageTree(tx, projectId);
    await assertProjectPageRoom(tx, projectId, 1);
    await loadVisiblePage(tx, pageId, caller);

    const id = createId();
    const order = placeAmongSiblings(
      await siblingOrder(tx, projectId, source.parentId),
      id,
      source.id,
    );
    const current = await positionsOf(tx, projectId, source.parentId);
    const position = order ? order.indexOf(id) : current.size;

    const now = new Date();
    const [created] = await tx
      .insert(pageTable)
      .values({
        id,
        workspaceId: source.workspaceId,
        projectId,
        parentId: source.parentId,
        position,
        title: duplicateTitle(source.title),
        logoKind: source.logoKind,
        logoValue: source.logoValue,
        access: source.access,
        ownerId: caller.userId,
        isFullWidth: source.isFullWidth,
        ...content,
        contentVersion: 1,
        createdById: caller.userId,
        updatedById: caller.userId,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!created) throw new Error("Failed to duplicate the page");

    if (order) {
      current.set(id, position);
      await writeSiblingOrder(tx, order, current);
    }
    await syncPageReferences(tx, {
      page: created,
      json,
      actorId: caller.userId,
    });
    return created;
  });

  // Copied mentions are not new: nobody is notified again.
  await publishEvent("page.created", {
    ...pageEventPayload(copy, caller.userId),
    parentId: copy.parentId,
    duplicatedFromId: source.id,
    newlyMentionedUserIds: [],
  });
  return getPageResponse(copy.id, caller);
}

export default duplicatePage;
