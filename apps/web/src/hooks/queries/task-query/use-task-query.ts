import { keepPreviousData, useQueries, useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useState } from "react";
import queryTasks from "@/fetchers/task-query/query-tasks";
import { HttpError } from "@/lib/http-error";
import {
  scopeKeyOf,
  taskQueryKeys,
  WORKSPACE_SCOPE_KEY,
} from "@/lib/task-query/cache";
import { stableHash } from "@/lib/task-query/filter-tree";
import {
  type LoadMoreSlice,
  mergeTaskQueryPages,
  nextCursorOf,
} from "@/lib/task-query/merge";
import { withoutPage } from "@/lib/task-query/request";
import type { TaskQueryRequest, TaskQueryResult } from "@/types/task-query";

/** Workspace lists have no project socket; they poll while visible (K19). */
const WORKSPACE_REFETCH_MS = 30_000;

type LoadMoreRequest = { group: string; subGroup?: string; cursor: string };

/**
 * Grouped task rows for a request (rows mode), with "load more" per group
 * or cell. Each loaded slice is its own cached query, so realtime
 * invalidation refreshes every loaded page, not just the first. The
 * previous result stays on screen while new filters load.
 */
export function useTaskQuery(
  request: TaskQueryRequest | null,
  { enabled = true }: { enabled?: boolean } = {},
) {
  const workspaceId = request?.workspaceId ?? "";
  const scopeKey = scopeKeyOf(request?.scope?.projectIds);
  const isWorkspace = scopeKey === WORKSPACE_SCOPE_KEY;
  const baseRequest = useMemo(
    () => (request ? withoutPage(request) : null),
    [request],
  );
  const hash = useMemo(() => stableHash(baseRequest), [baseRequest]);
  const baseKey = useMemo(
    () => taskQueryKeys.request(workspaceId, scopeKey, "rows", baseRequest),
    [workspaceId, scopeKey, baseRequest],
  );
  const [more, setMore] = useState<{
    hash: string;
    requests: LoadMoreRequest[];
  }>({ hash, requests: [] });
  const moreRequests = more.hash === hash ? more.requests : [];
  const isEnabled = Boolean(request?.workspaceId) && enabled;

  const base = useQuery({
    queryKey: baseKey,
    queryFn: ({ signal }) => {
      if (!request) throw new Error("No task query");
      return queryTasks(request, signal);
    },
    enabled: isEnabled,
    placeholderData: keepPreviousData,
    refetchInterval: isWorkspace ? WORKSPACE_REFETCH_MS : false,
    refetchOnWindowFocus: isWorkspace,
  });

  const moreQueries = useQueries({
    queries: moreRequests.map((entry) => ({
      queryKey: [
        ...baseKey,
        "more",
        entry.group,
        entry.subGroup ?? "",
        entry.cursor,
      ],
      queryFn: ({ signal }: { signal: AbortSignal }) => {
        if (!request) throw new Error("No task query");
        return queryTasks(
          {
            ...request,
            page: {
              ...(request.page?.limit ? { limit: request.page.limit } : {}),
              group: entry.group,
              ...(entry.subGroup !== undefined
                ? { subGroup: entry.subGroup }
                : {}),
              cursor: entry.cursor,
            },
          },
          signal,
        );
      },
      enabled: isEnabled,
      refetchInterval: isWorkspace ? WORKSPACE_REFETCH_MS : false,
      retry: false,
    })),
  });

  // A stale cursor (the results changed under it) drops the loaded slices;
  // the first page reloads on its own.
  const staleCursor = moreQueries.some(
    (query) => query.error instanceof HttpError && query.error.status === 400,
  );
  useEffect(() => {
    if (staleCursor) setMore({ hash, requests: [] });
  }, [staleCursor, hash]);

  const moreStamp = moreQueries
    .map((query) => `${query.dataUpdatedAt}:${query.status}`)
    .join(",");
  // biome-ignore lint/correctness/useExhaustiveDependencies: moreStamp tracks the slice results
  const data = useMemo(() => {
    if (!base.data) return undefined;
    const slices: LoadMoreSlice[] = [];
    moreRequests.forEach((entry, index) => {
      const result = moreQueries[index]?.data as TaskQueryResult | undefined;
      if (result) {
        slices.push({
          group: entry.group,
          ...(entry.subGroup !== undefined ? { subGroup: entry.subGroup } : {}),
          result,
        });
      }
    });
    return mergeTaskQueryPages(base.data, slices);
  }, [base.data, moreRequests, moreStamp]);

  const loadMore = useCallback(
    (group: string, subGroup?: string) => {
      const cursor = nextCursorOf(data, group, subGroup);
      if (!cursor) return;
      setMore((current) => {
        const requests = current.hash === hash ? current.requests : [];
        if (requests.some((entry) => entry.cursor === cursor)) return current;
        return { hash, requests: [...requests, { group, subGroup, cursor }] };
      });
    },
    [data, hash],
  );

  const isLoadingMore = useCallback(
    (group: string, subGroup?: string) =>
      moreRequests.some(
        (entry, index) =>
          entry.group === group &&
          entry.subGroup === subGroup &&
          moreQueries[index]?.isPending === true,
      ),
    [moreRequests, moreQueries],
  );

  return {
    data,
    isLoading: base.isLoading,
    isFetching: base.isFetching,
    isPlaceholderData: base.isPlaceholderData,
    isError: base.isError,
    error: base.error,
    refetch: base.refetch,
    loadMore,
    isLoadingMore,
  };
}

export type TaskQueryHandle = ReturnType<typeof useTaskQuery>;

export default useTaskQuery;
