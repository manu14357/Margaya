import { entitySummarySchema } from "../entity-reference/response";
import { RECENT_VISIT_ENTITY_TYPES } from "../entity-reference/types";
import { responseTimestamp, z } from "../openapi";

export const recentVisitSchema = z
  .object({
    id: z.string(),
    workspaceId: z.string(),
    projectId: z.string().nullable(),
    entityType: z.enum(RECENT_VISIT_ENTITY_TYPES),
    entityId: z.string(),
    visitedAt: responseTimestamp.openapi({
      description:
        "The most recent visit; lists are ordered by it, newest first.",
    }),
    entity: entitySummarySchema,
  })
  .openapi("RecentVisit");

export const recentVisitListSchema = z.array(recentVisitSchema);
