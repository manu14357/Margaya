import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { savedViewTable } from "../../database/schema";
import { publishEvent } from "../../events";
import {
  canManageView,
  getViewResponse,
  lockViewRow,
  type ViewCaller,
  viewEventPayload,
} from "./shared";
import { CHANGE_FORBIDDEN } from "./update-view";

/**
 * Locks (read-only for everyone until unlocked) or unlocks a view, for its
 * owner with view:update or anyone with view:delete. Asking for the state the
 * view is already in changes nothing and publishes nothing.
 */
async function setViewLock({
  viewId,
  locked,
  caller,
}: {
  viewId: string;
  locked: boolean;
  caller: ViewCaller;
}) {
  const result = await db.transaction(async (tx) => {
    const current = await lockViewRow(tx, viewId, caller.userId);
    if (!canManageView(current, caller)) {
      throw new HTTPException(403, { message: CHANGE_FORBIDDEN });
    }
    if (current.isLocked === locked) return { view: current, changed: false };
    const [updated] = await tx
      .update(savedViewTable)
      .set({ isLocked: locked, lockedBy: locked ? caller.userId : null })
      .where(eq(savedViewTable.id, viewId))
      .returning();
    return { view: updated ?? current, changed: true };
  });

  if (result.changed) {
    await publishEvent("view.updated", {
      ...viewEventPayload(result.view, caller.userId),
      changes: ["isLocked"],
    });
  }
  return getViewResponse(viewId, caller);
}

export default setViewLock;
