import type { QueryClient } from "@tanstack/react-query";
import { RUNNING_TIME_ENTRY_KEY } from "@/hooks/queries/time-entry/use-get-running-time-entry";
import { analyticsKeys } from "@/lib/analytics/scope-key";

/** Everything a time entry change can move: its tasks, the timer, the totals. */
export function invalidateTimeEntries(
  queryClient: QueryClient,
  taskIds: readonly string[],
) {
  for (const taskId of new Set(taskIds)) {
    queryClient.invalidateQueries({ queryKey: ["time-entries", taskId] });
  }
  queryClient.invalidateQueries({ queryKey: [RUNNING_TIME_ENTRY_KEY] });
  queryClient.invalidateQueries({
    queryKey: analyticsKeys.all,
    predicate: (query) => query.queryKey[3] === "time",
  });
}
