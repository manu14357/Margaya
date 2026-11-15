import { useQuery } from "@tanstack/react-query";
import { getWhiteboard } from "@/fetchers/whiteboard/whiteboards";
import { HttpError } from "@/lib/http-error";
import { whiteboardQueryKeys } from "./whiteboard-query-keys";

/** A 4xx (gone, foreign, feature off, no access) won't change on retry. */
export function isTerminalWhiteboardError(error: unknown) {
  return (
    error instanceof HttpError && error.status >= 400 && error.status < 500
  );
}

/** One board's header data and the caller's capabilities on it. */
export function useWhiteboard(
  whiteboardId: string,
  options?: { enabled?: boolean },
) {
  return useQuery({
    queryKey: whiteboardQueryKeys.detail(whiteboardId),
    queryFn: () => getWhiteboard(whiteboardId),
    enabled: Boolean(whiteboardId) && (options?.enabled ?? true),
    retry: (failureCount, error) =>
      !isTerminalWhiteboardError(error) && failureCount < 2,
  });
}
