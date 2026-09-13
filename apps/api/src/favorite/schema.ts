import { FAVORITE_ENTITY_TYPES } from "../entity-reference/types";
import { z } from "../openapi";

export const workspaceIdQuery = z.object({ workspaceId: z.string() });

export const favoriteEntityType = z.enum(FAVORITE_ENTITY_TYPES).openapi({
  description:
    "What the favorite points at. Types whose feature has not shipped yet are rejected as unsupported.",
});

export const createFavoriteBody = z.object({
  workspaceId: z.string(),
  entityType: favoriteEntityType,
  entityId: z.string().min(1),
});

export const favoriteParam = z.object({ id: z.string() });

export const favoriteEntityParam = z.object({
  entityType: favoriteEntityType,
  entityId: z.string(),
});

export const reorderFavoritesBody = z.object({
  favoriteIds: z
    .array(z.string())
    .min(1)
    .refine((ids) => new Set(ids).size === ids.length, {
      message: "Favorite ids must be unique",
    })
    .openapi({
      description:
        "Favorite ids in their new relative order. Omitted favorites keep their rank.",
    }),
});
