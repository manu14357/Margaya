import type { TaskExportScope } from "@/types/task-export";

// Every history list of a workspace shares the ["task-exports", workspaceId]
// prefix, so one invalidation (a mutation or an EXPORT_UPDATED message)
// refreshes both the "mine" and "all" views.
export const taskExportQueryKeys = {
  all: () => ["task-exports"] as const,
  workspace: (workspaceId: string) => ["task-exports", workspaceId] as const,
  list: (workspaceId: string, scope: TaskExportScope) =>
    ["task-exports", workspaceId, scope] as const,
  detail: (id: string) => ["task-export", id] as const,
  // Under the ["projects", workspaceId] prefix, so project changes refresh it.
  projects: (workspaceId: string) =>
    ["projects", workspaceId, "with-archived"] as const,
};
