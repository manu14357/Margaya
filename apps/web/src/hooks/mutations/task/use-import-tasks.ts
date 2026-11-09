import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { TaskToImport } from "@/fetchers/task/import-tasks";
import { invalidateDeliveryQueries } from "@/hooks/mutations/delivery/invalidate-delivery-queries";
import { cycleQueryKeys } from "@/hooks/queries/cycle/cycle-query-keys";
import { moduleQueryKeys } from "@/hooks/queries/module/module-query-keys";
import {
  importTasksInBatches,
  JSON_IMPORT_BATCH_SIZE,
} from "@/lib/task-import/batch";

type ImportTasksVariables = {
  projectId: string;
  tasks: TaskToImport[];
  batchSize?: number;
  onProgress?: (done: number, total: number) => void;
};

/**
 * Imports tasks in sequential batches. The board, labels, cycles, modules and
 * forecasts refresh once at the end, also after a partial import.
 */
const useImportTasks = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      projectId,
      tasks,
      batchSize = JSON_IMPORT_BATCH_SIZE,
      onProgress,
    }: ImportTasksVariables) =>
      importTasksInBatches(projectId, tasks, batchSize, onProgress),
    onSettled: (_data, _error, { projectId }) => {
      void queryClient.invalidateQueries({ queryKey: ["tasks", projectId] });
      void queryClient.invalidateQueries({ queryKey: ["project", projectId] });
      void queryClient.invalidateQueries({ queryKey: ["labels"] });
      void queryClient.invalidateQueries({
        queryKey: cycleQueryKeys.all(projectId),
      });
      void queryClient.invalidateQueries({
        queryKey: moduleQueryKeys.all(projectId),
      });
      invalidateDeliveryQueries(queryClient, projectId);
    },
  });
};

export default useImportTasks;
