// One key per analytics scope, shared by query keys and storage keys:
// "all" for every project of the workspace, otherwise the sorted ids.

export const ALL_PROJECTS_SCOPE_KEY = "all";

export function analyticsScopeKey(
  projectIds?: readonly string[] | null,
): string {
  if (!projectIds?.length) return ALL_PROJECTS_SCOPE_KEY;
  return [...new Set(projectIds)].sort().join(",");
}

/** The URL's comma-separated `projects` value as ids (trimmed, unique). */
export function parseProjectIdsParam(value: unknown): string[] {
  if (typeof value !== "string") return [];
  const ids = value
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  return [...new Set(ids)];
}

/** Query keys: everything under ["analytics", workspaceId, scopeKey]. */
export const analyticsKeys = {
  all: ["analytics"] as const,
  scope: (workspaceId: string, scopeKey: string) =>
    ["analytics", workspaceId, scopeKey] as const,
  overview: (workspaceId: string, scopeKey: string, timeZone: string) =>
    ["analytics", workspaceId, scopeKey, "overview", timeZone] as const,
  chart: (workspaceId: string, scopeKey: string, requestHash: string) =>
    ["analytics", workspaceId, scopeKey, "chart", requestHash] as const,
  trend: (workspaceId: string, scopeKey: string, requestHash: string) =>
    ["analytics", workspaceId, scopeKey, "trend", requestHash] as const,
  cycles: (workspaceId: string, scopeKey: string) =>
    ["analytics", workspaceId, scopeKey, "cycles"] as const,
  modules: (workspaceId: string, scopeKey: string) =>
    ["analytics", workspaceId, scopeKey, "modules"] as const,
  intake: (workspaceId: string, scopeKey: string, requestHash: string) =>
    ["analytics", workspaceId, scopeKey, "intake", requestHash] as const,
};
