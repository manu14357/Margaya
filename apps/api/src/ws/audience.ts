import { and, eq, inArray } from "drizzle-orm";
import db from "../database";
import {
  favoriteTable,
  recentVisitTable,
  workspaceUserTable,
} from "../database/schema";
import type { FavoriteEntityType } from "../entity-reference/types";

// Who gets a user-channel hint. Every audience is drawn from workspace
// membership or from the person's own rows, so a hint never reaches anyone
// outside the workspace it names.

/** Every member of the workspace (people and agents). */
export async function workspaceMemberIds(workspaceId: string) {
  const rows = await db
    .select({ userId: workspaceUserTable.userId })
    .from(workspaceUserTable)
    .where(eq(workspaceUserTable.workspaceId, workspaceId));
  return [...new Set(rows.map((row) => row.userId))];
}

/**
 * The person and everyone who shares a workspace with them: the people who
 * see their name and avatar on tasks, comments and member lists.
 */
export async function coMemberIds(userId: string) {
  const own = db
    .select({ workspaceId: workspaceUserTable.workspaceId })
    .from(workspaceUserTable)
    .where(eq(workspaceUserTable.userId, userId));
  const rows = await db
    .selectDistinct({ userId: workspaceUserTable.userId })
    .from(workspaceUserTable)
    .where(inArray(workspaceUserTable.workspaceId, own));
  const ids = new Set(rows.map((row) => row.userId));
  ids.add(userId);
  return [...ids];
}

/**
 * The people whose favorites or recent visits point at the entities, with the
 * workspace each row belongs to. Both tables index (entity_type, entity_id).
 */
export async function entityReferenceHolders(
  entityType: FavoriteEntityType,
  entityIds: readonly string[],
) {
  const ids = [...new Set(entityIds)];
  if (ids.length === 0) return [];
  const [favorites, recents] = await Promise.all([
    db
      .selectDistinct({
        userId: favoriteTable.userId,
        workspaceId: favoriteTable.workspaceId,
      })
      .from(favoriteTable)
      .where(
        and(
          eq(favoriteTable.entityType, entityType),
          inArray(favoriteTable.entityId, ids),
        ),
      ),
    db
      .selectDistinct({
        userId: recentVisitTable.userId,
        workspaceId: recentVisitTable.workspaceId,
      })
      .from(recentVisitTable)
      .where(
        and(
          eq(recentVisitTable.entityType, entityType),
          inArray(recentVisitTable.entityId, ids),
        ),
      ),
  ]);
  const holders = new Map<string, { userId: string; workspaceId: string }>();
  for (const row of [...favorites, ...recents]) {
    holders.set(`${row.userId}:${row.workspaceId}`, row);
  }
  return [...holders.values()];
}
