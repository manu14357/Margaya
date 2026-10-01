import type { AnalyticsScopeParams } from "@/types/analytics";

/** The GET routes' query: `projectIds` travels comma-separated. */
export function scopeQuery({
  workspaceId,
  projectIds,
  timeZone,
}: AnalyticsScopeParams) {
  return {
    workspaceId,
    ...(projectIds?.length ? { projectIds: projectIds.join(",") } : {}),
    ...(timeZone ? { timeZone } : {}),
  };
}
