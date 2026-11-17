import { describe, expect, it } from "vitest";
import type { LocalPoint } from "../src/elements.js";
import {
  freehandOutline,
  laserTrailOutline,
  outlineToOps,
  outlineToPath,
} from "../src/render/freehand.js";
import { penOutlineOptions } from "../src/render/shapes.js";

const stroke: LocalPoint[] = Array.from({ length: 40 }, (_, index) => [
  index * 5,
  Math.sin(index / 4) * 20,
]);

function isClosedAndFinite(outline: readonly LocalPoint[]): boolean {
  if (outline.length < 4) return false;
  const first = outline[0] as LocalPoint;
  const last = outline[outline.length - 1] as LocalPoint;
  return (
    first[0] === last[0] &&
    first[1] === last[1] &&
    outline.every(
      (point) => Number.isFinite(point[0]) && Number.isFinite(point[1]),
    )
  );
}

function widthNear(outline: readonly LocalPoint[], x: number): number {
  const ys = outline
    .filter((point) => Math.abs(point[0] - x) < 3)
    .map((point) => point[1]);
  return ys.length ? Math.max(...ys) - Math.min(...ys) : 0;
}

describe("freehandOutline", () => {
  it("returns a closed, finite polygon with simulated pressure", () => {
    const outline = freehandOutline(stroke, [], {
      size: 8,
      simulatePressure: true,
    });
    expect(isClosedAndFinite(outline)).toBe(true);
  });

  it("returns a closed, finite polygon with real pressure", () => {
    const pressures = stroke.map((_, index) => index / (stroke.length - 1));
    const outline = freehandOutline(stroke, pressures, {
      size: 8,
      thinning: 0.7,
    });
    expect(isClosedAndFinite(outline)).toBe(true);
  });

  it("is wider where pressure is higher", () => {
    const straight: LocalPoint[] = Array.from({ length: 60 }, (_, index) => [
      index * 4,
      0,
    ]);
    const pressures = straight.map((_, index) => (index < 30 ? 0.1 : 1));
    const outline = freehandOutline(straight, pressures, {
      size: 10,
      thinning: 0.8,
      streamline: 0,
      smoothing: 0,
      taperStart: 0,
      taperEnd: 0,
    });
    expect(widthNear(outline, 180)).toBeGreaterThan(
      widthNear(outline, 60) * 1.5,
    );
  });

  it("tapers the ends", () => {
    const straight: LocalPoint[] = Array.from({ length: 80 }, (_, index) => [
      index * 4,
      0,
    ]);
    const outline = freehandOutline(
      straight,
      straight.map(() => 1),
      {
        size: 12,
        thinning: 0,
        streamline: 0,
      },
    );
    expect(widthNear(outline, 4)).toBeLessThan(widthNear(outline, 160));
  });

  it("draws a dot for a single point", () => {
    const outline = freehandOutline([[5, 5]], [], { size: 6 });
    expect(isClosedAndFinite(outline)).toBe(true);
    for (const point of outline) {
      expect(Math.hypot(point[0] - 5, point[1] - 5)).toBeLessThanOrEqual(
        3.0001,
      );
    }
  });

  it("survives empty, duplicate and non-finite input", () => {
    expect(freehandOutline([], [], { size: 4 })).toEqual([]);
    const repeated = freehandOutline(
      [
        [1, 1],
        [1, 1],
        [1, 1],
      ],
      [],
      { size: 4 },
    );
    expect(isClosedAndFinite(repeated)).toBe(true);
    const messy = freehandOutline(
      [
        [0, 0],
        [Number.NaN, 4],
        [10, 10],
        [20, Number.POSITIVE_INFINITY],
        [30, 5],
      ],
      [0.5, 0.5, Number.NaN, 0.5, 2],
      { size: Number.NaN, thinning: 5 },
    );
    expect(isClosedAndFinite(messy)).toBe(true);
  });

  it("is deterministic", () => {
    expect(freehandOutline(stroke, [], { size: 6 })).toEqual(
      freehandOutline(stroke, [], { size: 6 }),
    );
  });
});

describe("outline paths", () => {
  it("produces closed SVG path data", () => {
    const outline = freehandOutline(stroke, [], { size: 8 });
    const d = outlineToPath(outline);
    expect(d.startsWith("M")).toBe(true);
    expect(d.endsWith("Z")).toBe(true);
    expect(d).not.toMatch(/NaN|Infinity/);
    const ops = outlineToOps(outline);
    expect(ops[ops.length - 1]).toEqual(["Z"]);
  });

  it("returns nothing for too few points", () => {
    expect(outlineToPath([[0, 0]])).toBe("");
  });

  it("builds a laser trail outline", () => {
    const outline = laserTrailOutline(stroke, { size: 6 });
    expect(isClosedAndFinite(outline)).toBe(true);
  });
});

describe("pen pressure width", () => {
  const straight: LocalPoint[] = Array.from({ length: 60 }, (_, index) => [
    index * 4,
    0,
  ]);
  const options = { ...penOutlineOptions("pen", 2, false), streamline: 0 };
  const widthAt = (pressure: number) =>
    widthNear(
      freehandOutline(
        straight,
        straight.map(() => pressure),
        options,
      ),
      120,
    );

  it("follows the pen's radius formula", () => {
    // radius = size / 2 * (1 - thinning * (1 - pressure)), thinning 0.6.
    const size = options.size;
    expect(widthAt(1)).toBeCloseTo(size, 0);
    expect(widthAt(0.2) / widthAt(1)).toBeCloseTo(1 - 0.6 * 0.8, 1);
    expect(widthAt(0.5)).toBeGreaterThan(widthAt(0.2));
    expect(widthAt(1)).toBeGreaterThan(widthAt(0.5));
  });

  it("ignores pressures when they don't match the points", () => {
    const outline = freehandOutline(straight, [1, 1], options);
    const simulated = freehandOutline(straight, [], {
      ...options,
      simulatePressure: true,
    });
    expect(outline).toEqual(simulated);
  });

  it("keeps markers at one width whatever the pressure", () => {
    const marker = penOutlineOptions("marker", 2, false);
    const light = freehandOutline(
      straight,
      straight.map(() => 0.1),
      marker,
    );
    const heavy = freehandOutline(
      straight,
      straight.map(() => 1),
      marker,
    );
    expect(widthNear(light, 120)).toBeCloseTo(widthNear(heavy, 120), 5);
  });
});
