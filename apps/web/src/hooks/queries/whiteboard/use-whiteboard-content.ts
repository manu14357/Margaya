import { useQuery } from "@tanstack/react-query";
import { getWhiteboardContent } from "@/fetchers/whiteboard/whiteboard-content";
import { isTerminalWhiteboardError } from "./use-whiteboard";
import { whiteboardQueryKeys } from "./whiteboard-query-keys";

/**
 * The board's elements over HTTP: shown read-only while the live socket
 * can't sync. Live boards never load it.
 */
export function useWhiteboardContent(whiteboardId: string, enabled: boolean) {
  return useQuery({
    queryKey: whiteboardQueryKeys.content(whiteboardId),
    queryFn: ({ signal }) => getWhiteboardContent(whiteboardId, signal),
    enabled: Boolean(whiteboardId) && enabled,
    retry: (failureCount, error) =>
      !isTerminalWhiteboardError(error) && failureCount < 2,
  });
}
