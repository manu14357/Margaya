import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  archiveModule,
  unarchiveModule,
} from "@/fetchers/module/archive-module";
import { invalidateModuleQueries } from "./invalidate-module-queries";

/** Archives a completed or cancelled module, or restores an archived one. */
export function useArchiveModule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      moduleId,
      archive,
    }: {
      moduleId: string;
      projectId: string;
      archive: boolean;
    }) => (archive ? archiveModule(moduleId) : unarchiveModule(moduleId)),
    onSuccess: (_module, { projectId }) => {
      // Archiving also removes the module's favorites and recent visits.
      invalidateModuleQueries(queryClient, projectId, { favorites: true });
      queryClient.invalidateQueries({ queryKey: ["recent-visits"] });
    },
  });
}

export default useArchiveModule;
