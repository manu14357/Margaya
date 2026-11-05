import { useMutation, useQueryClient } from "@tanstack/react-query";
import createWorkspaceExport from "@/fetchers/task-export/create-workspace-export";
import { taskExportQueryKeys } from "@/hooks/queries/task-export/task-export-query-keys";

export function useCreateWorkspaceExport() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createWorkspaceExport,
    onSuccess: (row) =>
      queryClient.invalidateQueries({
        queryKey: taskExportQueryKeys.workspace(row.workspaceId),
      }),
  });
}

export default useCreateWorkspaceExport;
