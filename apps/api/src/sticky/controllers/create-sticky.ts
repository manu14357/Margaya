import { count, min } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { stickyTable } from "../../database/schema";
import { newFavoritePosition } from "../../favorite/ordering";
import {
  LOCK_NAMESPACE,
  lockUserWorkspaceList,
} from "../../utils/user-workspace-lock";
import { DEFAULT_STICKY_COLOR, type StickyColor } from "../colors";
import { stickyPlainText } from "../plain-text";
import { STICKIES_LIMIT } from "../schema";
import { ownStickies, publishStickyChanged, toSticky } from "./shared";

/** Adds a sticky on top of the caller's list, up to 500 per workspace. */
async function createSticky({
  userId,
  workspaceId,
  content = "",
  color = DEFAULT_STICKY_COLOR,
}: {
  userId: string;
  workspaceId: string;
  content?: string;
  color?: StickyColor;
}) {
  const row = await db.transaction(async (tx) => {
    await lockUserWorkspaceList(tx, LOCK_NAMESPACE.sticky, userId, workspaceId);

    const [stats] = await tx
      .select({ total: count(), minPosition: min(stickyTable.position) })
      .from(stickyTable)
      .where(ownStickies(userId, workspaceId));

    if ((stats?.total ?? 0) >= STICKIES_LIMIT) {
      throw new HTTPException(409, {
        message: `You can have up to ${STICKIES_LIMIT} stickies in this workspace`,
      });
    }

    const [inserted] = await tx
      .insert(stickyTable)
      .values({
        userId,
        workspaceId,
        content,
        contentText: stickyPlainText(content),
        color,
        position: newFavoritePosition(stats?.minPosition ?? null),
      })
      .returning();

    if (!inserted) {
      throw new HTTPException(500, { message: "Failed to create sticky" });
    }
    return inserted;
  });

  await publishStickyChanged(userId, workspaceId, row.id, "created");
  return toSticky(row);
}

export default createSticky;
