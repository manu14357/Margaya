import { useInfiniteQuery } from "@tanstack/react-query";
import { listWhiteboardTrash } from "@/fetchers/trash/whiteboard-trash";
import { trashQueryKeys } from "./trash-query-keys";

/** A project's deleted boards, 50 at a time, newest first. */
export function useWhiteboardTrash(projectId: string, q = "", enabled = true) {
  return useInfiniteQuery({
    queryKey: trashQueryKeys.whiteboards(projectId, q.trim()),
    queryFn: ({ pageParam }) =>
      listWhiteboardTrash({ projectId, search: q, page: pageParam }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.hasMore ? last.page + 1 : undefined),
    enabled: enabled && Boolean(projectId),
  });
}
