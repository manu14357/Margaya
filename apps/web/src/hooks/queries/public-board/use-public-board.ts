import { useQuery } from "@tanstack/react-query";
import getPublicBoard from "@/fetchers/public-board/get-public-board";
import { HttpError } from "@/lib/http-error";
import { publicBoardKeys } from "./public-board-keys";

/** A missing or unpublished board answers 404: no point retrying it. */
export function retryUnlessNotFound(failureCount: number, error: unknown) {
  if (error instanceof HttpError && error.status < 500) return false;
  return failureCount < 2;
}

/** The board and the viewer's rights; refreshed after signing in or out. */
export function usePublicBoard(token: string) {
  return useQuery({
    queryKey: publicBoardKeys.board(token),
    queryFn: ({ signal }) => getPublicBoard(token, signal),
    staleTime: 30_000,
    // It carries the viewer: coming back from sign-in must not reuse it.
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    retry: retryUnlessNotFound,
  });
}
