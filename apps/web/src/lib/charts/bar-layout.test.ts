import { describe, expect, it } from "vitest";
import {
  type BarLayoutDatum,
  barDomainMax,
  barTotal,
  buildBarLayout,
  highestBar,
  labelStride,
  roundedBarPath,
  visibleLabelIndexes,
} from "./bar-layout";

const square = { x: 0, y: 0, width: 100, height: 100 };

describe("buildBarLayout: vertical", () => {
  const layout = buildBarLayout({
    data: [
      { key: "a", value: 4 },
      { key: "b", value: 2 },
    ],
    seriesKeys: ["value"],
    stacked: false,
    orientation: "vertical",
    plot: square,
    valueMax: 4,
  });

  it("centers capped bars in their slots and grows them from the baseline", () => {
    expect(layout.step).toBe(50);
    expect(layout.thickness).toBe(24);
    const [a, b] = layout.bands;
    expect(a.segments[0]).toMatchObject({
      x: 13,
      y: 0,
      width: 24,
      height: 100,
    });
    expect(b.segments[0]).toMatchObject({
      x: 63,
      y: 50,
      width: 24,
      height: 50,
    });
    expect(a.end).toBe(0);
    expect(b.end).toBe(50);
  });

  it("gives every band a hit target covering its whole slot", () => {
    expect(layout.bands[1].hit).toEqual({
      x: 50,
      y: 0,
      width: 50,
      height: 100,
    });
    expect(layout.bands[1].center).toBe(75);
  });

  it("rounds only the top of a plain bar", () => {
    expect(layout.bands[0].segments[0].path).toBe(
      "M13 100V4A4 4 0 0 1 17 0H33A4 4 0 0 1 37 4V100Z",
    );
  });
});

describe("buildBarLayout: horizontal", () => {
  const layout = buildBarLayout({
    data: [
      { key: "a", value: 4 },
      { key: "b", value: 2 },
    ],
    seriesKeys: ["value"],
    stacked: false,
    orientation: "horizontal",
    plot: { x: 100, y: 0, width: 200, height: 56 },
    valueMax: 4,
    maxThickness: 16,
  });

  it("lays rows top to bottom with bars growing right", () => {
    expect(layout.step).toBe(28);
    const [a, b] = layout.bands;
    expect(a.segments[0]).toMatchObject({
      x: 100,
      y: 6,
      width: 200,
      height: 16,
    });
    expect(b.segments[0]).toMatchObject({
      x: 100,
      y: 34,
      width: 100,
      height: 16,
    });
    expect(b.end).toBe(200);
    expect(b.hit).toEqual({ x: 100, y: 28, width: 200, height: 28 });
  });

  it("rounds only the right end", () => {
    expect(layout.bands[1].segments[0].path).toBe(
      "M100 34H196A4 4 0 0 1 200 38V46A4 4 0 0 1 196 50H100Z",
    );
  });
});

describe("buildBarLayout: stacked", () => {
  const layout = buildBarLayout({
    data: [
      { key: "x", value: 3, cells: { a: 2, b: 1, c: 1 } },
      { key: "y", value: 2, cells: { a: 2, c: 2 } },
    ],
    seriesKeys: ["a", "b", "c"],
    stacked: true,
    orientation: "vertical",
    plot: square,
    valueMax: 4,
  });

  it("stacks from the baseline up in legend order with 2 px gaps", () => {
    const [a, b, c] = layout.bands[0].segments;
    expect([a.seriesKey, b.seriesKey, c.seriesKey]).toEqual(["a", "b", "c"]);
    expect(a).toMatchObject({ y: 51, height: 49 });
    expect(b).toMatchObject({ y: 26, height: 23 });
    expect(c).toMatchObject({ y: 0, height: 24 });
    expect(a.y - (b.y + b.height)).toBe(2);
    expect(b.y - (c.y + c.height)).toBe(2);
    expect(a.y + a.height).toBe(100);
  });

  it("rounds only the outermost segment", () => {
    const segments = layout.bands[0].segments;
    expect(segments.map((segment) => segment.rounded)).toEqual([
      false,
      false,
      true,
    ]);
    expect(segments[0].path).not.toContain("A");
    expect(segments[1].path).not.toContain("A");
    expect(segments[2].path).toContain("A");
  });

  it("skips empty cells and draws the sum of the cells", () => {
    const band = layout.bands[1];
    expect(band.segments.map((segment) => segment.seriesKey)).toEqual([
      "a",
      "c",
    ]);
    // Many-valued segments: the stack (4) can exceed the distinct value (2).
    expect(band.value).toBe(2);
    expect(band.total).toBe(4);
    expect(band.end).toBe(0);
  });
});

describe("zero values", () => {
  it("draw no bar but keep their band", () => {
    const layout = buildBarLayout({
      data: [
        { key: "a", value: 0 },
        { key: "b", value: 3 },
      ],
      seriesKeys: ["value"],
      stacked: false,
      orientation: "vertical",
      plot: square,
      valueMax: 3,
    });
    expect(layout.bands).toHaveLength(2);
    expect(layout.bands[0].segments).toEqual([]);
    expect(layout.bands[0].hit.width).toBe(50);
    expect(layout.bands[0].end).toBe(100);
  });

  it("still show a sliver for a tiny value", () => {
    const layout = buildBarLayout({
      data: [{ key: "a", value: 1 }],
      seriesKeys: ["value"],
      stacked: false,
      orientation: "vertical",
      plot: square,
      valueMax: 10_000,
    });
    expect(layout.bands[0].segments[0].height).toBe(1);
  });
});

describe("helpers", () => {
  const data: BarLayoutDatum[] = [
    { key: "a", value: 3, cells: { x: 2, y: 2 } },
    { key: "b", value: 5, cells: { x: 1 } },
    { key: "c", value: 5 },
  ];

  it("measures plain and stacked totals", () => {
    expect(barTotal(data[0], ["x", "y"], true)).toBe(4);
    expect(barTotal(data[0], ["x", "y"], false)).toBe(3);
    expect(barTotal(data[2], ["x", "y"], true)).toBe(0);
    expect(barDomainMax(data, ["x", "y"], true)).toBe(4);
    expect(barDomainMax(data, ["x", "y"], false)).toBe(5);
  });

  it("finds the highest bucket, first on a tie", () => {
    expect(highestBar(data)?.key).toBe("b");
    expect(highestBar([])).toBeNull();
  });

  it("returns no path for an empty rectangle", () => {
    expect(roundedBarPath(0, 0, 0, 10, "vertical")).toBe("");
  });
});

describe("label thinning", () => {
  it("shows every label when there is room", () => {
    expect(labelStride(60, 40)).toBe(1);
    expect(visibleLabelIndexes(3, 1)).toEqual([0, 1, 2]);
  });

  it("shows every k-th label when bands are narrow", () => {
    expect(labelStride(10, 40)).toBe(5);
    expect(visibleLabelIndexes(23, 5)).toEqual([0, 5, 10, 15, 20]);
  });

  it("never lets shown labels overlap", () => {
    for (const step of [3, 7.5, 12, 19, 33]) {
      for (const width of [20, 48, 64, 90]) {
        const indexes = visibleLabelIndexes(60, labelStride(step, width));
        for (let index = 1; index < indexes.length; index += 1) {
          const distance = (indexes[index] - indexes[index - 1]) * step;
          expect(distance).toBeGreaterThanOrEqual(width + 4);
        }
      }
    }
  });
});
