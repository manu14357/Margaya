import { and, desc, notInArray } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import db from "../../database";
import { recentVisitTable } from "../../database/schema";
import {
  entityRefKey,
  isEntityTypeSupported,
  resolveEntityReferences,
} from "../../entity-reference/registry";
import type { RecentVisitEntityType } from "../../entity-reference/types";
import { RECENT_VISITS_LIMIT } from "../schema";
import { ownRecentVisits, toRecentVisit } from "./shared";

/**
 * Records a visit: upserts the (user, entity) row with a fresh visitedAt,
 * then trims the caller's list in the workspace to the newest 20. Concurrent
 * requests may briefly leave a row or two extra, which the next write trims.
 */
async function recordRecentVisit({
  userId,
  workspaceId,
  entityType,
  entityId,
}: {
  userId: string;
  workspaceId: string;
  entityType: RecentVisitEntityType;
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

  if (!resolved) {
    throw new HTTPException(404, { message: "Entity not found" });
  }

  if (!resolved.available) {
    throw new HTTPException(409, {
      message: "This item can't be added to recent visits right now",
    });
  }

  const visitedAt = new Date();
  const projectId = resolved.summary.projectId;

  const row = await db.transaction(async (tx) => {
    const [upserted] = await tx
      .insert(recentVisitTable)
      .values({
        userId,
        workspaceId,
        projectId,
        entityType,
        entityId,
        visitedAt,
      })
      .onConflictDoUpdate({
        target: [
          recentVisitTable.userId,
          recentVisitTable.entityType,
          recentVisitTable.entityId,
        ],
        set: { visitedAt, projectId },
      })
      .returning();

    const newest = tx
      .select({ id: recentVisitTable.id })
      .from(recentVisitTable)
      .where(ownRecentVisits(userId, workspaceId))
      .orderBy(desc(recentVisitTable.visitedAt), desc(recentVisitTable.id))
      .limit(RECENT_VISITS_LIMIT);

    await tx
      .delete(recentVisitTable)
      .where(
        and(
          ownRecentVisits(userId, workspaceId),
          notInArray(recentVisitTable.id, newest),
        ),
      );

    return upserted;
  });

  if (!row) {
    throw new HTTPException(500, { message: "Failed to record the visit" });
  }

  return toRecentVisit({ ...row, entity: resolved.summary });
}

export default recordRecentVisit;
