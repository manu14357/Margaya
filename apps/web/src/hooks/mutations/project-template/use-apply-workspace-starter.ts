import { useMutation, useQueryClient } from "@tanstack/react-query";
import applyWorkspaceStarter, {
  type ApplyWorkspaceStarterRequest,
} from "@/fetchers/project-template/apply-workspace-starter";
import { invalidateProjectListQueries } from "@/hooks/mutations/project/invalidate-project-list-queries";

export function useApplyWorkspaceStarter() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: ApplyWorkspaceStarterRequest) =>
      applyWorkspaceStarter(request),
    onSuccess: (_data, { workspaceId }) => {
      invalidateProjectListQueries(queryClient, workspaceId);
      void queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
    meta: { refreshTaskQueries: false },
  });
}
