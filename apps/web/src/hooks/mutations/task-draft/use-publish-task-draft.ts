import { useMutation, useQueryClient } from "@tanstack/react-query";
import publishTaskDraft from "@/fetchers/task-draft/publish-task-draft";
import { taskDraftQueryKeys } from "@/hooks/queries/task-draft/task-draft-query-keys";
import { invalidateTaskQueries } from "@/lib/task-query/cache";
import type { TaskDraftPatch } from "@/types/task-draft";
import { removeDraftFromCache } from "./remove-draft-from-cache";

/** Publishes a draft as a task; the draft leaves every list. */
export function usePublishTaskDraft() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: string;
      workspaceId: string;
      patch?: TaskDraftPatch;
    }) => publishTaskDraft(id, patch),
    onSuccess: ({ task }, { id, workspaceId }) => {
      removeDraftFromCache(queryClient, workspaceId, id);
      // Lists and the count only: the editor that published may still be
      // mounted, and refetching the gone draft would answer 404.
      void queryClient.invalidateQueries({
        queryKey: taskDraftQueryKeys.lists(workspaceId),
      });
      void queryClient.invalidateQueries({
        queryKey: taskDraftQueryKeys.count(workspaceId),
      });
      void queryClient.invalidateQueries({
        queryKey: ["tasks", task.projectId],
      });
      void queryClient.invalidateQueries({
        queryKey: ["projects", workspaceId],
      });
      void invalidateTaskQueries(queryClient, task.projectId);
    },
    onError: (_error, { workspaceId }) => {
      // A refused publish may still have saved the patch (phase 1); the
      // open editor keeps its own values.
      void queryClient.invalidateQueries({
        queryKey: taskDraftQueryKeys.lists(workspaceId),
      });
    },
  });
}

export default usePublishTaskDraft;
