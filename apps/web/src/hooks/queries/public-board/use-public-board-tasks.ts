import { keepPreviousData, useQueries, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import listPublicBoardTasks from "@/fetchers/public-board/list-public-board-tasks";
import { HttpError } from "@/lib/http-error";
import {
  mergeTaskPages,
  type TaskPageSlice,
} from "@/lib/public-board/board-state";
import type { PublicTaskListQuery, PublicTaskPage } from "@/types/public-board";
import { publicBoardKeys } from "./public-board-keys";
import { retryUnlessNotFound } from "./use-public-board";

/** The board has no socket: the list polls while the page is visible (K19). */
const POLL_MS = 60_000;

type MoreRequest = { group: string; cursor: string };

/**
 * The board's tasks, a first page per column plus "load more" per column.
 * Each loaded page is its own cached query, so polling refreshes them all.
 * The previous result stays on screen while new filters load.
 */
export function usePublicBoardTasks(
  token: string,
  query: PublicTaskListQuery,
  { enabled = true }: { enabled?: boolean } = {},
) {
  const hash = useMemo(() => JSON.stringify(query), [query]);
  const [more, setMore] = useState<{ hash: string; requests: MoreRequest[] }>({
    hash,
    requests: [],
  });
  const moreRequests = more.hash === hash ? more.requests : [];

  const base = useQuery({
    queryKey: publicBoardKeys.tasks(token, query),
    queryFn: ({ signal }) => listPublicBoardTasks(token, query, signal),
    enabled,
    placeholderData: keepPreviousData,
    refetchInterval: POLL_MS,
    retry: retryUnlessNotFound,
  });

  const moreQueries = useQueries({
    queries: moreRequests.map((entry) => ({
      queryKey: [
        ...publicBoardKeys.tasks(token, query),
        "more",
        entry.group,
        entry.cursor,
      ],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        listPublicBoardTasks(
          token,
          { ...query, group: entry.group, cursor: entry.cursor },
          signal,
        ),
      enabled,
      refetchInterval: POLL_MS,
      retry: false,
    })),
  });

  // A stale cursor (the board changed under it) drops the loaded pages.
  const staleCursor = moreQueries.some(
    (entry) => entry.error instanceof HttpError && entry.error.status === 400,
  );
  useEffect(() => {
    if (staleCursor) setMore({ hash, requests: [] });
  }, [staleCursor, hash]);

  const stamp = moreQueries
    .map((entry) => `${entry.dataUpdatedAt}:${entry.status}`)
    .join(",");
  // biome-ignore lint/correctness/useExhaustiveDependencies: stamp tracks the page results
  const data = useMemo(() => {
    if (!base.data) return undefined;
    const slices: TaskPageSlice[] = [];
    moreRequests.forEach((entry, index) => {
      const page = moreQueries[index]?.data as PublicTaskPage | undefined;
      if (page) slices.push({ group: entry.group, page });
    });
    return mergeTaskPages(base.data, slices);
  }, [base.data, moreRequests, stamp]);

  const loadMore = useCallback(
    (group: string) => {
      const cursor = data?.groups.find(
        (entry) => entry.key === group,
      )?.nextCursor;
      if (!cursor) return;
      setMore((current) => {
        const requests = current.hash === hash ? current.requests : [];
        if (requests.some((entry) => entry.cursor === cursor)) return current;
        return { hash, requests: [...requests, { group, cursor }] };
      });
    },
    [data, hash],
  );

  const isLoadingMore = useCallback(
    (group: string) =>
      moreRequests.some(
        (entry, index) =>
          entry.group === group && moreQueries[index]?.isPending === true,
      ),
    [moreRequests, moreQueries],
  );

  return {
    data,
    isLoading: base.isLoading,
    isError: base.isError,
    error: base.error,
    isFetching: base.isFetching,
    refetch: base.refetch,
    loadMore,
    isLoadingMore,
  };
}
