import { RECENT_VISIT_ENTITY_TYPES } from "../entity-reference/types";
import { z } from "../openapi";

export const RECENT_VISITS_LIMIT = 20;

const recentVisitEntityType = z.enum(RECENT_VISIT_ENTITY_TYPES).openapi({
  description:
    "What was visited. Types whose feature has not shipped yet are rejected as unsupported.",
});

export const recordRecentVisitBody = z.object({
  workspaceId: z.string(),
  entityType: recentVisitEntityType,
  entityId: z.string().min(1),
});

export const listRecentVisitsQuery = z.object({
  workspaceId: z.string(),
  entityType: recentVisitEntityType.optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(RECENT_VISITS_LIMIT)
    .optional()
    .openapi({ description: "At most this many visits (1-20, default 20)." }),
});
