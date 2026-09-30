import { useMutation, useQueryClient } from "@tanstack/react-query";
import deleteModule from "@/fetchers/module/delete-module";
import {
  invalidateModuleMembership,
  invalidateModuleQueries,
} from "./invalidate-module-queries";

export function useDeleteModule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ moduleId }: { moduleId: string; projectId: string }) =>
      deleteModule(moduleId),
    onSuccess: (result, { projectId }) => {
      invalidateModuleMembership(queryClient, projectId, result.removedTaskIds);
      // The API removes the module's favorites and recent visits.
      invalidateModuleQueries(queryClient, projectId, { favorites: true });
      queryClient.invalidateQueries({ queryKey: ["recent-visits"] });
    },
  });
}

export default useDeleteModule;
