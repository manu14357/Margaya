import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { stickyTable } from "../../database/schema";
import { ownStickies, publishStickyChanged, STICKY_NOT_FOUND } from "./shared";

async function deleteSticky(userId: string, workspaceId: string, id: string) {
  const removed = await db
    .delete(stickyTable)
    .where(and(ownStickies(userId, workspaceId), eq(stickyTable.id, id)))
    .returning({ id: stickyTable.id });

  if (removed.length === 0) {
    throw new HTTPException(404, { message: STICKY_NOT_FOUND });
  }

  await publishStickyChanged(userId, workspaceId, id, "deleted");
  return { removed: true };
}

export default deleteSticky;
