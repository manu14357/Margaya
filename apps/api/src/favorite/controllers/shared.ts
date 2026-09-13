import { and, asc, desc, eq, sql } from "drizzle-orm";
import type db from "../../database";
import { favoriteTable } from "../../database/schema";
import type { EntitySummary } from "../../entity-reference/types";
import { publishEvent } from "../../events";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type FavoriteRow = typeof favoriteTable.$inferSelect;

// Serializes create and reorder per user and workspace, so position reads
// and renumbering cannot interleave (the project ordering precedent).
export async function lockFavorites(
  tx: Transaction,
  userId: string,
  workspaceId: string,
) {
  const lockKey = `${userId}:${workspaceId}`;
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(1525, hashtext(${lockKey}))`,
  );
}

export function ownFavorites(userId: string, workspaceId: string) {
  return and(
    eq(favoriteTable.userId, userId),
    eq(favoriteTable.workspaceId, workspaceId),
  );
}

export const favoriteOrder = [
  asc(favoriteTable.position),
  desc(favoriteTable.createdAt),
  asc(favoriteTable.id),
];

export function toFavorite(row: FavoriteRow & { entity: EntitySummary }) {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    entityType: row.entityType,
    entityId: row.entityId,
    position: row.position,
    createdAt: row.createdAt,
    entity: row.entity,
  };
}

export async function publishFavoritesChanged(
  userId: string,
  workspaceId: string,
) {
  await publishEvent("favorite.changed", { userId, workspaceId });
}
