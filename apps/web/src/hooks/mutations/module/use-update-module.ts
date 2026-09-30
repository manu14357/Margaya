import {
  type QueryKey,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import updateModule, {
  type UpdateModuleRequest,
} from "@/fetchers/module/update-module";
import { moduleQueryKeys } from "@/hooks/queries/module/module-query-keys";
import type { Module, ModuleDetail } from "@/types/module";
import { invalidateModuleQueries } from "./invalidate-module-queries";

type Variables = {
  moduleId: string;
  projectId: string;
  json: UpdateModuleRequest;
};

type Context = {
  lists?: Array<[QueryKey, Module[] | undefined]>;
  detail?: ModuleDetail;
};

/**
 * Saves module fields. A lone status change (the inline status chip) shows
 * at once and rolls back on error; other edits wait for the server.
 */
export function useUpdateModule() {
  const queryClient = useQueryClient();

  return useMutation<Module, Error, Variables, Context>({
    mutationFn: ({ moduleId, json }) => updateModule(moduleId, json),
    onMutate: async ({ moduleId, projectId, json }) => {
      const { status } = json;
      if (!status || Object.keys(json).length !== 1) return {};

      const listsKey = moduleQueryKeys.lists(projectId);
      const detailKey = moduleQueryKeys.detail(projectId, moduleId);
      await Promise.all([
        queryClient.cancelQueries({ queryKey: listsKey }),
        queryClient.cancelQueries({ queryKey: detailKey }),
      ]);
      const lists = queryClient.getQueriesData<Module[]>({
        queryKey: listsKey,
      });
      const detail = queryClient.getQueryData<ModuleDetail>(detailKey);

      queryClient.setQueriesData<Module[]>({ queryKey: listsKey }, (modules) =>
        modules?.map((module) =>
          module.id === moduleId ? { ...module, status } : module,
        ),
      );
      queryClient.setQueryData<ModuleDetail>(detailKey, (module) =>
        module ? { ...module, status } : module,
      );
      return { lists, detail };
    },
    onError: (_error, { moduleId, projectId }, context) => {
      for (const [key, data] of context?.lists ?? []) {
        queryClient.setQueryData(key, data);
      }
      if (context?.detail) {
        queryClient.setQueryData(
          moduleQueryKeys.detail(projectId, moduleId),
          context.detail,
        );
      }
    },
    onSettled: (_module, _error, { projectId }) => {
      invalidateModuleQueries(queryClient, projectId, { favorites: true });
    },
  });
}

export default useUpdateModule;
