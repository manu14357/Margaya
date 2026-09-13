import type { ProjectFeature } from "../project/features";

// Entities that favorites, recent visits and (later) home widgets point at.
// Favorites cover planning entities; tasks are recents-only.
export const FAVORITE_ENTITY_TYPES = [
  "project",
  "cycle",
  "module",
  "view",
  "page",
] as const;

export const RECENT_VISIT_ENTITY_TYPES = [
  "project",
  "task",
  "cycle",
  "module",
  "view",
  "page",
] as const;

export type FavoriteEntityType = (typeof FAVORITE_ENTITY_TYPES)[number];
export type RecentVisitEntityType = (typeof RECENT_VISIT_ENTITY_TYPES)[number];
export type EntityType = RecentVisitEntityType;

/** A display-ready description of a referenced entity. */
export type EntitySummary = {
  type: EntityType;
  id: string;
  name: string;
  /** Task: project key + "-" + number. Project: its key. Others: null. */
  key: string | null;
  icon: string | null;
  projectId: string | null;
  projectName: string | null;
  /** The entity or its project is archived. */
  isArchived: boolean;
  /** The project feature that gates the entity, if any. */
  feature: ProjectFeature | null;
  /** Optional type-specific extras for widgets. */
  details: Record<string, unknown> | null;
  /**
   * Set (internally, never sent) when the entity or its project is in the
   * trash (C7): it reads as gone, but stored references stay so a restore
   * brings them back.
   */
  trashed?: true;
};

/** `{ trashed: true }` when any of the trash stamps is set, else `{}`. */
export function trashedFlag(...stamps: (Date | null | undefined)[]): {
  trashed?: true;
} {
  return stamps.some(Boolean) ? { trashed: true } : {};
}

/** Who is asking, and in which workspace. */
export type EntityResolverContext = {
  workspaceId: string;
  /** The calling user; resolvers of private entities check access with it. */
  userId: string;
};

/**
 * Resolves a batch of ids of one entity type, in one query, returning only
 * the entities that exist inside the workspace and that the calling user
 * may see. Left-out ids read as deleted, so their references are removed.
 */
export type EntityResolver = (
  context: EntityResolverContext,
  ids: string[],
) => Promise<Map<string, EntitySummary>>;
