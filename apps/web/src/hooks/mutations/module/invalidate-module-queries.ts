import type { QueryClient } from "@tanstack/react-query";
import { moduleQueryKeys } from "@/hooks/queries/module/module-query-keys";

/** Every module query of the project: lists, details, progress, task map. */
export function invalidateModuleQueries(
  queryClient: QueryClient,
  projectId: string,
  { favorites = false }: { favorites?: boolean } = {},
) {
  queryClient.invalidateQueries({ queryKey: moduleQueryKeys.all(projectId) });
  // Favorites show module names and drop archived or deleted modules.
  if (favorites) queryClient.invalidateQueries({ queryKey: ["favorites"] });
}

/**
 * After tasks join or leave modules: the module queries and each changed
 * task's activity. The board payload holds no module data, so the task
 * queries stay as they are.
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
