import { useQuery } from "@tanstack/react-query";
import getPublicWhiteboard from "@/fetchers/whiteboard/get-public-whiteboard";
import { HttpError } from "@/lib/http-error";
import { whiteboardQueryKeys } from "./whiteboard-query-keys";

/** A published board; a revoked or unknown link is a 404 (no retries). */
export function usePublicWhiteboard(token: string) {
  return useQuery({
    queryKey: whiteboardQueryKeys.public(token),
    queryFn: ({ signal }) => getPublicWhiteboard(token, signal),
    retry: (count, error) =>
      !(error instanceof HttpError && error.status === 404) && count < 2,
    staleTime: 60_000,
  });
}
