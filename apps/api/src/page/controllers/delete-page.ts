import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { pageReferenceTable, pageTable } from "../../database/schema";
import { removeEntityReferences } from "../../entity-reference/registry";
import { publishEvent } from "../../events";
import { cleanUpDeletedPageAssets, pageAssets } from "../assets";
import { pageRoomHooks } from "../content";
import { isPageOwner, PAGE_MESSAGES, type PageCaller } from "../rules";
import { loadVisiblePage, pageEventPayload } from "./shared";

/**
 * Deletes an archived page with its versions and references (K12). Its
 * children move to the root and stay archived. Links to it, favorites,
 * recent visits and its files are cleaned up after the commit, best effort.
 */
async function deletePage({
  pageId,
  caller,
}: {
  pageId: string;
  caller: PageCaller;
}) {
  const check = (page: Awaited<ReturnType<typeof loadVisiblePage>>) => {
    if (page.archivedAt === null) {
      throw new HTTPException(409, {
        message: PAGE_MESSAGES.deleteNotArchived,
      });
    }
    if (
      !((isPageOwner(page, caller) && caller.canUpdate) || caller.isManager)
    ) {
      throw new HTTPException(403, { message: PAGE_MESSAGES.deleteForbidden });
    }
  };
  check(await loadVisiblePage(db, pageId, caller));

  await pageRoomHooks().closeRooms([pageId]);
  const assets = await pageAssets(pageId);

  const page = await db.transaction(async (tx) => {
    const current = await loadVisiblePage(tx, pageId, caller, {
      forUpdate: true,
    });
    check(current);
    await tx.delete(pageTable).where(eq(pageTable.id, pageId));
    return current;
  });

  try {
    await db
      .delete(pageReferenceTable)
      .where(
        and(
          eq(pageReferenceTable.entityType, "page"),
          eq(pageReferenceTable.entityId, pageId),
        ),
      );
    await removeEntityReferences("page", [pageId]);
    await cleanUpDeletedPageAssets(page, assets);
  } catch (error) {
    console.error("Page delete cleanup failed:", error);
  }

  // Access and title let workspace webhooks skip private pages (D14).
  await publishEvent("page.deleted", {
    ...pageEventPayload(page, caller.userId),
    access: page.access,
    title: page.title,
  });
  return { id: page.id, projectId: page.projectId };
}

export default deletePage;
