import type { ModuleListView } from "@/types/module";

// Every module query of a project shares the ["modules", projectId] prefix, so
// one invalidation refreshes lists, details, progress, the task map and the
// per-task lists together.
export const moduleQueryKeys = {
  all: (projectId: string) => ["modules", projectId] as const,
  lists: (projectId: string) => ["modules", projectId, "list"] as const,
  list: (projectId: string, view: ModuleListView) =>
    ["modules", projectId, "list", view] as const,
  details: (projectId: string) => ["modules", projectId, "detail"] as const,
  detail: (projectId: string, moduleId: string) =>
    ["modules", projectId, "detail", moduleId] as const,
  progresses: (projectId: string) =>
    ["modules", projectId, "progress"] as const,
  progress: (projectId: string, moduleId: string) =>
    ["modules", projectId, "progress", moduleId] as const,
  taskMap: (projectId: string) => ["modules", projectId, "task-map"] as const,
  taskIds: (projectId: string, moduleId: string) =>
    ["modules", projectId, "task-ids", moduleId] as const,
  task: (projectId: string, taskId: string) =>
    ["modules", projectId, "task", taskId] as const,
};
