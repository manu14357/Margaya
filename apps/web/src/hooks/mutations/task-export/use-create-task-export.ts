import { useMutation, useQueryClient } from "@tanstack/react-query";
import createTaskExport from "@/fetchers/task-export/create-task-export";
import { taskExportQueryKeys } from "@/hooks/queries/task-export/task-export-query-keys";

export function useCreateTaskExport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createTaskExport,
    onSuccess: (row) =>
      queryClient.invalidateQueries({
        queryKey: taskExportQueryKeys.workspace(row.workspaceId),
      }),
  });
}

export default useCreateTaskExport;
