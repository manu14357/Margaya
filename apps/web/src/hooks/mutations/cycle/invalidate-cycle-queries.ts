import type { QueryClient } from "@tanstack/react-query";
import { invalidateDeliveryQueries } from "@/hooks/mutations/delivery/invalidate-delivery-queries";
import { cycleQueryKeys } from "@/hooks/queries/cycle/cycle-query-keys";

/** Lists, details and progress of the project's cycles, and the forecasts. */
export function invalidateCycleQueries(
  queryClient: QueryClient,
  projectId: string,
  { favorites = false }: { favorites?: boolean } = {},
) {
  queryClient.invalidateQueries({ queryKey: cycleQueryKeys.all(projectId) });
  // The realtime echo skips the tab that made the change, and a cycle's
  // forecast and risks read its end date and its tasks.
  invalidateDeliveryQueries(queryClient, projectId);
  // Favorites show cycle names and hide archived cycles.
  if (favorites) queryClient.invalidateQueries({ queryKey: ["favorites"] });
}

/** After tasks change cycle: the board, forecasts, each task and its activity. */
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
