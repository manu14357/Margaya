import { describe, expect, it } from "vitest";
import {
  buildArcLayout,
  FULL_TURN,
  largestRemainderPercents,
} from "./arc-layout";

const slices = [
  { key: "a", value: 1 },
  { key: "b", value: 2 },
  { key: "c", value: 3 },
  { key: "d", value: 4 },
];

function firstPoint(path: string) {
  const match = /^M(-?[\d.]+) (-?[\d.]+)/.exec(path);
  return match ? { x: Number(match[1]), y: Number(match[2]) } : null;
}

describe("buildArcLayout", () => {
  const layout = buildArcLayout(slices, { size: 180 });

  it("uses an inner radius of 60% of the outer one", () => {
    expect(layout.outerRadius).toBe(90);
    expect(layout.innerRadius).toBe(54);
    expect(layout.total).toBe(10);
  });

  it("covers a full turn in order, clockwise from 12 o'clock", () => {
    const sweep = layout.arcs.reduce(
      (sum, arc) => sum + (arc.endAngle - arc.startAngle),
      0,
    );
    expect(sweep).toBeCloseTo(FULL_TURN, 10);
    expect(layout.arcs[0].startAngle).toBe(0);
    expect(layout.arcs[3].endAngle).toBeCloseTo(FULL_TURN, 10);
    expect(layout.arcs[0].endAngle).toBeCloseTo(FULL_TURN * 0.1, 10);
    // The first slice starts at the top, just right of center.
    const start = firstPoint(layout.arcs[0].path);
    expect(start?.x).toBeGreaterThan(90);
    expect(start?.y).toBeLessThan(1);
  });

  it("leaves a 2 px gap between neighbors", () => {
    for (let index = 1; index < layout.arcs.length; index += 1) {
      const gapAngle =
        layout.arcs[index].outerStart - layout.arcs[index - 1].outerEnd;
      expect(gapAngle * layout.outerRadius).toBeCloseTo(2, 10);
    }
  });

  it("gives whole shares that sum to 100", () => {
    expect(layout.percents).toEqual([10, 20, 30, 40]);
  });

  it("skips zero slices but keeps their share", () => {
    const withZero = buildArcLayout(
      [
        { key: "a", value: 3 },
        { key: "b", value: 0 },
        { key: "c", value: 1 },
      ],
      { size: 100 },
    );
    expect(withZero.arcs.map((arc) => arc.key)).toEqual(["a", "c"]);
    expect(withZero.arcs[1].index).toBe(2);
    expect(withZero.percents).toEqual([75, 0, 25]);
  });

  it("draws a lone slice as a full ring", () => {
    const ring = buildArcLayout(
      [
        { key: "a", value: 0 },
        { key: "b", value: 5 },
      ],
      { size: 100 },
    );
    expect(ring.arcs).toHaveLength(1);
    expect(ring.arcs[0].key).toBe("b");
    expect(ring.arcs[0].endAngle).toBe(FULL_TURN);
    expect(ring.arcs[0].path.match(/M/g)).toHaveLength(2);
    expect(ring.percents).toEqual([0, 100]);
  });

  it("draws nothing for a zero total", () => {
    const empty = buildArcLayout(
      [
        { key: "a", value: 0 },
        { key: "b", value: 0 },
      ],
      { size: 100 },
    );
    expect(empty.total).toBe(0);
    expect(empty.arcs).toEqual([]);
    expect(empty.percents).toEqual([0, 0]);
  });

  it("keeps a sliver too thin for its gaps in the legend only", () => {
    const thin = buildArcLayout(
      [
        { key: "a", value: 10_000 },
        { key: "b", value: 1 },
      ],
      { size: 100 },
    );
    expect(thin.arcs[1].path).toBe("");
    expect(thin.arcs[1].endAngle).toBeGreaterThan(thin.arcs[1].startAngle);
  });
});

describe("largestRemainderPercents", () => {
  it("hands leftover points to the largest remainders", () => {
    expect(largestRemainderPercents([1, 1, 1])).toEqual([34, 33, 33]);
    expect(largestRemainderPercents([1, 2])).toEqual([33, 67]);
    expect(largestRemainderPercents([1, 1, 1, 1, 1, 1, 1])).toEqual([
      15, 15, 14, 14, 14, 14, 14,
    ]);
  });

  it("always sums to 100 when anything is counted", () => {
    const samples = [
      [3, 7, 11],
      [1, 1, 1, 1, 1, 1],
      [5, 0, 0, 1],
      [0.5, 0.25, 2.1],
      [999, 1],
    ];
    for (const values of samples) {
      const percents = largestRemainderPercents(values);
      expect(percents.reduce((sum, value) => sum + value, 0)).toBe(100);
    }
  });

  it("is all zeros for an empty total", () => {
    expect(largestRemainderPercents([0, 0])).toEqual([0, 0]);
    expect(largestRemainderPercents([])).toEqual([]);
  });
});
