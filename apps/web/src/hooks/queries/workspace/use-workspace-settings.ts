import { useQuery } from "@tanstack/react-query";
import getWorkspaceSettings from "@/fetchers/workspace/get-workspace-settings";

export const workspaceSettingsQueryKey = (workspaceId: string) =>
  ["workspace-settings", workspaceId] as const;

/** Workspace settings outside the profile (its time zone). */
function useWorkspaceSettings(workspaceId: string | undefined) {
  return useQuery({
    queryKey: workspaceSettingsQueryKey(workspaceId ?? ""),
    queryFn: () => getWorkspaceSettings(workspaceId ?? ""),
    enabled: !!workspaceId,
  });
}

export default useWorkspaceSettings;
