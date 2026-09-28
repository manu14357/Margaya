import type { TaskDraftFilters } from "@/types/task-draft";

// Every draft query of a workspace shares the ["task-drafts", workspaceId]
// prefix, so one invalidation refreshes the lists, the count and the open
// draft together (the DRAFTS_UPDATED hint does exactly that).
export const taskDraftQueryKeys = {
  all: () => ["task-drafts"] as const,
  workspace: (workspaceId: string) => ["task-drafts", workspaceId] as const,
  lists: (workspaceId: string) => ["task-drafts", workspaceId, "list"] as const,
  list: (workspaceId: string, filters: TaskDraftFilters) =>
    [
      "task-drafts",
      workspaceId,
      "list",
      { projectId: filters.projectId ?? null, q: filters.q?.trim() ?? "" },
    ] as const,
  count: (workspaceId: string) =>
    ["task-drafts", workspaceId, "count"] as const,
  detail: (workspaceId: string, id: string) =>
    ["task-drafts", workspaceId, "detail", id] as const,
};
