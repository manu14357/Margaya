import { useInfiniteQuery } from "@tanstack/react-query";
import listArchived from "@/fetchers/archive/list-archived";
import type { ArchivedEntityType } from "@/types/archive";
import { archiveQueryKeys } from "./archive-query-keys";

/** Archived cycles, modules or projects in scope, 50 at a time. */
export function useArchivedEntities({
  workspaceId,
  projectId,
  type,
  q = "",
  enabled = true,
}: {
  workspaceId: string;
  projectId?: string;
  type: ArchivedEntityType;
  q?: string;
  enabled?: boolean;
}) {
  return useInfiniteQuery({
    queryKey: archiveQueryKeys.list(workspaceId, projectId, type, q.trim()),
    queryFn: ({ pageParam }) =>
      listArchived({
        workspaceId,
        projectId,
        type,
        search: q,
        page: pageParam,
      }),
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.hasMore ? lastPage.page + 1 : undefined,
    enabled: Boolean(workspaceId) && enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}

export default useArchivedEntities;
