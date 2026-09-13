import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { pageTable } from "../../database/schema";
import { publishEvent } from "../../events";
import { canManagePage, PAGE_MESSAGES, type PageCaller } from "../rules";
import { getPageResponse, loadVisiblePage, pageEventPayload } from "./shared";

/**
 * Locks (read-only for everyone, the owner included) or unlocks a page, for
 * its owner or a page manager. The state it is already in changes nothing
 * and publishes nothing.
 */
async function setPageLock({
  pageId,
  locked,
  caller,
}: {
  pageId: string;
  locked: boolean;
  caller: PageCaller;
}) {
  const result = await db.transaction(async (tx) => {
    const page = await loadVisiblePage(tx, pageId, caller, { forUpdate: true });
    if (!canManagePage(page, caller)) {
      throw new HTTPException(403, { message: PAGE_MESSAGES.ownerOrManager });
    }
    if (page.isLocked === locked) return { page, changed: false };
    await tx
      .update(pageTable)
      .set({
        isLocked: locked,
        lockedById: locked ? caller.userId : null,
        lockedAt: locked ? new Date() : null,
      })
      .where(eq(pageTable.id, page.id));
    return { page, changed: true };
  });

  if (result.changed) {
    await publishEvent(
      locked ? "page.locked" : "page.unlocked",
      pageEventPayload(result.page, caller.userId),
    );
  }
  return getPageResponse(pageId, caller);
}

export default setPageLock;
