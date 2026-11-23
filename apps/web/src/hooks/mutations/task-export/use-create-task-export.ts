import { useMutation, useQueryClient } from "@tanstack/react-query";
import createTaskExport from "@/fetchers/task-export/create-task-export";
import { taskExportQueryKeys } from "@/hooks/queries/task-export/task-export-query-keys";
import { rememberStartedExport } from "@/lib/task-export/realtime";

export function useCreateTaskExport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createTaskExport,
    onSuccess: (row) => {
      // The "ready" toast shows in this tab only (lib/task-export/realtime).
      rememberStartedExport(row.id);
      return queryClient.invalidateQueries({
        queryKey: taskExportQueryKeys.workspace(row.workspaceId),
      });
    },
  });
}

export default useCreateTaskExport;
