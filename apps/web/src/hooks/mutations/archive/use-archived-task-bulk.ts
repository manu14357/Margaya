import { useMutation, useQueryClient } from "@tanstack/react-query";
import bulkOperation from "@/fetchers/task/bulk-operation";
import { archiveQueryKeys } from "@/hooks/queries/archive/archive-query-keys";
import { ARCHIVE_BULK_CHUNK, chunk } from "@/lib/archives";
import { invalidateTaskQueries } from "@/lib/task-query/cache";

/**
 * Restores or deletes archived tasks in bulk, 200 ids per request. Boards,
 * lists, progress and the archives refresh afterwards, also after a partial
 * failure.
 */
export function useArchivedTaskBulk() {
  const queryClient = useQueryClient();

  const refresh = () => {
    for (const queryKey of [
      ["tasks"],
      ["task"],
      ["projects"],
      ["activities"],
      ["cycles"],
      ["modules"],
      archiveQueryKeys.all(),
    ]) {
      void queryClient.invalidateQueries({ queryKey });
    }
    void invalidateTaskQueries(queryClient);
  };

  const restore = useMutation({
    mutationFn: async (taskIds: string[]) => {
      for (const ids of chunk(taskIds, ARCHIVE_BULK_CHUNK)) {
        await bulkOperation({ taskIds: ids, operation: "unarchive" });
      }
    },
    onSettled: refresh,
  });

  const remove = useMutation({
    mutationFn: async (taskIds: string[]) => {
      for (const ids of chunk(taskIds, ARCHIVE_BULK_CHUNK)) {
        await bulkOperation({ taskIds: ids, operation: "delete" });
      }
    },
    onSettled: refresh,
  });

  return { restore, remove };
}

export default useArchivedTaskBulk;
