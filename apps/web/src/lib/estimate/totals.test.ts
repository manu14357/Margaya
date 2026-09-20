import { describe, expect, it } from "vitest";
import { computeEstimateTotals, getEstimateValueMap } from "./totals";

const columns = [
  { slug: "ideas", group: "backlog" },
  { slug: "to-do", group: "unstarted" },
  { slug: "doing", group: "started" },
  { slug: "done", group: "completed", isFinal: true },
  { slug: "dropped", group: "cancelled", isFinal: true },
  { slug: "inbox", group: "triage" },
];

const points = {
  id: "estimate-1",
  type: "points" as const,
  points: [
    { id: "p1", value: "1", numericValue: 1, position: 1 },
    { id: "p2", value: "2.5", numericValue: 2.5, position: 2 },
    { id: "p3", value: "5", numericValue: 5, position: 3 },
  ],
};

const tasks = [
  { status: "planned", estimatePointId: "p1" }, // backlog
  { status: "ideas", estimatePointId: null }, // backlog, unestimated
  { status: "to-do", estimatePointId: "p2" },
  { status: "doing", estimatePointId: "p2" },
  { status: "done", estimatePointId: "p3" },
  { status: "done", estimatePointId: "p1" },
  { status: "done", estimatePointId: "gone" }, // unknown point: no estimate
  { status: "dropped", estimatePointId: "p3" },
  { status: "archived", estimatePointId: "p3" }, // not visible
  { status: "inbox", estimatePointId: "p3" }, // triage: not visible
];

describe("computeEstimateTotals", () => {
  it("totals visible tasks by group, point and completion", () => {
    const totals = computeEstimateTotals(tasks, points, columns, true);
    expect(totals).toMatchObject({
      enabled: true,
      estimateId: "estimate-1",
      type: "points",
      isNumeric: true,
      taskCount: 8,
      estimatedTaskCount: 6,
      completedTaskCount: 3,
      completedEstimatedTaskCount: 2,
      total: 17,
      completed: 6,
    });
    expect(totals.byGroup).toEqual({
      backlog: { taskCount: 2, estimatedTaskCount: 1, total: 1 },
      unstarted: { taskCount: 1, estimatedTaskCount: 1, total: 2.5 },
      started: { taskCount: 1, estimatedTaskCount: 1, total: 2.5 },
      completed: { taskCount: 3, estimatedTaskCount: 2, total: 6 },
      cancelled: { taskCount: 1, estimatedTaskCount: 1, total: 5 },
    });
    expect(totals.distribution).toEqual([
      {
        pointId: "p1",
        value: "1",
        position: 1,
        taskCount: 2,
        completedTaskCount: 1,
      },
      {
        pointId: "p2",
        value: "2.5",
        position: 2,
        taskCount: 2,
        completedTaskCount: 0,
      },
      {
        pointId: "p3",
        value: "5",
        position: 3,
        taskCount: 2,
        completedTaskCount: 1,
      },
    ]);
  });

  it("rounds sums to 2 decimals", () => {
    const thirds = {
      ...points,
      points: [{ id: "p", value: "0.33", numericValue: 0.33, position: 1 }],
    };
    const totals = computeEstimateTotals(
      [
        { status: "to-do", estimatePointId: "p" },
        { status: "to-do", estimatePointId: "p" },
        { status: "to-do", estimatePointId: "p" },
      ],
      thirds,
      columns,
      true,
    );
    expect(totals.total).toBe(0.99);
  });

  it("has no sums for categories", () => {
    const sizes = {
      id: "estimate-2",
      type: "categories" as const,
      points: [
        { id: "s", value: "S", numericValue: null, position: 1 },
        { id: "l", value: "L", numericValue: null, position: 2 },
      ],
    };
    const totals = computeEstimateTotals(
      [{ status: "done", estimatePointId: "l" }],
      sizes,
      columns,
      true,
    );
    expect(totals).toMatchObject({
      isNumeric: false,
      total: null,
      completed: null,
      estimatedTaskCount: 1,
    });
    expect(totals.byGroup.completed.total).toBeNull();
  });

  it("is disabled while the feature is off or no system is active", () => {
    for (const totals of [
      computeEstimateTotals(tasks, points, columns, false),
      computeEstimateTotals(tasks, null, columns, true),
    ]) {
      expect(totals).toMatchObject({
        enabled: false,
        estimateId: null,
        type: null,
        taskCount: 0,
        total: null,
        distribution: [],
      });
    }
  });
});

describe("getEstimateValueMap", () => {
  it("maps point ids to value, number and position", () => {
    expect(getEstimateValueMap(points).get("p2")).toEqual({
      value: "2.5",
      numericValue: 2.5,
      position: 2,
    });
    expect(getEstimateValueMap(null).size).toBe(0);
  });
});
