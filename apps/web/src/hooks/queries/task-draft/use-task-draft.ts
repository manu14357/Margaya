import { useQuery } from "@tanstack/react-query";
import getTaskDraft from "@/fetchers/task-draft/get-task-draft";
import { taskDraftQueryKeys } from "./task-draft-query-keys";

/** One draft with its description, for the draft editor. */
export function useTaskDraft(workspaceId: string, id: string | null) {
  return useQuery({
    queryKey: taskDraftQueryKeys.detail(workspaceId, id ?? ""),
    queryFn: () => getTaskDraft(id ?? ""),
    enabled: Boolean(workspaceId && id),
    // The editor prefills once; a background refetch must not reset it.
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
}

export default useTaskDraft;
