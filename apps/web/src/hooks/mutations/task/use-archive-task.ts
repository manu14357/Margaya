import {
  type QueryClient,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import archiveTask from "@/fetchers/task/archive-task";
import unarchiveTask from "@/fetchers/task/unarchive-task";
import { invalidateDeliveryQueries } from "@/hooks/mutations/delivery/invalidate-delivery-queries";
import { invalidateTaskQueries } from "@/lib/task-query/cache";

type ArchiveVariables = {
  taskId: string;
  projectId: string;
  /** true archives the task in its column, false restores it. */
  archived: boolean;
};

/** The lists, boards and counts an archive or restore changes. */
export function invalidateAfterArchive(
  queryClient: QueryClient,
  taskId: string,
  projectId: string,
) {
  for (const queryKey of [
    ["tasks", projectId],
    ["task", taskId],
    ["activities", taskId],
    ["projects"],
    ["cycles", projectId],
    ["modules", projectId],
  ]) {
    void queryClient.invalidateQueries({ queryKey });
  }
  // Archived tasks leave forecasts and risks.
  invalidateDeliveryQueries(queryClient, projectId);
  void invalidateTaskQueries(queryClient, projectId);
}

/**
 * Archives or restores one task (D7): archived tasks keep their column and
 * position, and leave the board until restored.
 */
export function useArchiveTask() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ taskId, archived }: ArchiveVariables) =>
      archived ? archiveTask(taskId) : unarchiveTask(taskId),
    onSuccess: (_task, { taskId, projectId }) =>
      invalidateAfterArchive(queryClient, taskId, projectId),
  });
}

export default useArchiveTask;
