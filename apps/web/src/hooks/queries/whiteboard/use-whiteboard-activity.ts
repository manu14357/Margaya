import { useInfiniteQuery } from "@tanstack/react-query";
import { listWhiteboardActivity } from "@/fetchers/whiteboard/whiteboard-activity";
import { isTerminalWhiteboardError } from "./use-whiteboard";
import { whiteboardQueryKeys } from "./whiteboard-query-keys";

/**
 * A board's history, newest first, a page at a time. The project socket's
 * `whiteboard.changed` hint refreshes it (see whiteboard-realtime.ts).
 */
export function useWhiteboardActivity(
  whiteboardId: string,
  { enabled = true }: { enabled?: boolean } = {},
) {
  return useInfiniteQuery({
    queryKey: whiteboardQueryKeys.activity(whiteboardId),
    queryFn: ({ pageParam }) => listWhiteboardActivity(whiteboardId, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: Boolean(whiteboardId) && enabled,
    retry: (failureCount, error) =>
      !isTerminalWhiteboardError(error) && failureCount < 2,
  });
}
