import { useQuery } from "@tanstack/react-query";
import countTaskDrafts from "@/fetchers/task-draft/count-task-drafts";
import { taskDraftQueryKeys } from "./task-draft-query-keys";

/** How many drafts the caller has here; feeds the sidebar entry. */
export function useTaskDraftCount(workspaceId: string | undefined) {
  return useQuery({
    queryKey: taskDraftQueryKeys.count(workspaceId ?? ""),
    queryFn: () => countTaskDrafts(workspaceId ?? ""),
    enabled: Boolean(workspaceId),
    staleTime: 60_000,
    select: (data) => data.count,
  });
}

export default useTaskDraftCount;
