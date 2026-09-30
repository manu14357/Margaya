import { useMutation, useQueryClient } from "@tanstack/react-query";
import createModule, {
  type CreateModuleRequest,
} from "@/fetchers/module/create-module";
import { invalidateModuleQueries } from "./invalidate-module-queries";

export function useCreateModule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      projectId,
      ...json
    }: CreateModuleRequest & { projectId: string }) =>
      createModule(projectId, json),
    onSuccess: (_module, { projectId }) => {
      invalidateModuleQueries(queryClient, projectId);
    },
  });
}

export default useCreateModule;
