import { useInfiniteQuery } from "@tanstack/react-query";
import { listProjectTrash } from "@/fetchers/trash/project-trash";
import { trashQueryKeys } from "./trash-query-keys";

/**
 * The workspace's trashed projects, 50 at a time. There is no workspace
 * socket, so the list also refreshes on focus.
 */
export function useProjectTrash(workspaceId: string, q = "") {
  return useInfiniteQuery({
    queryKey: trashQueryKeys.projects(workspaceId, q.trim()),
    queryFn: ({ pageParam }) =>
      listProjectTrash({ workspaceId, search: q, page: pageParam }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.hasMore ? last.page + 1 : undefined),
    enabled: Boolean(workspaceId),
    refetchOnWindowFocus: true,
  });
}
