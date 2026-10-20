import { and, eq, inArray } from "drizzle-orm";
import db from "../database";
import {
  favoriteTable,
  projectTable,
  recentVisitTable,
} from "../database/schema";
import { projectFeatureField } from "../project/features";
import { hiddenProjectIds } from "../project/visibility";
import { resolveCycles } from "./resolvers/cycle";
import { resolveModules } from "./resolvers/module";
import { resolvePages } from "./resolvers/page";
import { resolveProjects } from "./resolvers/project";
import { resolveTasks } from "./resolvers/task";
import { resolveViews } from "./resolvers/view";
import {
  type EntityResolver,
  type EntityResolverContext,
  type EntitySummary,
  type EntityType,
  FAVORITE_ENTITY_TYPES,
  type FavoriteEntityType,
} from "./types";

// One batch resolver per entity type. Types without a resolver (their slice
// is not integrated yet) are rejected on write and kept hidden on read.
const resolvers = new Map<EntityType, EntityResolver>([
  ["project", resolveProjects],
  ["task", resolveTasks],
  ["cycle", resolveCycles],
  ["module", resolveModules],
  ["view", resolveViews],
  ["page", resolvePages],
]);

export function registerEntityResolver(
  type: EntityType,
  resolver: EntityResolver,
) {
  resolvers.set(type, resolver);
}

export function isFavoriteEntityType(
  type: EntityType,
): type is FavoriteEntityType {
  return (FAVORITE_ENTITY_TYPES as readonly string[]).includes(type);
}

export function isEntityTypeSupported(type: EntityType): boolean {
  return resolvers.has(type);
}

type EntityRef = { entityType: EntityType; entityId: string };

export type ResolvedEntity = {
  summary: EntitySummary;
  /** Not archived, and its gating feature (if any) is turned on. */
  available: boolean;
  /** In a restricted project the caller may not see. */
  restricted?: boolean;
};

export function entityRefKey(type: string, id: string) {
  return `${type}:${id}`;
}

async function enabledFeatureLookup(summaries: EntitySummary[]) {
  const projectIds = [
    ...new Set(
      summaries
        .filter((summary) => summary.feature && summary.projectId)
        .map((summary) => summary.projectId as string),
    ),
  ];
  if (projectIds.length === 0) return () => true;

  const projects = await db
    .select()
    .from(projectTable)
    .where(inArray(projectTable.id, projectIds));
  const byId = new Map(projects.map((project) => [project.id, project]));

  return (summary: EntitySummary) => {
    if (!summary.feature || !summary.projectId) return true;
    const project = byId.get(summary.projectId);
    return Boolean(project?.[projectFeatureField(summary.feature)]);
  };
}

/** Like resolveEntityReferences, trashed entities (C7) included. */
async function resolveWithTrashed(
  context: EntityResolverContext,
  refs: EntityRef[],
): Promise<Map<string, ResolvedEntity>> {
  const idsByType = new Map<EntityType, Set<string>>();
  for (const ref of refs) {
    if (!resolvers.has(ref.entityType)) continue;
    const ids = idsByType.get(ref.entityType) ?? new Set<string>();
    ids.add(ref.entityId);
    idsByType.set(ref.entityType, ids);
  }

  const summaries: EntitySummary[] = [];
  for (const [type, ids] of idsByType) {
    const resolver = resolvers.get(type);
    if (!resolver) continue;
    const found = await resolver(context, [...ids]);
    summaries.push(...found.values());
  }

  const isFeatureEnabled = await enabledFeatureLookup(summaries);
  const hidden = new Set(
    await hiddenProjectIds(context.userId, context.workspaceId),
  );

  return new Map(
    summaries.map((summary) => {
      // In a restricted project the caller may not see (project/visibility.ts).
      const restricted = Boolean(
        summary.projectId && hidden.has(summary.projectId),
      );
      return [
        entityRefKey(summary.type, summary.id),
        {
          summary,
          restricted,
          available:
            !restricted &&
            !summary.isArchived &&
            !summary.trashed &&
            isFeatureEnabled(summary),
        },
      ];
    }),
  );
}

/**
 * Resolves references inside one workspace, for the calling user, with one
 * query per entity type plus at most one for feature flags. Missing keys mean
 * the entity does not exist in this workspace, is in the trash, the user may
 * not see it, or its type is unsupported.
 */
export async function resolveEntityReferences(
  context: EntityResolverContext,
  refs: EntityRef[],
): Promise<Map<string, ResolvedEntity>> {
  const resolved = await resolveWithTrashed(context, refs);
  for (const [key, entity] of resolved) {
    if (entity.summary.trashed || entity.restricted) resolved.delete(key);
  }
  return resolved;
}

type ReferenceRow = { id: string; entityType: EntityType; entityId: string };

/**
 * Splits stored reference rows into the ones to show (with their entity), the
 * ones whose entity is gone (to delete), and hidden ones (archived, feature
 * off, or an unsupported type), which are kept so they come back later.
 */
export async function partitionReferenceRows<T extends ReferenceRow>(
  context: EntityResolverContext,
  rows: T[],
) {
  // Trashed entities stay hidden, not missing: a restore brings them back.
  // So do entities of a restricted project: regaining access brings them back.
  const resolved = await resolveWithTrashed(context, rows);
  const visible: Array<T & { entity: EntitySummary }> = [];
  const missing: T[] = [];

  for (const row of rows) {
    const entity = resolved.get(entityRefKey(row.entityType, row.entityId));
    if (!entity) {
      if (resolvers.has(row.entityType)) missing.push(row);
      continue;
    }
    if (entity.available) visible.push({ ...row, entity: entity.summary });
  }

  return { visible, missing };
}

/**
 * Deletes favorites and recent visits of entities that no longer exist.
 * Slices that delete cycles, modules, views or pages call this.
 */
export async function removeEntityReferences(
  entityType: EntityType,
  entityIds: string[],
) {
  if (entityIds.length === 0) return;

  if (isFavoriteEntityType(entityType)) {
    await db
      .delete(favoriteTable)
      .where(
        and(
          eq(favoriteTable.entityType, entityType),
          inArray(favoriteTable.entityId, entityIds),
        ),
      );
  }
  await db
    .delete(recentVisitTable)
    .where(
      and(
        eq(recentVisitTable.entityType, entityType),
        inArray(recentVisitTable.entityId, entityIds),
      ),
    );
}
