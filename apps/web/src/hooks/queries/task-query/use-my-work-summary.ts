import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";
import queryTasks from "@/fetchers/task-query/query-tasks";
import { SUBSCRIBER_FILTER_AVAILABLE } from "@/lib/task-query/built-in-views";
import { myWorkQueryKeys } from "@/lib/task-query/cache";
import type {
  FilterCondition,
  FilterNode,
  GroupByKey,
} from "@/lib/task-query/model";
import { queryContext, useUserTimeZone } from "@/lib/task-query/request";
import { useUserPreferencesStore } from "@/store/user-preferences";
import type { TaskQueryRequest, TaskQueryResult } from "@/types/task-query";

// "Your work" numbers, each one engine count (mode counts) over the
// workspace's projects: what is assigned to me, open, late, due soon,
// finished lately, created by me and subscribed to.

const OPEN_GROUPS = ["backlog", "unstarted", "started"];

const assignedToMe: FilterCondition = {
  key: "assignee",
  operator: "in",
  values: ["me"],
};
const isOpen: FilterCondition = {
  key: "group",
  operator: "in",
  values: OPEN_GROUPS,
};

const and = (...children: FilterCondition[]): FilterNode => ({
  op: "and",
  children,
});

type CountSpec = {
  name: string;
  filters: FilterNode;
  groupBy?: GroupByKey;
  subGroupBy?: GroupByKey;
  showEmptyGroups?: boolean;
};

const SPECS: CountSpec[] = [
  { name: "byGroup", filters: and(assignedToMe), groupBy: "group" },
  {
    name: "byPriority",
    filters: and(assignedToMe, isOpen),
    groupBy: "priority",
    showEmptyGroups: true,
  },
  {
    name: "overdue",
    filters: and(assignedToMe, isOpen, {
      key: "dueDate",
      operator: "in",
      values: ["past"],
    }),
  },
  {
    name: "dueThisWeek",
    filters: and(assignedToMe, isOpen, {
      key: "dueDate",
      operator: "in",
      values: ["thisWeek"],
    }),
  },
  {
    name: "completed30",
    filters: and(
      assignedToMe,
      { key: "group", operator: "in", values: ["completed"] },
      { key: "completedAt", operator: "withinLast", amount: 30, unit: "days" },
    ),
  },
  {
    name: "created",
    filters: and({ key: "createdBy", operator: "in", values: ["me"] }),
  },
  {
    name: "byProject",
    filters: and(assignedToMe),
    groupBy: "project",
    subGroupBy: "group",
  },
  ...(SUBSCRIBER_FILTER_AVAILABLE
    ? [
        {
          name: "subscribed",
          filters: and({ key: "subscriber", operator: "in", values: ["me"] }),
        },
      ]
    : []),
];

export type MyWorkGroupCounts = {
  total: number;
  backlog: number;
  unstarted: number;
  started: number;
  completed: number;
  cancelled: number;
};

export type MyWorkProjectRow = {
  projectId: string;
  name: string;
  slug: string;
  icon: string | null;
  open: number;
  completed: number;
};

function groupCount(result: TaskQueryResult | undefined, key: string) {
  return result?.groups.find((group) => group.key === key)?.count ?? 0;
}

export function useMyWorkSummary(workspaceId: string) {
  const weekStartsOn = useUserPreferencesStore((state) => state.weekStartsOn);
  const timeZone = useUserTimeZone();
  const results = useQueries({
    queries: SPECS.map((spec) => {
      const request: TaskQueryRequest = {
        workspaceId,
        filters: spec.filters,
        mode: "counts",
        display: {
          groupBy: spec.groupBy ?? null,
          subGroupBy: spec.subGroupBy ?? null,
          showEmptyGroups: spec.showEmptyGroups ?? false,
        },
        context: queryContext(weekStartsOn, timeZone),
      };
      return {
        queryKey: [
          ...myWorkQueryKeys.workspace(workspaceId),
          spec.name,
          request,
        ],
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          queryTasks(request, signal),
        enabled: Boolean(workspaceId),
        staleTime: 30_000,
        refetchOnWindowFocus: true,
      };
    }),
  });

  const stamp = results.map((result) => result.dataUpdatedAt).join(",");
  const byName = (name: string) =>
    results[SPECS.findIndex((spec) => spec.name === name)]?.data;

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
    const byProject = byName("byProject");
    const projects: MyWorkProjectRow[] = (byProject?.groups ?? [])
      .map((group) => {
        const project = byProject?.meta.projects.find(
          (candidate) => candidate.id === group.key,
        );
        const cellCount = (keys: string[]) =>
          (group.subGroups ?? [])
            .filter((cell) => keys.includes(cell.key))
            .reduce((sum, cell) => sum + cell.count, 0);
        return {
          projectId: group.key,
          name: project?.name ?? group.key,
          slug: project?.slug ?? "",
          icon: project?.icon ?? null,
          open: cellCount(OPEN_GROUPS),
          completed: cellCount(["completed"]),
        };
      })
      .sort((a, b) => b.open - a.open)
      .slice(0, 10);
    return {
      counts: {
        assignedOpen: groups.backlog + groups.unstarted + groups.started,
        overdue: byName("overdue")?.totalCount ?? 0,
        dueThisWeek: byName("dueThisWeek")?.totalCount ?? 0,
        completed30: byName("completed30")?.totalCount ?? 0,
        created: byName("created")?.totalCount ?? 0,
        subscribed: SUBSCRIBER_FILTER_AVAILABLE
          ? (byName("subscribed")?.totalCount ?? 0)
          : null,
      },
      groups,
      priorities: ["urgent", "high", "medium", "low", "no-priority"].map(
        (priority) => ({
          priority,
          count: groupCount(byPriority, priority),
        }),
      ),
      projects,
      today: byGroup?.today ?? null,
    };
  }, [stamp]);

  return {
    summary,
    isLoading: results.some((result) => result.isLoading),
    isError: results.some((result) => result.isError),
    /** A count has no value to show: its load failed, or it is paused offline. */
    isUnavailable: results.some(
      (result) => result.data === undefined && !result.isLoading,
    ),
    error: results.find((result) => result.error)?.error ?? null,
    refetch: () => {
      for (const result of results) void result.refetch();
    },
  };
}

export default useMyWorkSummary;
