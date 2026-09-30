import { useMutation, useQueryClient } from "@tanstack/react-query";
import addModuleTasks from "@/fetchers/module/add-module-tasks";
import { chunkIds } from "@/lib/cycle/batch";
import { mergeModuleTaskChanges } from "@/lib/module/membership";
import type { ModuleTaskChange } from "@/types/module";
import { invalidateModuleMembership } from "./invalidate-module-queries";

/** Adds tasks to a module in batches of 200; tasks stay in other modules. */
export function useAddModuleTasks() {
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
        changes.push(await addModuleTasks(moduleId, batch));
      }
      return mergeModuleTaskChanges(moduleId, changes);
    },
    onSettled: (change, _error, { projectId, taskIds }) => {
      invalidateModuleMembership(
        queryClient,
        projectId,
        change ? change.added : taskIds,
      );
    },
  });
}

export default useAddModuleTasks;
