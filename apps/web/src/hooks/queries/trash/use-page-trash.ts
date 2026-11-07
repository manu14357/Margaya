import { useInfiniteQuery } from "@tanstack/react-query";
import { listPageTrash } from "@/fetchers/trash/page-trash";
import { trashQueryKeys } from "./trash-query-keys";

/** A project's deleted pages, 50 at a time, newest first. */
export function usePageTrash(projectId: string, q = "", enabled = true) {
  return useInfiniteQuery({
    queryKey: trashQueryKeys.pages(projectId, q.trim()),
    queryFn: ({ pageParam }) =>
      listPageTrash({ projectId, search: q, page: pageParam }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.hasMore ? last.page + 1 : undefined),
    enabled: enabled && Boolean(projectId),
  });
}
