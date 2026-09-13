import { and, ilike, sql } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { stickyTable } from "../../database/schema";
import { escapeLikePattern } from "../../search/like-pattern";
import { decodeStickyCursor, encodeStickyCursor } from "../cursor";
import { DEFAULT_STICKY_PAGE_SIZE } from "../schema";
import { ownStickies, stickyOrder, toSticky } from "./shared";

/** One page of the caller's stickies in display order, optionally searched. */
async function listStickies({
  userId,
  workspaceId,
  q,
  limit = DEFAULT_STICKY_PAGE_SIZE,
  cursor,
}: {
  userId: string;
  workspaceId: string;
  q?: string;
  limit?: number;
  cursor?: string;
}) {
  const after = cursor ? decodeStickyCursor(cursor) : null;
  if (cursor && !after) {
    throw new HTTPException(400, { message: "Invalid cursor" });
  }

  const search = q?.trim();
  const rows = await db
    .select()
    .from(stickyTable)
    .where(
      and(
        ownStickies(userId, workspaceId),
        search
          ? ilike(stickyTable.contentText, `%${escapeLikePattern(search)}%`)
          : undefined,
        after
          ? sql`(${stickyTable.position}, ${stickyTable.id}) > (${after.position}::integer, ${after.id})`
          : undefined,
      ),
    )
    .orderBy(...stickyOrder)
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map(toSticky),
    nextCursor:
      rows.length > limit && last
        ? encodeStickyCursor({ position: last.position, id: last.id })
        : null,
  };
}

export default listStickies;
