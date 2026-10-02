import type { IntakeFilters } from "@/types/intake";

// Every list of a project shares the ["intake-items", projectId] prefix, so
// one invalidation refreshes all tabs, filters and sorts together.
export const intakeQueryKeys = {
  lists: (projectId: string) => ["intake-items", projectId] as const,
  list: (projectId: string, filters: IntakeFilters) =>
    ["intake-items", projectId, filters] as const,
  items: () => ["intake-item"] as const,
  item: (id: string) => ["intake-item", id] as const,
  byTask: (taskId: string) => ["intake-item-by-task", taskId] as const,
  summary: (projectId: string) => ["intake-summary", projectId] as const,
};
