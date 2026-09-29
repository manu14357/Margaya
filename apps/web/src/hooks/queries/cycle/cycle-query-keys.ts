import type { CycleListView } from "@/types/cycle";

// Every cycle query of a project shares the ["cycles", projectId] prefix, so
// one invalidation refreshes lists, details and progress together.
export const cycleQueryKeys = {
  all: (projectId: string) => ["cycles", projectId] as const,
  list: (projectId: string, view: CycleListView) =>
    ["cycles", projectId, "list", view] as const,
  detail: (projectId: string, cycleId: string) =>
    ["cycles", projectId, "detail", cycleId] as const,
  progress: (projectId: string, cycleId: string) =>
    ["cycles", projectId, "progress", cycleId] as const,
};
