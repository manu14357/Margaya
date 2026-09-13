import { and, eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { favoriteTable } from "../../database/schema";
import type { FavoriteEntityType } from "../../entity-reference/types";
import { ownFavorites, publishFavoritesChanged } from "./shared";

export async function deleteFavorite(
  userId: string,
  workspaceId: string,
  id: string,
) {
  const removed = await db
    .delete(favoriteTable)
    .where(and(ownFavorites(userId, workspaceId), eq(favoriteTable.id, id)))
    .returning({ id: favoriteTable.id });

  // Another user's favorite is indistinguishable from a missing one.
  if (removed.length === 0) {
    throw new HTTPException(404, { message: "Favorite not found" });
  }

  await publishFavoritesChanged(userId, workspaceId);
  return { removed: true };
}

export async function deleteFavoriteByEntity(
  userId: string,
  workspaceId: string,
  entityType: FavoriteEntityType,
  entityId: string,
) {
  const removed = await db
    .delete(favoriteTable)
    .where(
      and(
        ownFavorites(userId, workspaceId),
        eq(favoriteTable.entityType, entityType),
        eq(favoriteTable.entityId, entityId),
      ),
    )
    .returning({ id: favoriteTable.id });

  if (removed.length > 0) {
    await publishFavoritesChanged(userId, workspaceId);
  }

  return { removed: removed.length > 0 };
}
