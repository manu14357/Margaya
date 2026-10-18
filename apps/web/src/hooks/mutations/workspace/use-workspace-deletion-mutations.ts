import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  cancelWorkspaceDeletion,
  scheduleWorkspaceDeletion,
} from "@/fetchers/workspace/workspace-deletion";
import { workspaceDeletionQueryKey } from "@/hooks/queries/workspace/use-workspace-deletion";

/** Schedules the workspace for deletion after the grace period. */
export function useScheduleWorkspaceDeletion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (workspaceId: string) => scheduleWorkspaceDeletion(workspaceId),
    onSuccess: (state, workspaceId) => {
      queryClient.setQueryData(workspaceDeletionQueryKey(workspaceId), state);
      // Capabilities in page and project responses turn read-only.
      void queryClient.invalidateQueries();
    },
  });
}

/** Cancels a pending deletion: the workspace is writable again. */
export function useCancelWorkspaceDeletion() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (workspaceId: string) => cancelWorkspaceDeletion(workspaceId),
    onSuccess: (state, workspaceId) => {
      queryClient.setQueryData(workspaceDeletionQueryKey(workspaceId), state);
      void queryClient.invalidateQueries();
    },
  });
}
