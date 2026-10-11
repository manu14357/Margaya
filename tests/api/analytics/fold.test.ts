import { describe, expect, it } from "vitest";
import {
  type ChartAggregate,
  foldSegments,
  shapeChart,
  type Tally,
  topByValue,
} from "../../../apps/api/src/analytics/fold";
import { fakeLookup } from "./lookup";

const tally = (value: number, taskCount = value): Tally => ({
  value,
  taskCount,
});

function aggregate({
  buckets = {},
  segments = {},
  cells = {},
  total = tally(0),
}: {
  buckets?: Record<string, Tally>;
  segments?: Record<string, Tally>;
  cells?: Record<string, Record<string, number>>;
  total?: Tally;
}): ChartAggregate {
  return {
    buckets: new Map(Object.entries(buckets)),
    segments: new Map(Object.entries(segments)),
    cells: new Map(
      Object.entries(cells).map(([key, row]) => [
        key,
        new Map(Object.entries(row)),
      ]),
    ),
    total,
  };
}

const base = {
  segment: null,
  includeNone: true,
  dateBucket: "month" as const,
  lookup: fakeLookup(),
};

describe("topByValue", () => {
  it("keeps the largest values, ties in natural order, in natural order", () => {
    const values: Record<string, number> = { a: 1, b: 3, c: 1, d: 3, e: 2 };
    expect(
      topByValue(["a", "b", "c", "d", "e"], (k) => values[k] ?? 0, 3),
    ).toEqual({ kept: ["b", "d", "e"], hidden: 2 });
    expect(
      topByValue(["a", "b", "c", "d", "e"], (k) => values[k] ?? 0, 4),
    ).toEqual({ kept: ["a", "b", "d", "e"], hidden: 1 });
    expect(topByValue(["a", "b"], () => 0, 5)).toEqual({
      kept: ["a", "b"],
      hidden: 0,
    });
  });
});

describe("foldSegments", () => {
  it("folds all but the top five into other and never folds none", () => {
    const totals = new Map(
      ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "none"].map((key, index) => [
        key,
        tally(10 - index),
      ]),
    );
    const folded = foldSegments([...totals.keys()], totals, 5);
    expect(folded.keys).toEqual([
      "s1",
      "s2",
      "s3",
      "s4",
      "s5",
      "other",
      "none",
    ]);
    // s6 (5) and s7 (4) fold; none (3) stays.
    expect(folded.totals.get("other")).toEqual(tally(5 + 4));
    expect(folded.target.get("s6")).toBe("other");
    expect(folded.target.get("none")).toBe("none");
    expect(folded.hidden).toBe(2);
  });

  it("never folds without a cap", () => {
    const totals = new Map(
      ["a", "b", "c", "d", "e", "f"].map((k) => [k, tally(1)]),
    );
    expect(foldSegments([...totals.keys()], totals, null)).toMatchObject({
      keys: ["a", "b", "c", "d", "e", "f"],
      hidden: 0,
    });
  });
});

describe("shapeChart", () => {
  it("truncates nominal buckets to 50 and restores natural order", () => {
    const buckets: Record<string, Tally> = {};
    for (let index = 0; index < 60; index++) {
      buckets[`name:L${String(index).padStart(2, "0")}`] = tally(
        index >= 55 ? 5 : 1,
      );
    }
    buckets.none = tally(9);
    const shaped = shapeChart(aggregate({ buckets, total: tally(70) }), {
      ...base,
      xAxis: "label",
    });
    expect(shaped.buckets).toHaveLength(50);
    expect(shaped.truncated).toEqual({
      x: true,
      hiddenXCount: 11,
      segment: false,
      hiddenSegmentCount: 0,
    });
    // none ranks first by value, so it is kept, and stays last.
    expect(shaped.buckets.at(-1)?.key).toBe("none");
    expect(shaped.buckets[0]?.key).toBe("name:L00");
    expect(shaped.buckets.at(-2)?.key).toBe("name:L59");
  });

  it("drops the none bucket and segment on request and reports its count", () => {
    const shaped = shapeChart(
      aggregate({
        buckets: { "name:A": tally(2), none: tally(5) },
        segments: { u1: tally(3), none: tally(4) },
        cells: { "name:A": { u1: 2 }, none: { u1: 1, none: 4 } },
        total: tally(7),
      }),
      { ...base, xAxis: "label", segment: "assignee", includeNone: false },
    );
    expect(shaped.buckets.map((b) => b.key)).toEqual(["name:A"]);
    expect(shaped.segments.map((s) => s.key)).toEqual(["u1"]);
    expect(shaped.noneCount).toBe(5);
  });

  it("never folds group segments and computes D11 progress per bucket", () => {
    const shaped = shapeChart(
      aggregate({
        buckets: { a: tally(4), b: tally(2), c: tally(0) },
        segments: {
          backlog: tally(1),
          unstarted: tally(1),
          started: tally(1),
          completed: tally(2),
          cancelled: tally(3),
        },
        cells: {
          a: { backlog: 1, completed: 2, cancelled: 1 },
          b: { cancelled: 2 },
        },
        total: tally(8),
      }),
      { ...base, xAxis: "priority", segment: "group" },
    );
    expect(shaped.segments).toHaveLength(5);
    expect(shaped.truncated.segment).toBe(false);
    const progress = Object.fromEntries(
      shaped.buckets.map((b) => [b.key, b.progress]),
    );
    // a: 2 ÷ (4 − 1); b: all cancelled → 100; c: nothing → 0.
    expect(progress).toEqual({ a: 67, b: 100, c: 0 });
    // Whole set: 2 ÷ (8 − 3).
    expect(shaped.progress).toBe(40);
  });

  it("uses points for progress and rounds sums to two decimals", () => {
    const shaped = shapeChart(
      aggregate({
        buckets: {
          completed: tally(0.1 + 0.2, 2),
          cancelled: tally(5, 1),
          started: tally(2.7, 1),
        },
        total: tally(8, 4),
      }),
      { ...base, xAxis: "group" },
    );
    expect(shaped.buckets.find((b) => b.key === "completed")?.value).toBe(0.3);
    // 0.3 ÷ (8 − 5) = 10%.
    expect(shaped.progress).toBe(10);
    expect(shaped.buckets.every((b) => b.progress === null)).toBe(true);
  });

  it("zero-fills date buckets and keeps none last", () => {
    const shaped = shapeChart(
      aggregate({
        buckets: {
          "2026-03-23": tally(1),
          none: tally(2),
          "2026-03-09": tally(1),
        },
        total: tally(4),
      }),
      { ...base, xAxis: "completedAt", dateBucket: "week" },
    );
    expect(shaped.buckets.map((b) => [b.key, b.value])).toEqual([
      ["2026-03-09", 1],
      ["2026-03-16", 0],
      ["2026-03-23", 1],
      ["none", 2],
    ]);
    expect(shaped.buckets[1]).toMatchObject({
      rangeStart: "2026-03-16",
      rangeEnd: "2026-03-22",
    });
    expect(shaped.buckets[3]?.rangeStart).toBeUndefined();
  });

  it("sums folded cells into other and omits zero cells", () => {
    const segments: Record<string, Tally> = {};
    const cells: Record<string, number> = {};
    for (let index = 0; index < 7; index++) {
      segments[`u${index}`] = tally(7 - index);
      cells[`u${index}`] = 1;
    }
    const shaped = shapeChart(
      aggregate({
        buckets: { high: tally(3), low: tally(1) },
        segments,
        cells: { high: cells, low: { u0: 1 } },
        total: tally(4),
      }),
      {
        ...base,
        xAxis: "priority",
        segment: "assignee",
        lookup: fakeLookup({
          users: Array.from({ length: 7 }, (_, index) => ({
            id: `u${index}`,
            name: `User ${index}`,
          })),
        }),
      },
    );
    const high = shaped.buckets.find((b) => b.key === "high");
    expect(high?.cells).toEqual({
      u0: 1,
      u1: 1,
      u2: 1,
      u3: 1,
      u4: 1,
      other: 2,
    });
    expect(shaped.buckets.find((b) => b.key === "low")?.cells).toEqual({
      u0: 1,
    });
    expect(shaped.segments.at(-1)).toEqual({
      key: "other",
      value: 3,
      taskCount: 3,
    });
  });
});
