import { describe, expect, it } from "vitest";
import { bucketLabel } from "./labels";
import { nextSort, sortBucketsByValue, sortTableRows } from "./sort";
import {
  applyTableSort,
  breakdownTableModel,
  chartTableModel,
  entityTableModel,
  segmentColumnId,
  trendTableModel,
} from "./table-model";
import { makeChartResult } from "./test-fixtures";

const t = (key: string) => key;

function labelOfResult(result: ReturnType<typeof makeChartResult>) {
  return (dimension: Parameters<typeof bucketLabel>[0], key: string) =>
    bucketLabel(dimension, key, { t, meta: result.meta });
}

describe("chartTableModel", () => {
  it("has the x label, the metric, one column per segment and progress by group", () => {
    const result = makeChartResult();
    const model = chartTableModel(result, {
      t,
      dimensionLabel: "Assignee",
      metricLabel: "Tasks",
      labelOf: labelOfResult(result),
    });
    expect(model.columns.map((column) => column.id)).toEqual([
      "name",
      "value",
      segmentColumnId("backlog"),
      segmentColumnId("unstarted"),
      segmentColumnId("started"),
      segmentColumnId("completed"),
      segmentColumnId("cancelled"),
      "progress",
    ]);
    expect(model.rows[0].cells).toMatchObject({
      name: "Mia",
      value: 4,
      [segmentColumnId("unstarted")]: 2,
      [segmentColumnId("started")]: 0,
      progress: 25,
    });
    expect(model.rows[2].cells.name).toBe("analytics:none.assignee");
  });

  it("totals with the distinct numbers, not the sum of the rows", () => {
    const result = makeChartResult();
    const model = chartTableModel(result, {
      t,
      dimensionLabel: "Assignee",
      metricLabel: "Tasks",
      labelOf: labelOfResult(result),
    });
    const rowSum = model.rows.reduce(
      (sum, row) => sum + Number(row.cells.value),
      0,
    );
    expect(rowSum).toBe(9);
    expect(model.total?.cells.value).toBe(8);
    expect(model.total?.cells[segmentColumnId("completed")]).toBe(3);
    expect(model.total?.cells.progress).toBe(43);
  });

  it("adds a Tasks column for points and drops progress without a group segment", () => {
    const result = makeChartResult({
      metric: "estimatePoints",
      segment: null,
      segments: [],
      totalValue: 18,
    });
    const model = chartTableModel(result, {
      t,
      dimensionLabel: "Assignee",
      metricLabel: "Estimate points",
      labelOf: labelOfResult(result),
    });
    expect(model.columns.map((column) => column.id)).toEqual([
      "name",
      "value",
      "taskCount",
    ]);
    expect(model.total?.cells).toMatchObject({ value: 18, taskCount: 8 });
  });

  it("exports date buckets as a period start and end", () => {
    const result = makeChartResult({
      xAxis: "completedAt",
      segment: null,
      segments: [],
      dateBucket: "week",
      buckets: [
        {
          key: "2026-03-09",
          value: 1,
          taskCount: 1,
          progress: null,
          rangeStart: "2026-03-09",
          rangeEnd: "2026-03-15",
        },
        { key: "none", value: 5, taskCount: 5, progress: null },
      ],
    });
    const model = chartTableModel(result, {
      t,
      dimensionLabel: "Completed date",
      metricLabel: "Tasks",
      labelOf: labelOfResult(result),
    });
    expect(model.columns.map((column) => column.id)).toEqual([
      "periodStart",
      "periodEnd",
      "value",
    ]);
    expect(model.rows[0].cells).toMatchObject({
      periodStart: "2026-03-09",
      periodEnd: "2026-03-15",
    });
    expect(model.rows[1].cells).toMatchObject({
      periodStart: "analytics:none.completedAt",
      periodEnd: null,
    });
  });

  it("follows the given bucket order (sort by value)", () => {
    const result = makeChartResult();
    const buckets = sortBucketsByValue([...result.buckets].reverse());
    const model = chartTableModel(result, {
      t,
      dimensionLabel: "Assignee",
      metricLabel: "Tasks",
      labelOf: labelOfResult(result),
      buckets,
    });
    expect(model.rows.map((row) => row.key)).toEqual(["m1", "m2", "none"]);
  });
});

describe("breakdownTableModel", () => {
  it("has every group column, the total and progress", () => {
    const result = makeChartResult();
    const model = breakdownTableModel(result, {
      t,
      dimensionLabel: "Assignee",
      labelOf: labelOfResult(result),
    });
    expect(model.columns.map((column) => column.id)).toEqual([
      "name",
      segmentColumnId("backlog"),
      segmentColumnId("unstarted"),
      segmentColumnId("started"),
      segmentColumnId("completed"),
      segmentColumnId("cancelled"),
      "value",
      "progress",
    ]);
    expect(model.total?.cells.value).toBe(8);
  });
});

describe("trendTableModel", () => {
  it("lists periods with their clipped ranges and the range totals", () => {
    const model = trendTableModel(
      {
        from: "2026-03-01",
        to: "2026-03-31",
        bucket: "week",
        metric: "taskCount",
        today: "2026-03-25",
        series: [
          {
            start: "2026-02-23",
            rangeStart: "2026-03-01",
            rangeEnd: "2026-03-01",
            created: 0,
            completed: 0,
          },
          {
            start: "2026-03-02",
            rangeStart: "2026-03-02",
            rangeEnd: "2026-03-08",
            created: 5,
            completed: 0,
          },
        ],
        totals: { created: 5, completed: 0, net: 5 },
        pointsProjectIds: [],
      },
      { created: "Created", completed: "Completed" },
      t,
    );
    expect(model.rows[0].cells).toMatchObject({
      periodStart: "2026-03-01",
      periodEnd: "2026-03-01",
      created: 0,
    });
    expect(model.total?.cells).toMatchObject({ created: 5, completed: 0 });
  });
});

describe("sorting", () => {
  it("sorts buckets by value with ties in natural order and none last", () => {
    const sorted = sortBucketsByValue([
      { key: "none", value: 9 },
      { key: "a", value: 1 },
      { key: "b", value: 3 },
      { key: "c", value: 3 },
      { key: "other", value: 5 },
    ]);
    expect(sorted.map((bucket) => bucket.key)).toEqual([
      "b",
      "c",
      "a",
      "other",
      "none",
    ]);
  });

  it("sorts table rows with empty cells last in both directions", () => {
    const model = entityTableModel(
      [
        { id: "x", v: 2 as number | null },
        { id: "y", v: null },
        { id: "z", v: 5 },
      ],
      [{ id: "v", label: "V", kind: "number", value: (item) => item.v }],
    );
    const ids = (direction: "asc" | "desc") =>
      sortTableRows(model.rows, { columnId: "v", direction }).map(
        (row) => row.id,
      );
    expect(ids("asc")).toEqual(["x", "z", "y"]);
    expect(ids("desc")).toEqual(["z", "x", "y"]);
    expect(applyTableSort(model, null).rows.map((row) => row.id)).toEqual([
      "x",
      "y",
      "z",
    ]);
  });

  it("cycles header sorts: numbers descending first, then ascending, then off", () => {
    const first = nextSort(null, "v", true);
    expect(first).toEqual({ columnId: "v", direction: "desc" });
    const second = nextSort(first, "v", true);
    expect(second).toEqual({ columnId: "v", direction: "asc" });
    expect(nextSort(second, "v", true)).toBeNull();
    expect(nextSort(null, "name", false)).toEqual({
      columnId: "name",
      direction: "asc",
    });
  });
});
