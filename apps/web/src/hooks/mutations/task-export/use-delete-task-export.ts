import { useMutation, useQueryClient } from "@tanstack/react-query";
import deleteTaskExport from "@/fetchers/task-export/delete-task-export";
import { taskExportQueryKeys } from "@/hooks/queries/task-export/task-export-query-keys";

export function useDeleteTaskExport(workspaceId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteTaskExport,
    onSettled: () =>
      queryClient.invalidateQueries({
        queryKey: workspaceId
          ? taskExportQueryKeys.workspace(workspaceId)
          : taskExportQueryKeys.all(),
      }),
  });
}

export default useDeleteTaskExport;
