import type { QueryClient } from "@tanstack/react-query";
import { estimateQueryKeys } from "@/hooks/queries/estimate/estimate-query-keys";
import { moduleQueryKeys } from "@/hooks/queries/module/module-query-keys";

/**
 * The project's estimate systems, and the cycle and module progress whose
 * estimate totals follow them. Only mounted queries refetch.
 */
export function invalidateEstimateQueries(
  queryClient: QueryClient,
  projectId: string,
) {
  queryClient.invalidateQueries({ queryKey: estimateQueryKeys.all(projectId) });
  queryClient.invalidateQueries({ queryKey: ["cycles", projectId] });
  queryClient.invalidateQueries({
    queryKey: moduleQueryKeys.progresses(projectId),
  });
}

/**
 * After a system change moved tasks to other values (switch, deleted value
 * or system): also the board, every open task and every activity feed. One
 * call per key prefix, however many tasks changed.
 */
export function invalidateEstimateRemap(
  queryClient: QueryClient,
  projectId: string,
) {
  invalidateEstimateQueries(queryClient, projectId);
  queryClient.invalidateQueries({ queryKey: ["tasks", projectId] });
  queryClient.invalidateQueries({ queryKey: ["task"] });
  queryClient.invalidateQueries({ queryKey: ["activities"] });
}

/** After tasks got another estimate: the board, those tasks and progress. */
export function invalidateTaskEstimates(
  queryClient: QueryClient,
  projectId: string,
  taskIds: readonly string[],
) {
  queryClient.invalidateQueries({ queryKey: ["tasks", projectId] });
  for (const taskId of taskIds) {
    queryClient.invalidateQueries({ queryKey: ["task", taskId] });
    queryClient.invalidateQueries({ queryKey: ["activities", taskId] });
  }
  // Per-value task counts (settings) and cycle/module totals move too.
  invalidateEstimateQueries(queryClient, projectId);
}
