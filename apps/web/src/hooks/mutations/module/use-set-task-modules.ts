import { useMutation, useQueryClient } from "@tanstack/react-query";
import setTaskModules from "@/fetchers/module/set-task-modules";
import { moduleQueryKeys } from "@/hooks/queries/module/module-query-keys";
import {
  applyTaskMapChange,
  applyTaskModuleChange,
} from "@/lib/module/membership";
import type { Module, ModuleTaskMapEntry, TaskModuleRef } from "@/types/module";
import { invalidateModuleMembership } from "./invalidate-module-queries";

type Variables = {
  taskId: string;
  projectId: string;
  addModuleIds?: string[];
  removeModuleIds?: string[];
};

type Context = {
  previousRefs?: TaskModuleRef[];
  previousMap?: ModuleTaskMapEntry[];
};

/**
 * Puts one task into modules and takes it out of others. The task's module
 * list and the project's task map (card chips, board filter) change at once
 * and roll back on error.
 */
export function useSetTaskModules() {
  const queryClient = useQueryClient();

  return useMutation<TaskModuleRef[], Error, Variables, Context>({
    mutationFn: ({ taskId, addModuleIds, removeModuleIds }) =>
      setTaskModules(taskId, {
        ...(addModuleIds?.length ? { addModuleIds } : {}),
        ...(removeModuleIds?.length ? { removeModuleIds } : {}),
      }),
    onMutate: async ({
      taskId,
      projectId,
      addModuleIds = [],
      removeModuleIds = [],
    }) => {
      const refsKey = moduleQueryKeys.task(projectId, taskId);
      const mapKey = moduleQueryKeys.taskMap(projectId);
      await Promise.all([
        queryClient.cancelQueries({ queryKey: refsKey }),
        queryClient.cancelQueries({ queryKey: mapKey }),
      ]);
      const previousRefs = queryClient.getQueryData<TaskModuleRef[]>(refsKey);
      const previousMap =
        queryClient.getQueryData<ModuleTaskMapEntry[]>(mapKey);
      const modules =
        queryClient.getQueryData<Module[]>(
          moduleQueryKeys.list(projectId, "active"),
        ) ?? [];

      queryClient.setQueryData<TaskModuleRef[]>(refsKey, (refs) =>
        refs
          ? applyTaskModuleChange(refs, modules, addModuleIds, removeModuleIds)
          : refs,
      );
      queryClient.setQueryData<ModuleTaskMapEntry[]>(mapKey, (entries) =>
        entries
          ? applyTaskMapChange(entries, taskId, addModuleIds, removeModuleIds)
          : entries,
      );
      return { previousRefs, previousMap };
    },
    onError: (_error, { taskId, projectId }, context) => {
      queryClient.setQueryData(
        moduleQueryKeys.task(projectId, taskId),
        context?.previousRefs,
      );
      queryClient.setQueryData(
        moduleQueryKeys.taskMap(projectId),
        context?.previousMap,
      );
    },
    onSettled: (_refs, _error, { taskId, projectId }) => {
      invalidateModuleMembership(queryClient, projectId, [taskId]);
    },
  });
}

export default useSetTaskModules;
