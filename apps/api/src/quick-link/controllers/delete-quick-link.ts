import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { quickLinkTable } from "../../database/schema";
import {
  ownQuickLinks,
  publishQuickLinkChanged,
  QUICK_LINK_NOT_FOUND,
} from "./shared";

async function deleteQuickLink(
  userId: string,
  workspaceId: string,
  id: string,
) {
  const removed = await db
    .delete(quickLinkTable)
    .where(and(ownQuickLinks(userId, workspaceId), eq(quickLinkTable.id, id)))
    .returning({ id: quickLinkTable.id });

  if (removed.length === 0) {
    throw new HTTPException(404, { message: QUICK_LINK_NOT_FOUND });
  }

  await publishQuickLinkChanged(userId, workspaceId, id, "deleted");
  return { removed: true };
}

export default deleteQuickLink;
