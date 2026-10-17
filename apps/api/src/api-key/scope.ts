import { statement } from "@margaya/permissions";
import { auditContext } from "../audit-log/context";

// Scoped API keys (4.10). A key may be limited to reading, to chosen
// permission areas, and to chosen projects. The scope lives in the key's
// `permissions` column, which only the server can write (Better Auth refuses
// it from clients), so neither the key nor its owner's browser can widen it
// afterwards. Two marker entries sit beside the permission statements and
// are removed before any permission check:
//   "margaya:access":   ["full" | "read" | "custom"]
//   "margaya:projects": [projectId, ...]
// Keys created before scoping have no permissions and keep full access.

export const ACCESS_MARKER = "margaya:access";
export const PROJECTS_MARKER = "margaya:projects";

export const API_KEY_AREAS = [
  "project",
  "task",
  "label",
  "cycle",
  "module",
  "view",
  "intake",
  "page",
  "analytics",
  "workspace",
  "audit_log",
  // AI features (use) and AI settings (manage); write-only: AI calls are
  // POSTs, so a read-only key never reaches them.
  "ai",
] as const;
export type ApiKeyArea = (typeof API_KEY_AREAS)[number];

export const API_KEY_ACCESS = ["full", "read", "custom"] as const;
export type ApiKeyAccess = (typeof API_KEY_ACCESS)[number];

export type AreaLevel = "read" | "write";

export const MAX_SCOPED_PROJECTS = 50;

const areaActions = statement as unknown as Record<
  ApiKeyArea,
  readonly string[]
>;

/** Every action of an area at a level ("write" is all of them). */
export function actionsFor(area: ApiKeyArea, level: AreaLevel): string[] {
  const all = [...(areaActions[area] ?? [])];
  return level === "write" ? all : all.filter((action) => action === "read");
}

/** The stored permissions of a scope, or null for full, unlimited access. */
export function encodeScope(input: {
  access: ApiKeyAccess;
  areas?: Partial<Record<ApiKeyArea, AreaLevel>>;
  projectIds?: string[];
}): Record<string, string[]> | null {
  const projectIds = [...new Set(input.projectIds ?? [])];
  if (input.access === "full" && projectIds.length === 0) return null;

  const stored: Record<string, string[]> = {
    [ACCESS_MARKER]: [input.access],
  };
  if (input.access !== "full") {
    for (const area of API_KEY_AREAS) {
      const level = input.access === "read" ? "read" : input.areas?.[area];
      if (!level) continue;
      const actions = actionsFor(area, level);
      if (actions.length > 0) stored[area] = actions;
    }
  }
  if (projectIds.length > 0) stored[PROJECTS_MARKER] = projectIds;
  return stored;
}

export type DecodedScope = {
  access: ApiKeyAccess;
  /** Statements every request must satisfy, or null for none. */
  permissions: Record<string, string[]> | null;
  projectIds: string[] | null;
  readOnly: boolean;
};

/**
 * Splits stored permissions into statements and scope. A key whose
 * permissions predate scoping (no marker) is "custom" with those statements.
 */
export function decodeScope(
  stored: Record<string, string[]> | null,
): DecodedScope {
  if (!stored) {
    return {
      access: "full",
      permissions: null,
      projectIds: null,
      readOnly: false,
    };
  }
  const {
    [ACCESS_MARKER]: accessMarker,
    [PROJECTS_MARKER]: projects,
    ...rest
  } = stored;
  const marked = accessMarker?.[0];
  const access: ApiKeyAccess = (API_KEY_ACCESS as readonly string[]).includes(
    marked ?? "",
  )
    ? (marked as ApiKeyAccess)
    : "custom";
  const projectIds = projects && projects.length > 0 ? projects : null;
  return {
    access,
    permissions: access === "full" ? null : rest,
    projectIds,
    readOnly: access === "read",
  };
}

/** The areas and levels of decoded statements, for display. */
export function areasOf(
  permissions: Record<string, string[]> | null,
): Partial<Record<ApiKeyArea, AreaLevel>> {
  const areas: Partial<Record<ApiKeyArea, AreaLevel>> = {};
  if (!permissions) return areas;
  for (const area of API_KEY_AREAS) {
    const granted = permissions[area];
    if (!granted || granted.length === 0) continue;
    areas[area] = granted.some((action) => action !== "read")
      ? "write"
      : "read";
  }
  return areas;
}

export type RequestApiKey = {
  id: string;
  userId: string;
  enabled: boolean;
  permissions: Record<string, string[]> | null;
  projectIds?: string[] | null;
  readOnly?: boolean;
};

/** The API key of the request in flight, read from the request store. */
export function currentRequestApiKey(): RequestApiKey | undefined {
  const c = auditContext.getStore()?.c;
  return c?.get("apiKey") as RequestApiKey | undefined;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// POST routes that only read, which read-only keys may call.
const READ_ONLY_POSTS = new Set(["/api/task-query", "/api/task-query/"]);

/** Whether a read-only key may make this request. */
export function readOnlyKeyAllows(method: string, path: string): boolean {
  const upper = method.toUpperCase();
  return (
    SAFE_METHODS.has(upper) || (upper === "POST" && READ_ONLY_POSTS.has(path))
  );
}

// Workspace-wide routes that a project-limited key may still call; their
// handlers narrow the answer to the key's projects.
const PROJECT_SCOPED_WORKSPACE_ROUTES = new Set([
  "GET /api/project",
  "GET /api/project/",
]);

export function projectScopedWorkspaceRouteAllowed(
  method: string,
  path: string,
): boolean {
  return PROJECT_SCOPED_WORKSPACE_ROUTES.has(`${method.toUpperCase()} ${path}`);
}
