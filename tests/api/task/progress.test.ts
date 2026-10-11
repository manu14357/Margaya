import { describe, expect, it } from "vitest";
import {
  assigneeRows,
  buildBurnChart,
  buildProgressReport,
  countGroups,
  labelRows,
  pendingOf,
  priorityRows,
  progressOf,
  type ScopeTask,
  sortAssigneeRows,
  sortLabelRows,
} from "../../../apps/api/src/task/progress";

const at = (iso: string) => new Date(iso);

function task(overrides: Partial<ScopeTask> & { id: string }): ScopeTask {
  return {
    group: "unstarted",
    priority: "low",
    completedAt: null,
    updatedAt: at("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("counts and progress", () => {
  it("counts each group and leaves cancelled out of progress", () => {
    const counts = countGroups([
      task({ id: "1", group: "backlog" }),
      task({ id: "2", group: "unstarted" }),
      task({ id: "3", group: "started" }),
      task({ id: "4", group: "completed" }),
      task({ id: "5", group: "completed" }),
      task({ id: "6", group: "cancelled" }),
    ]);
    expect(counts).toEqual({
      total: 6,
      backlog: 1,
      unstarted: 1,
      started: 1,
      completed: 2,
      cancelled: 1,
    });
    expect(pendingOf(counts)).toBe(3);
    // 2 of (6 - 1) = 40%.
    expect(progressOf(counts)).toBe(40);
  });

  it("is 0 without tasks and 100 when everything is cancelled", () => {
    expect(progressOf(countGroups([]))).toBe(0);
    expect(
      progressOf(
        countGroups([
          task({ id: "1", group: "cancelled" }),
          task({ id: "2", group: "cancelled" }),
        ]),
      ),
    ).toBe(100);
  });
});

describe("buildBurnChart", () => {
  it("returns null without dates or without scope", () => {
    const tasks = [task({ id: "1" })];
    expect(
      buildBurnChart({
        startDate: null,
        endDate: null,
        today: "2026-06-03",
        scopeTasks: tasks,
      }),
    ).toBeNull();
    expect(
      buildBurnChart({
        startDate: "2026-06-01",
        endDate: "2026-06-05",
        today: "2026-06-03",
        scopeTasks: [task({ id: "1", group: "cancelled" })],
      }),
    ).toBeNull();
    expect(
      buildBurnChart({
        startDate: "2026-06-01",
        endDate: "2026-06-05",
        today: "2026-06-03",
        scopeTasks: [],
      }),
    ).toBeNull();
  });

  it("burns down from completion dates, with nulls after today", () => {
    const chart = buildBurnChart({
      startDate: "2026-06-01",
      endDate: "2026-06-05",
      today: "2026-06-03",
      scopeTasks: [
        // Completed before the start: done from day 0.
        task({
          id: "1",
          group: "completed",
          completedAt: at("2026-05-30T10:00:00Z"),
        }),
        task({
          id: "2",
          group: "completed",
          completedAt: at("2026-06-02T23:30:00Z"),
        }),
        // No completion timestamp: its last update stands in.
        task({
          id: "3",
          group: "completed",
          completedAt: null,
          updatedAt: at("2026-06-03T01:00:00Z"),
        }),
        task({ id: "4", group: "started" }),
        task({ id: "5", group: "cancelled" }),
      ],
    });

    expect(chart).toEqual({
      scope: 4,
      days: [
        { date: "2026-06-01", completed: 1, remaining: 3, ideal: 4 },
        { date: "2026-06-02", completed: 2, remaining: 2, ideal: 3 },
        { date: "2026-06-03", completed: 3, remaining: 1, ideal: 2 },
        { date: "2026-06-04", completed: null, remaining: null, ideal: 1 },
        { date: "2026-06-05", completed: null, remaining: null, ideal: 0 },
      ],
    });
  });

  it("does not count completions after the end inside the range", () => {
    const chart = buildBurnChart({
      startDate: "2026-06-01",
      endDate: "2026-06-03",
      today: "2026-06-10",
      scopeTasks: [
        task({
          id: "1",
          group: "completed",
          completedAt: at("2026-06-05T12:00:00Z"),
        }),
        task({ id: "2", group: "backlog" }),
      ],
    });
    expect(chart?.days.map((day) => day.remaining)).toEqual([2, 2, 2]);
    expect(chart?.days.map((day) => day.completed)).toEqual([0, 0, 0]);
  });

  it("ignores the completion time of tasks that are no longer completed", () => {
    const chart = buildBurnChart({
      startDate: "2026-06-01",
      endDate: "2026-06-02",
      today: "2026-06-02",
      scopeTasks: [
        task({
          id: "1",
          group: "started",
          completedAt: at("2026-06-01T12:00:00Z"),
        }),
      ],
    });
    expect(chart?.days.map((day) => day.remaining)).toEqual([1, 1]);
  });

  it("puts a single-day cycle's ideal at the scope", () => {
    const chart = buildBurnChart({
      startDate: "2026-06-01",
      endDate: "2026-06-01",
      today: "2026-06-01",
      scopeTasks: [task({ id: "1" }), task({ id: "2" })],
    });
    expect(chart).toEqual({
      scope: 2,
      days: [{ date: "2026-06-01", completed: 0, remaining: 2, ideal: 2 }],
    });
  });

  it("rounds the ideal line to two decimals", () => {
    const chart = buildBurnChart({
      startDate: "2026-06-01",
      endDate: "2026-06-04",
      today: "2026-05-01",
      scopeTasks: [task({ id: "1" })],
    });
    expect(chart?.days.map((day) => day.ideal)).toEqual([1, 0.67, 0.33, 0]);
    expect(chart?.days.every((day) => day.remaining === null)).toBe(true);
  });
});

describe("buildBurnChart in points mode", () => {
  // Hand-computed: scope = 5 + 3 + 0.5 = 8.5 (the cancelled 8 and the
  // unestimated task weigh nothing). Done by day: 06-01 → 5, 06-02 → 5.5.
  const points = new Map([
    ["1", 5],
    ["2", 0.5],
    ["3", 3],
    ["5", 8],
  ]);
  const scopeTasks = [
    task({
      id: "1",
      group: "completed",
      completedAt: at("2026-06-01T08:00:00Z"),
    }),
    task({
      id: "2",
      group: "completed",
      completedAt: at("2026-06-02T08:00:00Z"),
    }),
    task({ id: "3", group: "started" }),
    task({ id: "4", group: "unstarted" }),
    task({ id: "5", group: "cancelled" }),
  ];

  it("sums estimate values instead of counting tasks", () => {
    const chart = buildBurnChart({
      startDate: "2026-06-01",
      endDate: "2026-06-03",
      today: "2026-06-02",
      scopeTasks,
      weight: (scoped) => points.get(scoped.id) ?? 0,
    });
    expect(chart).toEqual({
      scope: 8.5,
      days: [
        { date: "2026-06-01", completed: 5, remaining: 3.5, ideal: 8.5 },
        { date: "2026-06-02", completed: 5.5, remaining: 3, ideal: 4.25 },
        { date: "2026-06-03", completed: null, remaining: null, ideal: 0 },
      ],
    });
  });

  it("rounds sums to two decimals", () => {
    const chart = buildBurnChart({
      startDate: "2026-06-01",
      endDate: "2026-06-01",
      today: "2026-06-01",
      scopeTasks: [
        task({
          id: "a",
          group: "completed",
          completedAt: at("2026-06-01T01:00:00Z"),
        }),
        task({ id: "b" }),
      ],
      weight: (scoped) => (scoped.id === "a" ? 0.1 : 0.2),
    });
    expect(chart).toEqual({
      scope: 0.3,
      days: [
        { date: "2026-06-01", completed: 0.1, remaining: 0.2, ideal: 0.3 },
      ],
    });
  });

  it("has no chart when nothing in scope is estimated", () => {
    expect(
      buildBurnChart({
        startDate: "2026-06-01",
        endDate: "2026-06-03",
        today: "2026-06-02",
        scopeTasks: [task({ id: "9" })],
        weight: () => 0,
      }),
    ).toBeNull();
  });

  it("is built by the report from the per-task values", () => {
    const estimates = {
      enabled: true,
      estimateId: "e1",
      type: "points" as const,
      isNumeric: true,
      taskCount: 5,
      estimatedTaskCount: 4,
      completedTaskCount: 2,
      completedEstimatedTaskCount: 2,
      total: 16.5,
      completed: 5.5,
      byGroup: {
        backlog: { taskCount: 0, estimatedTaskCount: 0, total: 0 },
        unstarted: { taskCount: 1, estimatedTaskCount: 0, total: 0 },
        started: { taskCount: 1, estimatedTaskCount: 1, total: 3 },
        completed: { taskCount: 2, estimatedTaskCount: 2, total: 5.5 },
        cancelled: { taskCount: 1, estimatedTaskCount: 1, total: 8 },
      },
      distribution: [],
    };
    const report = buildProgressReport({
      startDate: "2026-06-01",
      endDate: "2026-06-03",
      today: "2026-06-02",
      tasks: scopeTasks,
      assignees: new Map(),
      labels: [],
      workspaceColors: new Map(),
      estimates,
      estimateValues: points,
    });
    expect(report.estimates).toBe(estimates);
    expect(report.estimateChart?.scope).toBe(8.5);
    // The task-count chart is unchanged: 4 tasks in scope.
    expect(report.chart?.scope).toBe(4);

    const withoutValues = buildProgressReport({
      startDate: "2026-06-01",
      endDate: "2026-06-03",
      today: "2026-06-02",
      tasks: scopeTasks,
      assignees: new Map(),
      labels: [],
      workspaceColors: new Map(),
      estimates,
      estimateValues: new Map(),
    });
    expect(withoutValues.estimateChart).toBeNull();
  });
});

describe("breakdowns", () => {
  it("sorts assignee rows by name, case-insensitively, unassigned last", () => {
    const tally = { total: 1, completed: 0, cancelled: 0, pending: 1 };
    const rows = sortAssigneeRows([
      { userId: null, name: null, image: null, ...tally },
      { userId: "b", name: "bob", image: null, ...tally },
      { userId: "a", name: "Alice", image: null, ...tally },
      { userId: "c", name: "Carol", image: null, ...tally },
    ]);
    expect(rows.map((row) => row.userId)).toEqual(["a", "b", "c", null]);
  });

  it("tallies assignees with cancelled apart from pending", () => {
    const zed = { id: "u1", name: "Zed", image: null };
    const rows = assigneeRows(
      [
        task({ id: "1", group: "completed" }),
        task({ id: "2", group: "cancelled" }),
        task({ id: "3", group: "started" }),
        task({ id: "4", group: "backlog" }),
      ],
      new Map([
        ["1", [zed]],
        ["2", [zed]],
        ["3", [zed]],
      ]),
    );
    expect(rows).toEqual([
      {
        userId: "u1",
        name: "Zed",
        image: null,
        total: 3,
        completed: 1,
        cancelled: 1,
        pending: 1,
      },
      {
        userId: null,
        name: null,
        image: null,
        total: 1,
        completed: 0,
        cancelled: 0,
        pending: 1,
      },
    ]);
  });

  it("counts a task once per assignee and unassigned tasks once", () => {
    const ana = { id: "a", name: "Ana", image: "https://img/a.png" };
    const ben = { id: "b", name: "Ben", image: null };
    const rows = assigneeRows(
      [
        task({ id: "1", group: "completed" }),
        task({ id: "2", group: "started" }),
        task({ id: "3", group: "cancelled" }),
      ],
      new Map([
        ["1", [ana, ben]],
        ["2", [ben]],
        ["3", []],
      ]),
    );
    expect(rows).toEqual([
      {
        userId: "a",
        name: "Ana",
        image: "https://img/a.png",
        total: 1,
        completed: 1,
        cancelled: 0,
        pending: 0,
      },
      {
        userId: "b",
        name: "Ben",
        image: null,
        total: 2,
        completed: 1,
        cancelled: 0,
        pending: 1,
      },
      {
        userId: null,
        name: null,
        image: null,
        total: 1,
        completed: 0,
        cancelled: 1,
        pending: 0,
      },
    ]);
  });

  it("counts a task in every label row and adds a no-label row", () => {
    const tasks = [
      task({ id: "1", group: "completed" }),
      task({ id: "2" }),
      task({ id: "3" }),
    ];
    const created = at("2026-01-01T00:00:00Z");
    const later = at("2026-02-01T00:00:00Z");
    const rows = labelRows(
      tasks,
      [
        { id: "l1", taskId: "1", name: "bug", color: "#111", createdAt: later },
        {
          id: "l2",
          taskId: "1",
          name: "API",
          color: "#222",
          createdAt: created,
        },
        {
          id: "l3",
          taskId: "2",
          name: "bug",
          color: "#333",
          createdAt: created,
        },
        // A label copy of a task outside the scope is ignored.
        {
          id: "l4",
          taskId: "9",
          name: "zzz",
          color: "#444",
          createdAt: created,
        },
      ],
      new Map([["API", "#workspace"]]),
    );
    expect(rows).toEqual([
      {
        name: "API",
        color: "#workspace",
        total: 1,
        completed: 1,
        cancelled: 0,
        pending: 0,
      },
      {
        name: "bug",
        color: "#333",
        total: 2,
        completed: 1,
        cancelled: 0,
        pending: 1,
      },
      {
        name: null,
        color: null,
        total: 1,
        completed: 0,
        cancelled: 0,
        pending: 1,
      },
    ]);
  });

  it("sorts label rows by name with the no-label row last", () => {
    const tally = { total: 1, completed: 0, cancelled: 0, pending: 1 };
    expect(
      sortLabelRows([
        { name: null, color: null, ...tally },
        { name: "beta", color: "#1", ...tally },
        { name: "Alpha", color: "#2", ...tally },
      ]).map((row) => row.name),
    ).toEqual(["Alpha", "beta", null]);
  });

  it("always returns the five priorities in fixed order", () => {
    const rows = priorityRows([
      task({ id: "1", priority: "high", group: "completed" }),
      task({ id: "2", priority: "high" }),
      task({ id: "3", priority: "legacy-value" }),
    ]);
    expect(rows.map((row) => row.priority)).toEqual([
      "urgent",
      "high",
      "medium",
      "low",
      "no-priority",
    ]);
    expect(rows[1]).toMatchObject({ total: 2, completed: 1, pending: 1 });
    expect(rows[4]).toMatchObject({ total: 1, pending: 1 });
    expect(rows[0]).toMatchObject({ total: 0, completed: 0 });
  });

  it("assembles a full report", () => {
    const report = buildProgressReport({
      startDate: null,
      endDate: null,
      today: "2026-06-01",
      tasks: [task({ id: "1", group: "completed" })],
      assignees: new Map(),
      labels: [],
      workspaceColors: new Map(),
    });
    expect(report).toMatchObject({
      counts: { total: 1, completed: 1 },
      pending: 0,
      progress: 100,
      chart: null,
      estimates: null,
      estimateChart: null,
    });
    expect(report.priorities).toHaveLength(5);
  });
});

describe("buildBurnChart day limit", () => {
  const scopeTasks = [task({ id: "1" })];

  it("charts ranges up to the limit, inclusive", () => {
    const chart = buildBurnChart({
      startDate: "2026-01-01",
      endDate: "2027-01-01",
      today: "2026-01-01",
      scopeTasks,
      maxDays: 366,
    });
    expect(chart?.days).toHaveLength(366);
    expect(chart?.days.at(-1)).toMatchObject({ date: "2027-01-01", ideal: 0 });
  });

  it("returns null past the limit", () => {
    expect(
      buildBurnChart({
        startDate: "2026-01-01",
        endDate: "2027-01-02",
        today: "2026-01-01",
        scopeTasks,
        maxDays: 366,
      }),
    ).toBeNull();
  });

  it("passes the limit through the report", () => {
    const report = buildProgressReport({
      startDate: "2026-01-01",
      endDate: "2026-01-03",
      today: "2026-01-02",
      maxChartDays: 2,
      tasks: scopeTasks,
      assignees: new Map(),
      labels: [],
      workspaceColors: new Map(),
    });
    expect(report.chart).toBeNull();
    expect(report.counts.total).toBe(1);
  });
});
