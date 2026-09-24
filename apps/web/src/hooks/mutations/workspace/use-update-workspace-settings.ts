import { useMutation, useQueryClient } from "@tanstack/react-query";
import updateWorkspaceSettings from "@/fetchers/workspace/update-workspace-settings";
import { workspaceSettingsQueryKey } from "@/hooks/queries/workspace/use-workspace-settings";

function useUpdateWorkspaceSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateWorkspaceSettings,
    onSuccess: (saved, { workspaceId }) => {
      queryClient.setQueryData(workspaceSettingsQueryKey(workspaceId), saved);
      // "Today" moved: cycle status and progress follow the new zone.
      void queryClient.invalidateQueries({ queryKey: ["cycles"] });
    },
  });
}

export default useUpdateWorkspaceSettings;
