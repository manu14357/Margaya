import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { favoriteTable } from "../../database/schema";
import { mergeRequestedOrder } from "../ordering";
import listFavorites from "./list-favorites";
import {
  favoriteOrder,
  lockFavorites,
  ownFavorites,
  publishFavoritesChanged,
} from "./shared";

async function reorderFavorites(
  userId: string,
  workspaceId: string,
  favoriteIds: string[],
) {
  await db.transaction(async (tx) => {
    await lockFavorites(tx, userId, workspaceId);

    // Hidden favorites (archived, feature off) are part of the ordering too,
    // so they hold their rank without the client sending them.
    const existing = await tx
      .select({ id: favoriteTable.id, position: favoriteTable.position })
      .from(favoriteTable)
      .where(ownFavorites(userId, workspaceId))
      .orderBy(...favoriteOrder);

    // Check the whole batch before writing, so a foreign id cannot leave the
    // list half-renumbered.
    const ownedIds = new Set(existing.map((favorite) => favorite.id));
    const foreignId = favoriteIds.find((id) => !ownedIds.has(id));
    if (foreignId) {
      throw new HTTPException(400, {
        message: `Favorite ${foreignId} does not belong to you`,
      });
    }

    const finalOrder = mergeRequestedOrder(
      existing.map((favorite) => favorite.id),
      favoriteIds,
    );
    const currentPositions = new Map(
      existing.map((favorite) => [favorite.id, favorite.position]),
    );

    for (const [position, id] of finalOrder.entries()) {
      if (currentPositions.get(id) === position) continue;
      await tx
        .update(favoriteTable)
        .set({ position })
        .where(eq(favoriteTable.id, id));
    }
  });

  await publishFavoritesChanged(userId, workspaceId);
  return listFavorites(userId, workspaceId);
}

export default reorderFavorites;
