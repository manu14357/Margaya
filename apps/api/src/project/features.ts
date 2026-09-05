import { and, eq, isNull, type SQL } from "drizzle-orm";
import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import db from "../database";
import { projectTable, taskTable, timeEntryTable } from "../database/schema";

// Per-project feature toggles. Every route of a feature (reads included)
// answers 403 while it is off, so "off" means off for the web, MCP and API
// keys alike. Stored data is never touched.
export const PROJECT_FEATURE_KEYS = [
  "cycles",
  "modules",
  "views",
  "pages",
  "intake",
  "estimates",
  "timeTracking",
] as const;

export type ProjectFeature = (typeof PROJECT_FEATURE_KEYS)[number];

export const PROJECT_FEATURES = {
  cycles: { field: "cyclesEnabled", label: "Cycles" },
  modules: { field: "modulesEnabled", label: "Modules" },
  views: { field: "viewsEnabled", label: "Views" },
  pages: { field: "pagesEnabled", label: "Pages" },
  intake: { field: "intakeEnabled", label: "Intake" },
  estimates: { field: "estimatesEnabled", label: "Estimates" },
  timeTracking: { field: "timeTrackingEnabled", label: "Time tracking" },
} as const satisfies Record<
  ProjectFeature,
  { field: keyof typeof projectTable.$inferSelect; label: string }
>;

export type ProjectFeatureField =
  (typeof PROJECT_FEATURES)[ProjectFeature]["field"];

export function projectFeatureField(
  feature: ProjectFeature,
): ProjectFeatureField {
  return PROJECT_FEATURES[feature].field;
}

export function featureDisabledMessage(feature: ProjectFeature): string {
  return `The ${PROJECT_FEATURES[feature].label} feature is turned off for this project.`;
}

/**
 * SQL condition that keeps rows of projects where the feature is on and
 * that are not in the trash (C7).
 */
export function projectFeatureEnabledCondition(feature: ProjectFeature): SQL {
  return and(
    eq(projectTable[projectFeatureField(feature)], true),
    isNull(projectTable.deletedAt),
  ) as SQL;
}

async function readProjectFeature(projectId: string, feature: ProjectFeature) {
  const [project] = await db
    .select({
      enabled: projectTable[projectFeatureField(feature)],
      deletedAt: projectTable.deletedAt,
    })
    .from(projectTable)
    .where(eq(projectTable.id, projectId))
    .limit(1);
  return project;
}

/**
 * Whether the feature is on; null when the project does not exist or is in
 * the trash (C7).
 */
export async function isProjectFeatureEnabled(
  projectId: string,
  feature: ProjectFeature,
): Promise<boolean | null> {
  const project = await readProjectFeature(projectId, feature);
  return project && !project.deletedAt ? project.enabled : null;
}

/**
 * Controller-side gate for routes that reach the project through an entity
 * (a task, a time entry, a cycle, ...). Call it after loading the entity.
 * A trashed project answers 404: its cycles, modules, views, pages and
 * intake read as gone with it.
 */
export async function assertProjectFeatureEnabled(
  projectId: string,
  feature: ProjectFeature,
): Promise<void> {
  const project = await readProjectFeature(projectId, feature);
  if (project?.deletedAt) {
    throw new HTTPException(404, { message: "Project not found" });
  }
  if (project && project.enabled === false) {
    throw new HTTPException(403, { message: featureDisabledMessage(feature) });
  }
}

type RequestLocation = "param" | "query" | "body";

/**
 * Where the middleware finds the project. Built-in lookups cover a project,
 * task or time-entry id; later slices pass `resolveProjectId` for their own
 * entities (a cycle id, a module id, ...).
 */
export type ProjectFeatureSource =
  | {
      resource: "project" | "task" | "timeEntry";
      key: string;
      in?: RequestLocation;
    }
  | { resolveProjectId: (c: Context) => Promise<string | null> };

async function readRequestValue(
  c: Context,
  key: string,
  location: RequestLocation,
): Promise<string | null> {
  if (location === "param") return c.req.param(key) || null;
  if (location === "query") return c.req.query(key) || null;
  const body: unknown = await c.req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const value = (body as Record<string, unknown>)[key];
  return typeof value === "string" && value ? value : null;
}

async function projectIdForResource(
  resource: "project" | "task" | "timeEntry",
  id: string,
): Promise<string | null> {
  if (resource === "project") return id;

  if (resource === "task") {
    const [task] = await db
      .select({ projectId: taskTable.projectId })
      .from(taskTable)
      .where(eq(taskTable.id, id))
      .limit(1);
    return task?.projectId ?? null;
  }

  const [entry] = await db
    .select({ projectId: taskTable.projectId })
    .from(timeEntryTable)
    .innerJoin(taskTable, eq(timeEntryTable.taskId, taskTable.id))
    .where(eq(timeEntryTable.id, id))
    .limit(1);
  return entry?.projectId ?? null;
}

/**
 * Route middleware answering 403 while the feature is off for the request's
 * project. Place it after `workspaceAccess` and permission middleware so
 * non-members keep getting their usual errors first. It reads the raw
 * request, because route middleware runs before the validators. An unknown
 * entity passes through so the handler answers with its own 404.
 */
export function requireProjectFeature(
  feature: ProjectFeature,
  source: ProjectFeatureSource = { resource: "project", key: "projectId" },
) {
  return async (c: Context, next: Next) => {
    let projectId: string | null;

    if ("resolveProjectId" in source) {
      projectId = await source.resolveProjectId(c);
    } else {
      const id = await readRequestValue(c, source.key, source.in ?? "param");
      projectId = id ? await projectIdForResource(source.resource, id) : null;
    }

    if (projectId) {
      await assertProjectFeatureEnabled(projectId, feature);
    }

    return next();
  };
}
