import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { pageTable } from "../../database/schema";
import { publishEvent } from "../../events";
import { pageRoomHooks } from "../content";
import { canTrashPage, PAGE_MESSAGES, type PageCaller } from "../rules";
import { loadVisiblePage, lockPageTree, pageEventPayload } from "./shared";

/**
 * Moves an archived page to the trash (K12, C7). Its children move to the
 * root and stay archived: they may be someone else's, so they never go with
 * it. Everything else waits for a permanent delete (trash/page-trash.ts).
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
    if (!canTrashPage(page, caller)) {
      throw new HTTPException(403, { message: PAGE_MESSAGES.deleteForbidden });
    }
  };
  check(await loadVisiblePage(db, pageId, caller));

  await pageRoomHooks().closeRooms([pageId]);

  const page = await db.transaction(async (tx) => {
    const located = await loadVisiblePage(tx, pageId, caller);
    if (located.projectId) await lockPageTree(tx, located.projectId);
    const current = await loadVisiblePage(tx, pageId, caller, {
      forUpdate: true,
    });
    check(current);
    await tx
      .update(pageTable)
      .set({ parentId: null })
      .where(eq(pageTable.parentId, pageId));
    await tx
      .update(pageTable)
      .set({
        deletedAt: new Date(),
        deletedById: caller.userId,
        parentId: null,
      })
      .where(eq(pageTable.id, pageId));
    return current;
  });

  // Access and title let workspace webhooks skip private pages (D14).
  await publishEvent("page.deleted", {
    ...pageEventPayload(page, caller.userId),
    access: page.access,
    title: page.title,
  });
  return { id: page.id, projectId: page.projectId };
}

export default deletePage;
