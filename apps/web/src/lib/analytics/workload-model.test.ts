import { describe, expect, it } from "vitest";
import type {
  AnalyticsWorkload,
  AnalyticsWorkloadMember,
} from "@/types/analytics";
import {
  chartMembers,
  checkLabel,
  workloadChartModel,
  workloadTableModel,
} from "./workload-model";

const member = (
  userId: string | null,
  load: number,
  check: AnalyticsWorkloadMember["check"] = null,
): AnalyticsWorkloadMember => ({
  userId,
  tasks: load,
  points: 0,
  load,
  cells: { backlog: 0, unstarted: load, started: 0 },
  check,
});

const over = { unit: "tasks", load: 6, usual: 4, status: "over" } as const;

const workload = (
  members: AnalyticsWorkloadMember[],
  unit: AnalyticsWorkload["unit"] = "tasks",
): AnalyticsWorkload => ({
  unit,
  usualDays: 28,
  historyDays: 56,
  members,
  meta: { users: [] },
});

const t = (key: string, options?: Record<string, unknown>) =>
  options ? `${key} ${JSON.stringify(options)}` : key;
const labelOf = (_dimension: string, key: string) => `label:${key}`;

describe("chartMembers", () => {
  it("keeps the ten heaviest, then unassigned work", () => {
    const people = Array.from({ length: 12 }, (_, index) =>
      member(`u${index}`, 20 - index),
    );
    const shown = chartMembers([...people, member(null, 3)]);
    expect(shown.map((entry) => entry.userId)).toEqual([
      ...people.slice(0, 10).map((entry) => entry.userId),
      null,
    ]);
  });

  it("keeps someone over their usual past the top ten", () => {
    const people = Array.from({ length: 11 }, (_, index) =>
      member(`u${index}`, 20 - index),
    );
    const shown = chartMembers([...people, member("light", 1, over)]);
    expect(shown.at(-1)?.userId).toBe("light");
    expect(shown).toHaveLength(11);
  });

  it("drops an empty unassigned row", () => {
    expect(chartMembers([member("a", 1), member(null, 0)])).toHaveLength(1);
  });
});

describe("workloadChartModel", () => {
  it("stacks the open groups with the member's load", () => {
    const model = workloadChartModel(
      workload([member("a", 2), member(null, 1)]),
      {
        labelOf,
      },
    );
    expect(model.series.map((series) => series.key)).toEqual([
      "backlog",
      "unstarted",
      "started",
    ]);
    expect(model.data[0]).toMatchObject({ key: "a", value: 2 });
    expect(model.data[1]?.key).toBe("none");
  });
});

describe("checkLabel", () => {
  it("says it in words, in the unit it compared", () => {
    expect(checkLabel(over, t)).toContain("analytics:overview.checkOverTasks");
    expect(
      checkLabel({ unit: "points", load: 3, usual: 8, status: "ok" }, t),
    ).toContain("analytics:overview.checkOkPoints");
    expect(
      checkLabel({ unit: "tasks", load: 3, usual: null, status: "unknown" }, t),
    ).toBe("analytics:overview.checkUnknown");
  });
});

describe("workloadTableModel", () => {
  const options = { t, labelOf, metricLabel: "Tasks" };
  const columnIds = (model: ReturnType<typeof workloadTableModel>) =>
    model.columns.map((column) => column.id);

  it("lists everyone, marks who is over, and has no total", () => {
    const people = Array.from({ length: 15 }, (_, index) =>
      member(`u${index}`, 20 - index),
    );
    const model = workloadTableModel(
      workload([member("heavy", 30, over), ...people]),
      options,
    );
    expect(model.rows).toHaveLength(16);
    expect(model.total).toBeUndefined();
    expect(model.rows[0]?.alert).toEqual(["check"]);
    expect(model.rows[1]?.alert).toBeUndefined();
    expect(columnIds(model)).toContain("check");
  });

  it("leaves the comparison out without the right to see it", () => {
    const model = workloadTableModel(workload([member("a", 1)]), options);
    expect(columnIds(model)).not.toContain("check");
  });

  it("adds a task count next to points", () => {
    const model = workloadTableModel(
      workload([member("a", 1)], "points"),
      options,
    );
    expect(columnIds(model)).toContain("taskCount");
  });
});
