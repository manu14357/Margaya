import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { stickyTable } from "../../database/schema";
import type { StickyColor } from "../colors";
import { stickyPlainText } from "../plain-text";
import {
  ownStickies,
  publishStickyChanged,
  STICKY_NOT_FOUND,
  toSticky,
} from "./shared";

/**
 * Changes a sticky's content and/or color. Last write wins; sending the
 * stored values writes nothing and publishes nothing.
 */
async function updateSticky({
  userId,
  workspaceId,
  id,
  content,
  color,
}: {
  userId: string;
  workspaceId: string;
  id: string;
  content?: string;
  color?: StickyColor;
}) {
  if (content === undefined && color === undefined) {
    throw new HTTPException(400, {
      message: "Provide content or color to update",
    });
  }

  const own = and(ownStickies(userId, workspaceId), eq(stickyTable.id, id));
  const [current] = await db.select().from(stickyTable).where(own).limit(1);
  // Another user's sticky is indistinguishable from a missing one.
  if (!current) throw new HTTPException(404, { message: STICKY_NOT_FOUND });

  const changes: Partial<typeof stickyTable.$inferInsert> = {};
  if (content !== undefined && content !== current.content) {
    changes.content = content;
    changes.contentText = stickyPlainText(content);
  }
  if (color !== undefined && color !== current.color) {
    changes.color = color;
  }
  if (Object.keys(changes).length === 0) return toSticky(current);

  const [updated] = await db
    .update(stickyTable)
    .set(changes)
    .where(own)
    .returning();
  if (!updated) throw new HTTPException(404, { message: STICKY_NOT_FOUND });

  await publishStickyChanged(userId, workspaceId, id, "updated");
  return toSticky(updated);
}

export default updateSticky;
