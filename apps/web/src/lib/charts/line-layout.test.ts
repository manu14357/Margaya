import { describe, expect, it } from "vitest";
import { buildLineLayout, nudgeLabels } from "./line-layout";

const plot = { x: 0, y: 0, width: 100, height: 100 };

describe("buildLineLayout", () => {
  it("splits a path into separate runs at nulls", () => {
    const layout = buildLineLayout({
      count: 5,
      series: [{ key: "a", values: [1, 2, null, 3, 4] }],
      plot,
      valueMax: 4,
    });
    const [line] = layout.series;
    expect(line.path).toBe("M0 75L25 50M75 25L100 0");
    expect(line.points[2]).toBeNull();
    expect(line.points[3]).toEqual({ index: 3, x: 75, y: 25, value: 3 });
    expect(line.end).toMatchObject({ index: 4, value: 4 });
  });

  it("reports points with no neighbors, which a path cannot show", () => {
    const layout = buildLineLayout({
      count: 4,
      series: [{ key: "a", values: [null, 2, null, 1] }],
      plot,
      valueMax: 2,
    });
    expect(layout.series[0].isolated.map((point) => point.index)).toEqual([
      1, 3,
    ]);
    expect(layout.series[0].end?.index).toBe(3);
  });

  it("ends a line at its last value", () => {
    const layout = buildLineLayout({
      count: 3,
      series: [
        { key: "a", values: [1, 2, null] },
        { key: "b", values: [null, null, null] },
      ],
      plot,
      valueMax: 2,
    });
    expect(layout.series[0].end?.index).toBe(1);
    expect(layout.series[1].end).toBeNull();
    expect(layout.series[1].path).toBe("");
  });

  it("places a crosshair and a hover slot at every position", () => {
    const layout = buildLineLayout({
      count: 5,
      series: [{ key: "a", values: [0, 0, 0, 0, 0] }],
      plot,
      valueMax: 1,
    });
    expect(layout.positions).toEqual([0, 25, 50, 75, 100]);
    expect(layout.hits[0]).toEqual({ x: 0, width: 12.5 });
    expect(layout.hits[2]).toEqual({ x: 37.5, width: 25 });
    expect(layout.hits[4]).toEqual({ x: 87.5, width: 12.5 });
  });

  it("centers a single position", () => {
    const layout = buildLineLayout({
      count: 1,
      series: [{ key: "a", values: [3] }],
      plot,
      valueMax: 3,
    });
    expect(layout.positions).toEqual([50]);
    expect(layout.hits[0]).toEqual({ x: 0, width: 100 });
  });
});

describe("nudgeLabels", () => {
  it("leaves labels that are far enough apart", () => {
    expect(nudgeLabels([10, 40, 80])).toEqual([10, 40, 80]);
  });

  it("pushes close labels apart and keeps the input order", () => {
    expect(nudgeLabels([50, 55])).toEqual([50, 62]);
    expect(nudgeLabels([55, 50])).toEqual([62, 50]);
    expect(nudgeLabels([50, 50, 50])).toEqual([50, 62, 74]);
  });

  it("stays inside the bounds by pushing back up", () => {
    expect(nudgeLabels([95, 98], { max: 100 })).toEqual([88, 100]);
    expect(nudgeLabels([-5, 20], { min: 0 })).toEqual([0, 20]);
  });
});
