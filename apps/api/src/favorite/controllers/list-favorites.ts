import { inArray } from "drizzle-orm";
import db from "../../database";
import { favoriteTable } from "../../database/schema";
import { partitionReferenceRows } from "../../entity-reference/registry";
import { favoriteOrder, ownFavorites, toFavorite } from "./shared";

/**
 * The caller's favorites in the workspace. Rows whose entity is gone are
 * deleted here; archived or feature-disabled ones are hidden but kept, so
 * they come back once restored.
 */
async function listFavorites(userId: string, workspaceId: string) {
  const rows = await db
    .select()
    .from(favoriteTable)
    .where(ownFavorites(userId, workspaceId))
    .orderBy(...favoriteOrder);

  const { visible, missing } = await partitionReferenceRows(
    { workspaceId, userId },
    rows,
  );

  if (missing.length > 0) {
    await db.delete(favoriteTable).where(
      inArray(
        favoriteTable.id,
        missing.map((row) => row.id),
      ),
    );
  }

  return visible.map(toFavorite);
}

export default listFavorites;
