import { describe, expect, it } from "vitest";
import { type BurnChartDay, buildBurnChartModel } from "./burn-chart-model";

const padding = { top: 0, right: 0, bottom: 0, left: 0 };

function days(
  values: Array<[remaining: number | null, completed: number | null]>,
  scope: number,
): BurnChartDay[] {
  const n = values.length;
  return values.map(([remaining, completed], index) => ({
    date: `2026-03-${String(index + 1).padStart(2, "0")}`,
    remaining,
    completed,
    ideal: n === 1 ? scope : scope * (1 - index / (n - 1)),
  }));
}

describe("buildBurnChartModel", () => {
  it("scales days across the width and values from the bottom", () => {
    const model = buildBurnChartModel({
      days: days(
        [
          [4, 0],
          [2, 2],
          [0, 4],
        ],
        4,
      ),
      scope: 4,
      mode: "burndown",
      width: 100,
      height: 40,
      padding,
    });
    expect(model.yMax).toBe(4);
    expect(model.xFor(0)).toBe(0);
    expect(model.xFor(1)).toBe(50);
    expect(model.xFor(2)).toBe(100);
    expect(model.yFor(4)).toBe(0);
    expect(model.yFor(0)).toBe(40);
    expect(model.actualPath).toBe("M0 0 L50 20 L100 40");
    expect(model.referencePath).toBe("M0 0 L50 20 L100 40");
  });

  it("centers a single day and keeps yMax at least 1", () => {
    const model = buildBurnChartModel({
      days: days([[0, 0]], 0),
      scope: 0,
      mode: "burndown",
      width: 100,
      height: 40,
      padding,
    });
    expect(model.yMax).toBe(1);
    expect(model.xFor(0)).toBe(50);
  });

  it("starts a new path segment after each null value", () => {
    const model = buildBurnChartModel({
      days: days(
        [
          [4, 0],
          [null, null],
          [2, 2],
          [1, 3],
          [null, null],
        ],
        4,
      ),
      scope: 4,
      mode: "burndown",
      width: 400,
      height: 40,
      padding,
    });
    expect(model.actualPath).toBe("M0 0 M200 20 L300 30");
    expect(model.areaPath.match(/Z/g)).toHaveLength(2);
  });

  it("uses completed against a flat scope line in burn-up mode", () => {
    const model = buildBurnChartModel({
      days: days(
        [
          [3, 1],
          [1, 3],
        ],
        4,
      ),
      scope: 4,
      mode: "burnup",
      width: 100,
      height: 40,
      padding,
    });
    expect(model.points.map((point) => point.actual)).toEqual([1, 3]);
    expect(model.points.map((point) => point.reference)).toEqual([4, 4]);
    expect(model.referencePath).toBe("M0 0 L100 0");
  });

  it("deduplicates the y ticks", () => {
    const one = buildBurnChartModel({
      days: days([[1, 0]], 1),
      scope: 1,
      mode: "burndown",
      width: 100,
      height: 40,
    });
    expect(one.yTicks).toEqual([0, 1]);
    const nine = buildBurnChartModel({
      days: days([[9, 0]], 9),
      scope: 9,
      mode: "burndown",
      width: 100,
      height: 40,
    });
    expect(nine.yTicks).toEqual([0, 5, 9]);
  });

  it("labels every day up to seven, else first, middle and last", () => {
    const week = buildBurnChartModel({
      days: days(
        Array.from({ length: 7 }, () => [1, 0]),
        1,
      ),
      scope: 1,
      mode: "burndown",
      width: 100,
      height: 40,
    });
    expect(week.xTicks.map((tick) => tick.index)).toEqual([
      0, 1, 2, 3, 4, 5, 6,
    ]);

    const sprint = buildBurnChartModel({
      days: days(
        Array.from({ length: 14 }, () => [1, 0]),
        1,
      ),
      scope: 1,
      mode: "burndown",
      width: 100,
      height: 40,
    });
    expect(sprint.xTicks.map((tick) => tick.index)).toEqual([0, 6, 13]);
    expect(sprint.xTicks[2].date).toBe("2026-03-14");
  });

  it("finds today inside the range", () => {
    const input = {
      days: days(
        [
          [2, 0],
          [1, 1],
          [null, null],
        ],
        2,
      ),
      scope: 2,
      mode: "burndown" as const,
      width: 100,
      height: 40,
    };
    expect(
      buildBurnChartModel({ ...input, today: "2026-03-02" }).todayIndex,
    ).toBe(1);
    expect(
      buildBurnChartModel({ ...input, today: "2026-04-01" }).todayIndex,
    ).toBeNull();
  });
});
