import type { QueryClient } from "@tanstack/react-query";
import { invalidateDeliveryQueries } from "@/hooks/mutations/delivery/invalidate-delivery-queries";
import { archiveQueryKeys } from "@/hooks/queries/archive/archive-query-keys";
import { moduleQueryKeys } from "@/hooks/queries/module/module-query-keys";

/**
 * Every module query of the project (lists, details, progress, task map),
 * and the forecasts.
 */
export function invalidateModuleQueries(
  queryClient: QueryClient,
  projectId: string,
  { favorites = false }: { favorites?: boolean } = {},
) {
  queryClient.invalidateQueries({ queryKey: moduleQueryKeys.all(projectId) });
  // The realtime echo skips the tab that made the change, and a module's
  // forecast and risks read its target date and its tasks.
  invalidateDeliveryQueries(queryClient, projectId);
  // Favorites show module names and drop archived or deleted modules.
  // Recents too, and the Archives page lists archived ones.
  if (favorites) {
    queryClient.invalidateQueries({ queryKey: ["favorites"] });
    queryClient.invalidateQueries({ queryKey: ["recent-visits"] });
    queryClient.invalidateQueries({ queryKey: archiveQueryKeys.all() });
  }
}

/**
 * After tasks join or leave modules: the module queries, forecasts and each
 * changed task's activity. The board payload holds no module data, so the
 * task queries stay as they are.
 */
export function invalidateModuleMembership(
  queryClient: QueryClient,
  projectId: string,
  taskIds: readonly string[],
) {
  invalidateModuleQueries(queryClient, projectId);
  for (const taskId of new Set(taskIds)) {
    queryClient.invalidateQueries({ queryKey: ["activities", taskId] });
  }
}
