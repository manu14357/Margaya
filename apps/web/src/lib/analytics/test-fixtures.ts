import type { AnalyticsChartResult, AnalyticsMeta } from "@/types/analytics";

// Chart results shaped like the API's, for the analytics tests. The numbers
// follow the B8 fixture: t2 has two assignees, so the buckets sum to more
// than the distinct total.

export const EMPTY_META: AnalyticsMeta = {
  users: [],
  projects: [],
  columns: [],
  labels: [],
  cycles: [],
  modules: [],
  estimates: [],
  customFields: [],
};

export function makeChartResult(
  overrides: Partial<AnalyticsChartResult> = {},
): AnalyticsChartResult {
  return {
    xAxis: "assignee",
    segment: "group",
    metric: "taskCount",
    dateBucket: null,
    today: "2026-03-25",
    totalCount: 8,
    totalValue: 8,
    progress: 43,
    noneCount: null,
    buckets: [
      {
        key: "m1",
        value: 4,
        taskCount: 4,
        cells: { backlog: 1, unstarted: 2, completed: 1 },
        progress: 25,
      },
      {
        key: "m2",
        value: 3,
        taskCount: 3,
        cells: { unstarted: 1, started: 1, cancelled: 1 },
        progress: 0,
      },
      {
        key: "none",
        value: 2,
        taskCount: 2,
        cells: { completed: 2 },
        progress: 100,
      },
    ],
    segments: [
      { key: "backlog", value: 1, taskCount: 1 },
      { key: "unstarted", value: 2, taskCount: 2 },
      { key: "started", value: 1, taskCount: 1 },
      { key: "completed", value: 3, taskCount: 3 },
      { key: "cancelled", value: 1, taskCount: 1 },
    ],
    truncated: {
      x: false,
      hiddenXCount: 0,
      segment: false,
      hiddenSegmentCount: 0,
    },
    multiValued: { x: true, segment: false },
    pointsProjectIds: ["p1"],
    meta: {
      ...EMPTY_META,
      users: [
        { id: "m1", name: "Mia", image: null },
        { id: "m2", name: "Max", image: null },
      ],
    },
    ...overrides,
  };
}
