// Every view query of a workspace shares the ["views", workspaceId] prefix,
// so one invalidation refreshes its lists and open views together.
export const viewQueryKeys = {
  all: () => ["views"] as const,
  workspace: (workspaceId: string) => ["views", workspaceId] as const,
  list: (workspaceId: string, projectId: string | null, mine = false) =>
    [
      "views",
      workspaceId,
      projectId ?? "workspace",
      mine ? "mine" : "all",
    ] as const,
  detail: (workspaceId: string, viewId: string) =>
    ["views", workspaceId, "detail", viewId] as const,
};
