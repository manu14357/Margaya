import { markdownToJson } from "@margaya/editor-schema";
import { createId } from "@paralleldrive/cuid2";
import { HTTPException } from "hono/http-exception";
import { aiWriteProvenance } from "../../ai/provenance";
import db from "../../database";
import { pageTable } from "../../database/schema";
import { publishEvent } from "../../events";
import { buildPageContent } from "../content";
import { syncPageReferences } from "../references";
import {
  depthOf,
  fitsDepthLimit,
  PAGE_MESSAGES,
  type PageCaller,
  placeAmongSiblings,
} from "../rules";
import type { CreatePageInput } from "../schema";
import { loadUsableTemplate } from "../templates";
import {
  assertProjectPageRoom,
  nextPosition,
  positionsOf,
  siblingOrder,
  writeSiblingOrder,
} from "../tree";
import type { PageAccess } from "../types";
import { readLogo } from "./logo";
import { assertParentNotArchived, loadParentPage } from "./parent";
import {
  getPageResponse,
  lockPageTree,
  pageEventPayload,
  projectParentMap,
} from "./shared";

/**
 * Creates a page owned by the caller (§3.4): at the end of its siblings, or
 * right after `afterId`. Content arrives as markdown and is stored as a
 * fresh Yjs state with its projections. Under a private parent the page is
 * private, and only the parent's owner may add to it.
 */
async function createPage({
  workspaceId,
  projectId,
  input,
  caller,
}: {
  workspaceId: string;
  projectId: string;
  input: CreatePageInput;
  caller: PageCaller;
}) {
  const template = input.templateId
    ? await loadUsableTemplate(input.templateId, workspaceId, projectId)
    : null;
  const logo =
    readLogo(input) ??
    (template?.logoKind && template.logoValue
      ? { logoKind: template.logoKind, logoValue: template.logoValue }
      : { logoKind: null, logoValue: null });
  const json = markdownToJson(
    template ? template.contentMarkdown : (input.content ?? ""),
  );
  const content = buildPageContent(json);
  const aiProvenance = await aiWriteProvenance({
    workspaceId,
    userId: caller.userId,
    assist: input.aiAssist,
  });

  const { page, newlyMentionedUserIds } = await db.transaction(async (tx) => {
    await lockPageTree(tx, projectId);
    await assertProjectPageRoom(tx, projectId, 1);

    const parentId = input.parentId ?? null;
    let access: PageAccess = input.access ?? "public";
    if (parentId) {
      const parent = await loadParentPage(tx, {
        parentId,
        workspaceId,
        projectId,
        caller,
      });
      assertParentNotArchived(parent);
      const parentOf = await projectParentMap(tx, projectId);
      if (!fitsDepthLimit(depthOf(parent.id, parentOf), 1)) {
        throw new HTTPException(400, { message: PAGE_MESSAGES.tooDeep });
      }
      if (parent.access === "private") {
        if (parent.ownerId !== caller.userId) {
          throw new HTTPException(409, {
            message: PAGE_MESSAGES.privateParent,
          });
        }
        access = "private";
      }
    }

    const id = createId();
    let order: string[] | null = null;
    let position = 0;
    if (input.afterId === undefined) {
      position = await nextPosition(tx, projectId, parentId);
    } else {
      order = placeAmongSiblings(
        await siblingOrder(tx, projectId, parentId),
        id,
        input.afterId,
      );
      if (!order) {
        throw new HTTPException(400, { message: PAGE_MESSAGES.notSibling });
      }
      position = order.indexOf(id);
    }
    const current = order ? await positionsOf(tx, projectId, parentId) : null;

    const now = new Date();
    const [created] = await tx
      .insert(pageTable)
      .values({
        id,
        workspaceId,
        projectId,
        parentId,
        position,
        title: input.title ?? template?.name ?? "",
        ...logo,
        access,
        ownerId: caller.userId,
        isFullWidth: input.isFullWidth ?? false,
        ...content,
        contentVersion: 1,
        aiProvenance,
        createdById: caller.userId,
        updatedById: caller.userId,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!created) throw new Error("Failed to create the page");

    if (order && current) {
      current.set(id, position);
      await writeSiblingOrder(tx, order, current);
    }

    const mentioned = await syncPageReferences(tx, {
      page: created,
      json,
      actorId: caller.userId,
    });
    return { page: created, newlyMentionedUserIds: mentioned };
  });

  await publishEvent("page.created", {
    ...pageEventPayload(page, caller.userId),
    parentId: page.parentId,
    // Mentions copied from a template are not new: nobody is notified.
    newlyMentionedUserIds: template ? [] : newlyMentionedUserIds,
  });
  return getPageResponse(page.id, caller);
}

export default createPage;
