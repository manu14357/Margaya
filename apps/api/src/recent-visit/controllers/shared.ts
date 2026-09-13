import { and, eq } from "drizzle-orm";
import { recentVisitTable } from "../../database/schema";
import type { EntitySummary } from "../../entity-reference/types";

type RecentVisitRow = typeof recentVisitTable.$inferSelect;

export function ownRecentVisits(userId: string, workspaceId: string) {
  return and(
    eq(recentVisitTable.userId, userId),
    eq(recentVisitTable.workspaceId, workspaceId),
  );
}

export function toRecentVisit(row: RecentVisitRow & { entity: EntitySummary }) {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    projectId: row.projectId,
    entityType: row.entityType,
    entityId: row.entityId,
    visitedAt: row.visitedAt,
    entity: row.entity,
  };
}
