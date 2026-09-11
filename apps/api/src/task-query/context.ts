import { and, asc, eq, inArray, isNull, type SQL, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { HTTPException } from "hono/http-exception";
import type { ColumnGroup } from "../column/groups";
import {
  columnTable,
  customFieldDefinitionTable,
  projectTable,
  taskTable,
} from "../database/schema";
import type { TaskReadDatabase } from "../task/bounded-read";
import { getWorkspaceTimezone, todayInTimezone } from "../utils/timezone";
import { isValidTimeZone, type WeekStart, zonedDay } from "./dates";

// Everything a query needs to know before it compiles: the caller, "today"
// in the requester's zone, and the scope projects with their feature flags
// and columns (one statement).

export type ScopeColumn = {
  id: string;
  projectId: string;
  slug: string;
  name: string;
  icon: string | null;
  group: ColumnGroup;
  position: number;
  isFinal: boolean;
};

export type ScopeProject = {
  id: string;
  name: string;
  slug: string;
  icon: string | null;
  position: number;
  createdAt: Date;
  archivedAt: Date | null;
  cyclesEnabled: boolean;
  modulesEnabled: boolean;
  estimatesEnabled: boolean;
  /** Read by analytics only; intake is never a query key. */
  intakeEnabled: boolean;
  /** Every column, triage included, by position. */
  columns: ScopeColumn[];
};

export type PlanningFeature = "cycles" | "modules" | "estimates";

export type QueryContext = {
  workspaceId: string;
  /** The caller; `me` resolves to it. API keys act as their user. */
  userId: string;
  /** A public board: no caller, no personal keys, no user meta. */
  publicContext: boolean;
  timeZone: string;
  weekStartsOn: WeekStart;
  /** The requester's calendar day in `timeZone`. */
  today: string;
  /**
   * The workspace's calendar day in its own time zone (UTC by default),
   * which cycle status uses (D2). The name predates workspace time zones.
   */
  utcToday: string;
  /** Scope projects in sidebar order. */
  projects: ScopeProject[];
  projectIds: string[];
  projectById: Map<string, ScopeProject>;
  /** Scope projects with each planning feature on. */
  featureProjectIds: Record<PlanningFeature, string[]>;
  /** Custom fields named by conditions: field id to its project id. */
  customFields: Map<string, string>;
};

export const PROJECT_NOT_FOUND = "Project not found";
export const UNKNOWN_TIME_ZONE = "Unknown time zone";
export const UNKNOWN_CUSTOM_FIELD = "Unknown custom field";

type RawColumn = Omit<ScopeColumn, "projectId">;

/**
 * In a single-table select drizzle drops the table prefix of top-level
 * column chunks, which would break a correlated subquery; nesting the
 * fragment keeps every column qualified.
 */
export function nested<T>(fragment: SQL<T>): SQL<T> {
  return sql<T>`${fragment}`;
}

const scopeColumn = alias(columnTable, "scope_column");

const columnsJson = nested(sql<RawColumn[] | null>`(
  select json_agg(json_build_object(
    'id', ${scopeColumn.id},
    'slug', ${scopeColumn.slug},
    'name', ${scopeColumn.name},
    'icon', ${scopeColumn.icon},
    'group', ${scopeColumn.group},
    'position', ${scopeColumn.position},
    'isFinal', ${scopeColumn.isFinal}
  ) order by ${scopeColumn.position}, ${scopeColumn.id})
  from ${columnTable} as ${sql.identifier("scope_column")}
  where ${scopeColumn.projectId} = ${projectTable.id}
)`);

async function loadScopeProjects(
  tx: TaskReadDatabase,
  workspaceId: string,
  projectIds: readonly string[] | undefined,
): Promise<ScopeProject[]> {
  const requested = projectIds ? [...new Set(projectIds)] : undefined;
  const rows = await tx
    .select({
      id: projectTable.id,
      name: projectTable.name,
      slug: projectTable.slug,
      icon: projectTable.icon,
      position: projectTable.position,
      createdAt: projectTable.createdAt,
      archivedAt: projectTable.archivedAt,
      cyclesEnabled: projectTable.cyclesEnabled,
      modulesEnabled: projectTable.modulesEnabled,
      estimatesEnabled: projectTable.estimatesEnabled,
      intakeEnabled: projectTable.intakeEnabled,
      columns: columnsJson,
    })
    .from(projectTable)
    .where(
      and(
        eq(projectTable.workspaceId, workspaceId),
        // Trashed projects read as gone (C7).
        isNull(projectTable.deletedAt),
        // Archived projects only when named.
        requested
          ? inArray(projectTable.id, requested)
          : isNull(projectTable.archivedAt),
      ),
    )
    .orderBy(
      asc(projectTable.position),
      asc(projectTable.createdAt),
      asc(projectTable.id),
    );

  if (requested && rows.length !== requested.length) {
    throw new HTTPException(404, { message: PROJECT_NOT_FOUND });
  }

  return rows.map(({ columns, ...project }) => ({
    ...project,
    columns: (columns ?? []).map((column) => ({
      ...column,
      projectId: project.id,
    })),
  }));
}

async function loadCustomFields(
  tx: TaskReadDatabase,
  fieldIds: readonly string[],
  projectIds: readonly string[],
): Promise<Map<string, string>> {
  const fields = new Map<string, string>();
  if (fieldIds.length === 0) return fields;
  const rows =
    projectIds.length === 0
      ? []
      : await tx
          .select({
            id: customFieldDefinitionTable.id,
            projectId: customFieldDefinitionTable.projectId,
          })
          .from(customFieldDefinitionTable)
          .where(
            and(
              inArray(customFieldDefinitionTable.id, [...new Set(fieldIds)]),
              inArray(customFieldDefinitionTable.projectId, [...projectIds]),
            ),
          );
  for (const row of rows) fields.set(row.id, row.projectId);
  if (fieldIds.some((id) => !fields.has(id))) {
    throw new HTTPException(400, { message: UNKNOWN_CUSTOM_FIELD });
  }
  return fields;
}

export function resolveTimeZone(timeZone: string | undefined): string {
  const zone = timeZone ?? "UTC";
  if (!isValidTimeZone(zone)) {
    throw new HTTPException(400, { message: UNKNOWN_TIME_ZONE });
  }
  return zone;
}

export async function buildQueryContext(
  tx: TaskReadDatabase,
  {
    workspaceId,
    userId,
    projectIds,
    timeZone,
    weekStartsOn,
    customFieldIds = [],
    publicContext = false,
    now = new Date(),
  }: {
    workspaceId: string;
    userId: string;
    projectIds?: readonly string[];
    timeZone?: string;
    weekStartsOn?: WeekStart;
    customFieldIds?: readonly string[];
    publicContext?: boolean;
    now?: Date;
  },
): Promise<QueryContext> {
  const workspaceZone = await getWorkspaceTimezone(workspaceId, tx);
  // Analytics may omit the zone: it then means the workspace's own (UTC
  // unless an admin set one). The task query engine always passes one.
  const zone = resolveTimeZone(timeZone ?? workspaceZone);
  const projects = await loadScopeProjects(tx, workspaceId, projectIds);
  const ids = projects.map((project) => project.id);
  const customFields = await loadCustomFields(tx, customFieldIds, ids);
  return {
    workspaceId,
    userId,
    publicContext,
    timeZone: zone,
    weekStartsOn: weekStartsOn ?? 0,
    today: zonedDay(now, zone),
    utcToday: todayInTimezone(workspaceZone, now),
    projects,
    projectIds: ids,
    projectById: new Map(projects.map((project) => [project.id, project])),
    featureProjectIds: {
      cycles: projects.filter((p) => p.cyclesEnabled).map((p) => p.id),
      modules: projects.filter((p) => p.modulesEnabled).map((p) => p.id),
      estimates: projects.filter((p) => p.estimatesEnabled).map((p) => p.id),
    },
    customFields,
  };
}

/** `task.project_id` is one of `ids` (scope-aware shortcuts for all or none). */
export function taskProjectIn(
  ids: readonly string[],
  context: QueryContext,
): SQL {
  if (ids.length === 0) return sql`false`;
  if (ids.length === context.projectIds.length) return sql`true`;
  return sql`${taskTable.projectId} = any(${sql.param([...ids])})`;
}

/** The task's project has the feature on (K6: off reads as "no value"). */
export function featureOn(feature: PlanningFeature, context: QueryContext) {
  return taskProjectIn(context.featureProjectIds[feature], context);
}

/** A text array parameter for `= any(...)`, whatever its length. */
export function textArray(values: readonly string[]): SQL {
  return sql`${sql.param([...values])}::text[]`;
}
