import { describe, expect, it } from "vitest";
import {
  dashPattern,
  ellipseOps,
  hatchFill,
  pathOpsToSvg,
  seededRandom,
  sketchCurve,
  sketchDiamond,
  sketchEllipse,
  sketchLine,
  sketchPolygon,
  sketchRect,
} from "../src/render/sketch.js";
import type { PathOp } from "../src/render/types.js";

function allFinite(ops: readonly PathOp[]): boolean {
  return ops.every((op) =>
    op.slice(1).every((value) => Number.isFinite(value)),
  );
}

describe("seededRandom", () => {
  it("repeats the same sequence for a seed and stays in [0, 1)", () => {
    const a = seededRandom(42);
    const b = seededRandom(42);
    const first = Array.from({ length: 200 }, a);
    expect(Array.from({ length: 200 }, b)).toEqual(first);
    expect(first.every((value) => value >= 0 && value < 1)).toBe(true);
    const other = Array.from({ length: 200 }, seededRandom(43));
    expect(other).not.toEqual(first);
  });

  it("handles a zero seed", () => {
    const random = seededRandom(0);
    const values = new Set(Array.from({ length: 50 }, random));
    expect(values.size).toBeGreaterThan(40);
  });
});

describe("sketch generators", () => {
  const shapes: [string, (seed: number, level: number) => PathOp[]][] = [
    ["line", (seed, level) => sketchLine(0, 0, 100, 50, { seed, level })],
    ["rect", (seed, level) => sketchRect(0, 0, 100, 50, { seed, level })],
    [
      "rounded rect",
      (seed, level) => sketchRect(0, 0, 100, 50, { seed, level, radius: 12 }),
    ],
    [
      "ellipse",
      (seed, level) => sketchEllipse(50, 25, 50, 25, { seed, level }),
    ],
    [
      "diamond",
      (seed, level) => sketchDiamond(0, 0, 100, 60, { seed, level, radius: 6 }),
    ],
    [
      "curve",
      (seed, level) =>
        sketchCurve(
          [
            [0, 0],
            [40, 30],
            [90, 10],
          ],
          { seed, level },
        ),
    ],
  ];

  for (const [name, draw] of shapes) {
    it(`${name}: is deterministic per seed and varies across seeds`, () => {
      for (const level of [1, 2]) {
        const one = draw(7, level);
        expect(draw(7, level)).toEqual(one);
        expect(draw(8, level)).not.toEqual(one);
        expect(allFinite(one)).toBe(true);
      }
    });
  }

  it("draws two passes at level 1 and one when single", () => {
    const doubled = sketchLine(0, 0, 100, 0, { seed: 1, level: 1 });
    const single = sketchLine(0, 0, 100, 0, {
      seed: 1,
      level: 1,
      single: true,
    });
    expect(doubled.filter((op) => op[0] === "M")).toHaveLength(2);
    expect(single.filter((op) => op[0] === "M")).toHaveLength(1);
  });

  it("wobbles more at level 2 than at level 1, within a few units", () => {
    const deviation = (level: number) => {
      let max = 0;
      for (let seed = 0; seed < 30; seed++) {
        for (const op of sketchLine(0, 0, 200, 0, { seed, level })) {
          if (op[0] === "M") max = Math.max(max, Math.abs(op[2]));
          if (op[0] === "C")
            max = Math.max(
              max,
              Math.abs(op[2]),
              Math.abs(op[4]),
              Math.abs(op[6]),
            );
        }
      }
      return max;
    };
    const light = deviation(1);
    const heavy = deviation(2);
    expect(light).toBeGreaterThan(0);
    expect(heavy).toBeGreaterThan(light);
    expect(heavy).toBeLessThan(10);
  });
});

describe("level 0 is exact geometry", () => {
  it("line", () => {
    expect(sketchLine(1, 2, 30, 40, { seed: 9, level: 0 })).toEqual([
      ["M", 1, 2],
      ["L", 30, 40],
    ]);
  });

  it("rectangle", () => {
    expect(sketchRect(10, 20, 100, 50, { seed: 9, level: 0 })).toEqual([
      ["M", 10, 20],
      ["L", 110, 20],
      ["L", 110, 70],
      ["L", 10, 70],
      ["Z"],
    ]);
  });

  it("polygon ignores the seed", () => {
    const points = [
      [0, 0],
      [10, 0],
      [5, 8],
    ] as const;
    expect(sketchPolygon(points, { seed: 1, level: 0 })).toEqual(
      sketchPolygon(points, { seed: 99, level: 0 }),
    );
    expect(sketchPolygon(points, { seed: 1, level: 0 })).toEqual([
      ["M", 0, 0],
      ["L", 10, 0],
      ["L", 5, 8],
      ["Z"],
    ]);
  });

  it("ellipse passes through its four extreme points", () => {
    const ops = sketchEllipse(50, 40, 30, 20, { seed: 3, level: 0 });
    expect(ops).toEqual(ellipseOps(50, 40, 30, 20));
    const ends = ops
      .filter((op) => op[0] === "C" || op[0] === "M")
      .map((op) => (op[0] === "C" ? [op[5], op[6]] : [op[1], op[2]]));
    expect(ends).toEqual([
      [80, 40],
      [50, 60],
      [20, 40],
      [50, 20],
      [80, 40],
    ]);
  });

  it("rounded rectangle keeps its corners inside the box", () => {
    const ops = sketchRect(0, 0, 100, 60, { seed: 1, level: 0, radius: 10 });
    expect(ops[0]).toEqual(["M", 10, 0]);
    for (const op of ops) {
      for (let index = 1; index < op.length; index += 2) {
        const x = op[index] as number;
        const y = op[index + 1] as number;
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThanOrEqual(100);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(60);
      }
    }
  });
});

describe("hatchFill", () => {
  const square = [
    [0, 0],
    [100, 0],
    [100, 100],
    [0, 100],
  ] as const;

  it("keeps every hatch line inside the polygon", () => {
    const ops = hatchFill(square, 10, Math.PI / 4);
    expect(ops.length).toBeGreaterThan(10);
    for (const op of ops) {
      if (op[0] === "Z" || op[0] === "C") continue;
      expect(op[1]).toBeGreaterThanOrEqual(-1e-6);
      expect(op[1]).toBeLessThanOrEqual(100 + 1e-6);
      expect(op[2]).toBeGreaterThanOrEqual(-1e-6);
      expect(op[2]).toBeLessThanOrEqual(100 + 1e-6);
    }
  });

  it("spaces horizontal lines by the gap", () => {
    const ops = hatchFill(square, 20, 0);
    const ys = ops.filter((op) => op[0] === "M").map((op) => op[2]);
    expect(ys).toEqual([10, 30, 50, 70, 90]);
  });

  it("skips the notch of a concave polygon", () => {
    const shape = [
      [0, 0],
      [30, 0],
      [30, 60],
      [70, 60],
      [70, 0],
      [100, 0],
      [100, 100],
      [0, 100],
    ] as const;
    const ops = hatchFill(shape, 20, 0);
    const atTen = ops.filter(
      (op) => op[0] !== "Z" && op[0] !== "C" && Math.abs(op[2] - 10) < 1e-6,
    );
    // Two separate segments (left and right prong), not one across the notch.
    expect(atTen).toHaveLength(4);
  });

  it("is deterministic when sketched", () => {
    const a = hatchFill(square, 10, 1, { seed: 5, level: 2 });
    expect(hatchFill(square, 10, 1, { seed: 5, level: 2 })).toEqual(a);
    expect(allFinite(a)).toBe(true);
  });

  it("returns nothing for degenerate input", () => {
    expect(hatchFill([[0, 0]], 10, 0)).toEqual([]);
    expect(hatchFill(square, 0, 0)).toEqual([]);
    expect(hatchFill(square, 10, Number.NaN)).toEqual([]);
  });
});

describe("helpers", () => {
  it("dash patterns", () => {
    expect(dashPattern("solid", 2)).toEqual([]);
    expect(dashPattern("dashed", 2)).toHaveLength(2);
    expect(dashPattern("dotted", 2)[0]).toBeLessThan(1);
  });

  it("formats SVG path data", () => {
    expect(
      pathOpsToSvg([
        ["M", 0, 0],
        ["L", 1.234, -0],
        ["C", 1, 2, 3, 4, 5, Number.NaN],
        ["Z"],
      ]),
    ).toBe("M0 0L1.23 0C1 2 3 4 5 0Z");
  });
});
