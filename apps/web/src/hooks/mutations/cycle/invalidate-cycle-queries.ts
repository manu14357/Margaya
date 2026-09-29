import type { QueryClient } from "@tanstack/react-query";
import { cycleQueryKeys } from "@/hooks/queries/cycle/cycle-query-keys";

/** Lists, details and progress of the project's cycles. */
export function invalidateCycleQueries(
  queryClient: QueryClient,
  projectId: string,
  { favorites = false }: { favorites?: boolean } = {},
) {
  queryClient.invalidateQueries({ queryKey: cycleQueryKeys.all(projectId) });
  // Favorites show cycle names and hide archived cycles.
  if (favorites) queryClient.invalidateQueries({ queryKey: ["favorites"] });
}

/** After tasks change cycle: the board, each task and its activity. */
export function invalidateCycleMembership(
  queryClient: QueryClient,
  projectId: string,
  taskIds: readonly string[],
) {
  invalidateCycleQueries(queryClient, projectId);
  queryClient.invalidateQueries({ queryKey: ["tasks", projectId] });
  for (const taskId of taskIds) {
    queryClient.invalidateQueries({ queryKey: ["task", taskId] });
    queryClient.invalidateQueries({ queryKey: ["activities", taskId] });
  }
}
