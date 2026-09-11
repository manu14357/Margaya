import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { savedViewTable } from "../../database/schema";
import { removeEntityReferences } from "../../entity-reference/registry";
import { publishEvent } from "../../events";
import {
  canManageView,
  lockViewRow,
  type ViewCaller,
  viewEventPayload,
} from "./shared";

export const DELETE_FORBIDDEN =
  "Only the view's owner or an admin can delete it";
export const DELETE_LOCKED =
  "This view is locked. Unlock it before deleting it.";

/**
 * Deletes a view for its owner (with view:update) or an admin (view:delete),
 * along with every favorite and recent visit of it. Tasks are untouched.
 */
async function deleteView({
  viewId,
  caller,
}: {
  viewId: string;
  caller: ViewCaller;
}) {
  const view = await db.transaction(async (tx) => {
    const current = await lockViewRow(tx, viewId, caller.userId);
    if (!canManageView(current, caller)) {
      throw new HTTPException(403, { message: DELETE_FORBIDDEN });
    }
    if (current.isLocked) {
      throw new HTTPException(409, { message: DELETE_LOCKED });
    }
    await tx.delete(savedViewTable).where(eq(savedViewTable.id, viewId));
    return current;
  });

  await removeEntityReferences("view", [viewId]);
  await publishEvent("view.deleted", viewEventPayload(view, caller.userId));
  return { id: view.id, projectId: view.projectId };
}

export default deleteView;
