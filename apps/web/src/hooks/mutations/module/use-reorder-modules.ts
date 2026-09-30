import { useMutation, useQueryClient } from "@tanstack/react-query";
import reorderModules from "@/fetchers/module/reorder-modules";
import { moduleQueryKeys } from "@/hooks/queries/module/module-query-keys";

/** Saves the manual order of the listed modules (first = top). */
export function useReorderModules() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      projectId,
      moduleIds,
    }: {
      projectId: string;
      moduleIds: string[];
    }) => reorderModules(projectId, moduleIds),
    onSettled: (_modules, _error, { projectId }) => {
      queryClient.invalidateQueries({
        queryKey: moduleQueryKeys.lists(projectId),
      });
    },
  });
}

export default useReorderModules;
