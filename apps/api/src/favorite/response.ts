import { entitySummarySchema } from "../entity-reference/response";
import { FAVORITE_ENTITY_TYPES } from "../entity-reference/types";
import { responseTimestamp, z } from "../openapi";

export const favoriteSchema = z
  .object({
    id: z.string(),
    workspaceId: z.string(),
    projectId: z.string().nullable().openapi({
      description:
        "The project the entity lives in (the entity itself for projects).",
    }),
    entityType: z.enum(FAVORITE_ENTITY_TYPES),
    entityId: z.string(),
    position: z.number().openapi({
      description: "Display order, ascending. New favorites go on top.",
    }),
    createdAt: responseTimestamp,
    entity: entitySummarySchema,
  })
  .openapi("Favorite");

export const favoriteListSchema = z.array(favoriteSchema);

export const favoriteRemovalSchema = z
  .object({ removed: z.boolean() })
  .openapi("FavoriteRemoval");
