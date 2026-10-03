import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import {
  getPublicBoardTask,
  getPublicBoardTaskDescription,
} from "@/fetchers/public-board/get-public-board-task";
import { listPublicBoardComments } from "@/fetchers/public-board/public-board-comments";
import { listMyPublicBoardRequests } from "@/fetchers/public-board/public-board-requests";
import { publicBoardKeys } from "./public-board-keys";
import { retryUnlessNotFound } from "./use-public-board";

/** An open peek's comments refresh this often while the page is visible. */
const COMMENTS_POLL_MS = 30_000;

/** The task in the peek, with my vote and reactions (never cached long). */
export function usePublicBoardTask(token: string, number: number | null) {
  return useQuery({
    queryKey: publicBoardKeys.task(token, number ?? 0),
    queryFn: ({ signal }) => getPublicBoardTask(token, number ?? 0, signal),
    enabled: number !== null,
    staleTime: 10_000,
    // My vote and what I may do follow the viewer (sign-in in between).
    refetchOnMount: "always",
    retry: retryUnlessNotFound,
  });
}

/** A description too long for the task payload, loaded page by page. */
export function usePublicBoardTaskDescription(
  token: string,
  number: number | null,
  enabled: boolean,
) {
  return useQuery({
    queryKey: publicBoardKeys.description(token, number ?? 0),
    queryFn: ({ signal }) =>
      getPublicBoardTaskDescription(token, number ?? 0, signal),
    enabled: enabled && number !== null,
    staleTime: 60_000,
    retry: false,
  });
}

/** Public comments, oldest first, 50 per page. */
export function usePublicBoardComments(
  token: string,
  number: number | null,
  enabled: boolean,
) {
  return useInfiniteQuery({
    queryKey: publicBoardKeys.comments(token, number ?? 0),
    queryFn: ({ pageParam, signal }) =>
      listPublicBoardComments(token, number ?? 0, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled: enabled && number !== null,
    refetchOnMount: "always",
    refetchInterval: COMMENTS_POLL_MS,
    retry: retryUnlessNotFound,
  });
}

/** My requests to this board, newest first (accounts only). */
export function useMyPublicBoardRequests(token: string, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: publicBoardKeys.myRequests(token),
    queryFn: ({ pageParam, signal }) =>
      listMyPublicBoardRequests(token, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    enabled,
    retry: retryUnlessNotFound,
  });
}
