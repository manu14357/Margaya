import { useMutation, useQueryClient } from "@tanstack/react-query";
import removeModuleTasks from "@/fetchers/module/remove-module-tasks";
import { chunkIds } from "@/lib/cycle/batch";
import { mergeModuleTaskChanges } from "@/lib/module/membership";
import type { ModuleTaskChange } from "@/types/module";
import { invalidateModuleMembership } from "./invalidate-module-queries";

/** Takes tasks out of one module, in batches of 200. */
export function useRemoveModuleTasks() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      moduleId,
      taskIds,
    }: {
      moduleId: string;
      projectId: string;
      taskIds: string[];
    }) => {
      const changes: ModuleTaskChange[] = [];
      for (const batch of chunkIds(taskIds)) {
        changes.push(await removeModuleTasks(moduleId, batch));
      }
      return mergeModuleTaskChanges(moduleId, changes);
    },
    onSettled: (change, _error, { projectId, taskIds }) => {
      invalidateModuleMembership(
        queryClient,
        projectId,
        change ? change.removed : taskIds,
      );
    },
  });
}

export default useRemoveModuleTasks;
