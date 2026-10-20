import type { QueryClient } from "@tanstack/react-query";
import { cycleQueryKeys } from "@/hooks/queries/cycle/cycle-query-keys";
import { deliveryQueryKeys } from "@/hooks/queries/delivery/delivery-query-keys";
import { moduleQueryKeys } from "@/hooks/queries/module/module-query-keys";

/**
 * Cycle and module counts, progress, charts, forecasts and risks follow task
 * status. The realtime echo skips the tab that made a change, so that tab's
 * own task mutations refresh these too. Only mounted queries refetch.
 */
export function invalidatePlanningProgress(
  queryClient: QueryClient,
  projectId: string,
) {
  queryClient.invalidateQueries({ queryKey: cycleQueryKeys.all(projectId) });
  queryClient.invalidateQueries({ queryKey: moduleQueryKeys.lists(projectId) });
  queryClient.invalidateQueries({
    queryKey: moduleQueryKeys.details(projectId),
  });
  queryClient.invalidateQueries({
    queryKey: moduleQueryKeys.progresses(projectId),
  });
  // Forecasts and risk radars read the same tasks.
  queryClient.invalidateQueries({ queryKey: deliveryQueryKeys.all(projectId) });
}
