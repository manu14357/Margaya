import { and, desc, eq, inArray } from "drizzle-orm";
import db from "../../database";
import { recentVisitTable } from "../../database/schema";
import { partitionReferenceRows } from "../../entity-reference/registry";
import type { RecentVisitEntityType } from "../../entity-reference/types";
import { RECENT_VISITS_LIMIT } from "../schema";
import { ownRecentVisits, toRecentVisit } from "./shared";

/**
 * The caller's recent visits in the workspace, newest first. Like favorites,
 * visits of deleted entities are removed and archived or feature-disabled
 * ones are hidden.
 */
async function listRecentVisits(
  userId: string,
  workspaceId: string,
  {
    entityType,
    limit = RECENT_VISITS_LIMIT,
  }: { entityType?: RecentVisitEntityType; limit?: number } = {},
) {
  const rows = await db
    .select()
    .from(recentVisitTable)
    .where(
      and(
        ownRecentVisits(userId, workspaceId),
        entityType ? eq(recentVisitTable.entityType, entityType) : undefined,
      ),
    )
    .orderBy(desc(recentVisitTable.visitedAt), desc(recentVisitTable.id));

  const { visible, missing } = await partitionReferenceRows(
    { workspaceId, userId },
    rows,
  );

  if (missing.length > 0) {
    await db.delete(recentVisitTable).where(
      inArray(
        recentVisitTable.id,
        missing.map((row) => row.id),
      ),
    );
  }

  return visible.slice(0, limit).map(toRecentVisit);
}

export default listRecentVisits;
