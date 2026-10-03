import { useQuery } from "@tanstack/react-query";
import listTaskPageReferences from "@/fetchers/page/list-task-page-references";
import { pageQueryKeys } from "./page-query-keys";

/** Visible pages that mention or link a task. */
export function useGetTaskPageReferences(taskId: string, enabled: boolean) {
  return useQuery({
    queryKey: pageQueryKeys.taskReference(taskId),
    queryFn: () => listTaskPageReferences(taskId),
    enabled: Boolean(taskId) && enabled,
  });
}

export default useGetTaskPageReferences;
