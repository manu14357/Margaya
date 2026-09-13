import { and, count, eq, min } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { favoriteTable } from "../../database/schema";
import {
  entityRefKey,
  isEntityTypeSupported,
  resolveEntityReferences,
} from "../../entity-reference/registry";
import type { FavoriteEntityType } from "../../entity-reference/types";
import { FAVORITES_LIMIT, newFavoritePosition } from "../ordering";
import {
  lockFavorites,
  ownFavorites,
  publishFavoritesChanged,
  toFavorite,
} from "./shared";

/** Adds a favorite on top of the list; an existing one is returned as is. */
async function createFavorite({
  userId,
  workspaceId,
  entityType,
  entityId,
}: {
  userId: string;
  workspaceId: string;
  entityType: FavoriteEntityType;
  entityId: string;
}) {
  if (!isEntityTypeSupported(entityType)) {
    throw new HTTPException(400, { message: "Unsupported entity type" });
  }

  const resolved = (
    await resolveEntityReferences({ workspaceId, userId }, [
      { entityType, entityId },
    ])
  ).get(entityRefKey(entityType, entityId));

  // Entities outside this workspace look exactly like missing ones.
  if (!resolved) {
    throw new HTTPException(404, { message: "Entity not found" });
  }

  const { row, created } = await db.transaction(async (tx) => {
    await lockFavorites(tx, userId, workspaceId);

    const [existing] = await tx
      .select()
      .from(favoriteTable)
      .where(
        and(
          eq(favoriteTable.userId, userId),
          eq(favoriteTable.entityType, entityType),
          eq(favoriteTable.entityId, entityId),
        ),
      )
      .limit(1);

    if (existing) return { row: existing, created: false };

    if (!resolved.available) {
      throw new HTTPException(409, {
        message: "This item can't be added to favorites right now",
      });
    }

    const [stats] = await tx
      .select({ total: count(), minPosition: min(favoriteTable.position) })
      .from(favoriteTable)
      .where(ownFavorites(userId, workspaceId));

    if ((stats?.total ?? 0) >= FAVORITES_LIMIT) {
      throw new HTTPException(409, {
        message: `You can have up to ${FAVORITES_LIMIT} favorites`,
      });
    }

    const [inserted] = await tx
      .insert(favoriteTable)
      .values({
        userId,
        workspaceId,
        projectId: resolved.summary.projectId,
        entityType,
        entityId,
        position: newFavoritePosition(stats?.minPosition ?? null),
      })
      .returning();

    if (!inserted) {
      throw new HTTPException(500, { message: "Failed to add favorite" });
    }

    return { row: inserted, created: true };
  });

  if (created) {
    await publishFavoritesChanged(userId, workspaceId);
  }

  return toFavorite({ ...row, entity: resolved.summary });
}

export default createFavorite;
