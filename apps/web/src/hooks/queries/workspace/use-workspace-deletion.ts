import { useQuery } from "@tanstack/react-query";
import { getWorkspaceDeletion } from "@/fetchers/workspace/workspace-deletion";

export const workspaceDeletionQueryKey = (workspaceId: string) =>
  ["workspace-deletion", workspaceId] as const;

/** Whether the workspace is scheduled for deletion (and so read-only). */
function useWorkspaceDeletion(workspaceId: string | undefined) {
  return useQuery({
    queryKey: workspaceDeletionQueryKey(workspaceId ?? ""),
    queryFn: () => getWorkspaceDeletion(workspaceId ?? ""),
    enabled: !!workspaceId,
    staleTime: 60_000,
  });
}

export default useWorkspaceDeletion;
