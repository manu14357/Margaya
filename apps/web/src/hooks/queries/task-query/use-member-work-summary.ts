import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import queryTasks from "@/fetchers/task-query/query-tasks";
import { myWorkQueryKeys } from "@/lib/task-query/cache";
import { memberCountSpecs } from "@/lib/task-query/member-work";
import { queryContext } from "@/lib/task-query/request";
import { useUserPreferencesStore } from "@/store/user-preferences";
import type { TaskQueryRequest, TaskQueryResult } from "@/types/task-query";
import type { MyWorkGroupCounts } from "./use-my-work-summary";

const PRIORITIES = ["urgent", "high", "medium", "low", "no-priority"];

function groupCount(result: TaskQueryResult | undefined, key: string) {
  return result?.groups.find((group) => group.key === key)?.count ?? 0;
}

/**
 * A member's profile numbers: open and late work assigned to them, what they
 * finished and created in the last 30 days, and their work by state and by
 * priority. Keyed under "Your work", so task changes refresh it the same way.
 */
export function useMemberWorkSummary(workspaceId: string, userId: string) {
  const weekStartsOn = useUserPreferencesStore((state) => state.weekStartsOn);
  const specs = useMemo(() => memberCountSpecs(userId), [userId]);
  const results = useQueries({
    queries: specs.map((spec) => {
      const request: TaskQueryRequest = {
        workspaceId,
        filters: spec.filters,
        mode: "counts",
        display: {
          groupBy: spec.groupBy ?? null,
          subGroupBy: null,
          showEmptyGroups: spec.showEmptyGroups ?? false,
        },
        context: queryContext(weekStartsOn),
      };
      return {
        queryKey: [
          ...myWorkQueryKeys.workspace(workspaceId),
          "member",
          userId,
          spec.name,
          request,
        ],
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          queryTasks(request, signal),
        enabled: Boolean(workspaceId && userId),
        staleTime: 30_000,
        refetchOnWindowFocus: true,
      };
    }),
  });

  const stamp = results.map((result) => result.dataUpdatedAt).join(",");
  const byName = (name: string) =>
    results[specs.findIndex((spec) => spec.name === name)]?.data;

  // biome-ignore lint/correctness/useExhaustiveDependencies: stamp tracks the results
  const summary = useMemo(() => {
    const byGroup = byName("byGroup");
    const groups: MyWorkGroupCounts = {
      total: byGroup?.totalCount ?? 0,
      backlog: groupCount(byGroup, "backlog"),
      unstarted: groupCount(byGroup, "unstarted"),
      started: groupCount(byGroup, "started"),
      completed: groupCount(byGroup, "completed"),
      cancelled: groupCount(byGroup, "cancelled"),
    };
    const byPriority = byName("byPriority");
    return {
      counts: {
        assignedOpen: groups.backlog + groups.unstarted + groups.started,
        overdue: byName("overdue")?.totalCount ?? 0,
        completed30: byName("completed30")?.totalCount ?? 0,
        created30: byName("created30")?.totalCount ?? 0,
      },
      groups,
      priorities: PRIORITIES.map((priority) => ({
        priority,
        count: groupCount(byPriority, priority),
      })),
    };
  }, [stamp, specs]);

  return {
    summary,
    isLoading: results.some((result) => result.isLoading),
    isError: results.some((result) => result.isError),
    refetch: () => {
      for (const result of results) void result.refetch();
    },
  };
}

export default useMemberWorkSummary;
