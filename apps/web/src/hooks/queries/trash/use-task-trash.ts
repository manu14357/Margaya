import { useInfiniteQuery } from "@tanstack/react-query";
import { listTaskTrash } from "@/fetchers/trash/task-trash";
import { trashQueryKeys } from "./trash-query-keys";

/** A project's trashed tasks, 50 at a time, newest first. */
export function useTaskTrash(projectId: string, q = "") {
  return useInfiniteQuery({
    queryKey: trashQueryKeys.tasks(projectId, q.trim()),
    queryFn: ({ pageParam }) =>
      listTaskTrash({ projectId, search: q, page: pageParam }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.hasMore ? last.page + 1 : undefined),
    enabled: Boolean(projectId),
  });
}
