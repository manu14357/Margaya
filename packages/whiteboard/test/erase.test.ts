import { describe, expect, it } from "vitest";
import { createElement } from "../src/create.js";
import type { DrawElement, LocalPoint } from "../src/elements.js";
import {
  capsuleInterval,
  type EraserSweep,
  eraseStroke,
  splitStroke,
  sweepTouches,
} from "../src/erase.js";
import { type Point, resizeElements, worldPoints } from "../src/geometry.js";
import { penSize } from "../src/render/shapes.js";

// A horizontal stroke from (0, 0) to (200, 0), one point every 10 units.
function line(
  options: {
    pressures?: number[];
    angle?: number;
    penStyle?: DrawElement["penStyle"];
    points?: LocalPoint[];
  } = {},
): DrawElement {
  const points =
    options.points ??
    Array.from({ length: 21 }, (_, i) => [i * 10, 0] as const);
  return createElement("draw", {
    x: 0,
    y: 0,
    points,
    pressures: options.pressures ?? [],
    simulatePressure: !options.pressures,
    strokeWidth: 2,
    strokeColor: "#ff0000",
    opacity: 70,
    penStyle: options.penStyle ?? "pen",
    angle: options.angle ?? 0,
    order: "a5",
    groupIds: ["g1"],
    frameId: "frame1",
  });
}

const ink = penSize("pen", 2) / 2;

/** A stamp of the eraser at one point. */
const at = (x: number, y: number, radius = 10): EraserSweep => ({
  from: { x, y },
  to: { x, y },
  radius,
});

/** Board x of each piece's points (unrotated pieces only). */
const xs = (element: { x: number; points: readonly LocalPoint[] }) =>
  element.points.map(([px]) => Math.round((element.x + px) * 100) / 100);

describe("capsuleInterval", () => {
  it("finds where a segment crosses the capsule", () => {
    const cut = capsuleInterval(
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 50, y: -40 },
      { x: 50, y: 40 },
      10,
    );
    expect(cut?.[0]).toBeCloseTo(0.4);
    expect(cut?.[1]).toBeCloseTo(0.6);
  });

  it("covers the round ends", () => {
    const cut = capsuleInterval(
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 50, y: 5 },
      { x: 50, y: 5 },
      10,
    );
    const half = Math.sqrt(100 - 25) / 100;
    expect(cut?.[0]).toBeCloseTo(0.5 - half);
    expect(cut?.[1]).toBeCloseTo(0.5 + half);
  });

  it("misses a segment beyond the reach", () => {
    expect(
      capsuleInterval(
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 0, y: 20 },
        { x: 100, y: 20 },
        10,
      ),
    ).toBeNull();
  });
});

describe("eraseStroke", () => {
  it("returns null when the eraser misses", () => {
    expect(eraseStroke(line(), at(100, 50))).toBeNull();
    expect(eraseStroke(line(), at(400, 0))).toBeNull();
  });

  it("cuts a gap in the middle as wide as the eraser plus the ink", () => {
    const pieces = eraseStroke(line(), at(100, 0, 10));
    expect(pieces).toHaveLength(2);
    const reach = 10 + ink;
    const [left, right] = pieces ?? [];
    const leftEnd = left?.points.at(-1);
    expect((left?.x ?? 0) + (leftEnd?.[0] ?? 0)).toBeCloseTo(100 - reach);
    expect(right?.x).toBeCloseTo(100 + reach);
    expect(right?.y).toBeCloseTo(0);
    // Points under the eraser are gone; those outside are kept as they were.
    expect(xs(right ?? { x: 0, points: [] }).slice(1, 3)).toEqual([120, 130]);
  });

  it("cuts a segment between two far-apart points", () => {
    // Two points only: the eraser touches neither, only the line between.
    const sparse = line({
      points: [
        [0, 0],
        [200, 0],
      ],
    });
    const pieces = eraseStroke(sparse, at(100, 0, 10));
    expect(pieces).toHaveLength(2);
    expect(pieces?.[0]?.points).toHaveLength(2);
    expect(pieces?.[1]?.points).toHaveLength(2);
  });

  it("trims the start or the end without splitting", () => {
    const start = eraseStroke(line(), at(0, 0, 10));
    expect(start).toHaveLength(1);
    expect(start?.[0]?.x).toBeCloseTo(10 + ink);
    const end = eraseStroke(line(), at(200, 0, 10));
    expect(end).toHaveLength(1);
    const piece = end?.[0];
    const last = piece?.points.at(-1)?.[0] ?? 0;
    expect((piece?.x ?? 0) + last).toBeCloseTo(190 - ink);
  });

  it("erases the whole stroke when the sweep covers it", () => {
    expect(
      eraseStroke(line(), {
        from: { x: 0, y: 0 },
        to: { x: 200, y: 0 },
        radius: 4,
      }),
    ).toEqual([]);
  });

  it("drops crumbs shorter than the minimum length", () => {
    // Two cuts 30 apart leave a sliver in between.
    const short = line();
    const first = splitStroke(short, at(80, 0, 10));
    const pieces = first?.flatMap((piece) => {
      const next = eraseStroke(piece, at(108, 0, 10), { minLength: 10 });
      return next === null ? [piece] : next;
    });
    // Left of 80 and right of 108 survive; the 3-unit sliver between them does not.
    expect(pieces).toHaveLength(2);
  });

  it("sweeps the whole segment between two pointer samples", () => {
    // A fast vertical drag across the stroke: both samples are far from it.
    const pieces = eraseStroke(line(), {
      from: { x: 100, y: -300 },
      to: { x: 100, y: 300 },
      radius: 5,
    });
    expect(pieces).toHaveLength(2);
    // A diagonal drag takes a slanted bite.
    const diagonal = eraseStroke(line(), {
      from: { x: 40, y: -100 },
      to: { x: 160, y: 100 },
      radius: 5,
    });
    expect(diagonal).toHaveLength(2);
  });

  it("slices pressures with the points and interpolates at the cut", () => {
    const pressures = Array.from({ length: 21 }, (_, i) => i / 20);
    const pieces = eraseStroke(line({ pressures }), at(100, 0, 10)) ?? [];
    for (const piece of pieces) {
      expect(piece.pressures).toHaveLength(piece.points.length);
    }
    const left = pieces[0];
    // The cut point sits at x = 100 - reach: pressure follows x / 200.
    const reach = 10 + ink;
    expect(left?.pressures.at(-1)).toBeCloseTo((100 - reach) / 200, 2);
    expect(left?.pressures.slice(0, 3)).toEqual([0, 0.05, 0.1]);
  });

  it("keeps no pressures for a stroke that had none", () => {
    const pieces = eraseStroke(line(), at(100, 0)) ?? [];
    expect(pieces.every((piece) => piece.pressures.length === 0)).toBe(true);
  });

  it("reaches the edge of a highlighter's broad ink", () => {
    const highlight = line({ penStyle: "highlighter" });
    const halfInk = penSize("highlighter", 2) / 2;
    expect(eraseStroke(highlight, at(100, halfInk + 3, 4))).not.toBeNull();
    expect(eraseStroke(line(), at(100, halfInk + 3, 4))).toBeNull();
  });

  it("erases a rotated stroke where it shows on screen", () => {
    // Rotated a quarter turn about its centre (100, 0): it runs from
    // (100, -100) to (100, 100) on screen.
    const rotated = line({ angle: Math.PI / 2 });
    expect(eraseStroke(rotated, at(150, 0, 5))).toBeNull();
    const pieces = eraseStroke(rotated, at(100, 50, 5));
    expect(pieces).toHaveLength(2);
  });

  it("keeps the pieces of a rotated stroke exactly in place", () => {
    const rotated = line({ angle: 0.7 });
    const before = worldPoints(rotated);
    const split = splitStroke(rotated, {
      from: before[10] as Point,
      to: before[10] as Point,
      radius: 6,
    });
    expect(split).toHaveLength(2);
    const after = (split ?? []).flatMap((piece) => worldPoints(piece));
    // Every surviving original point is still where it was.
    for (const index of [0, 1, 2, 3, 17, 18, 19, 20]) {
      const point = before[index] as Point;
      const match = after.some(
        (other) =>
          Math.abs(other.x - point.x) < 1e-6 &&
          Math.abs(other.y - point.y) < 1e-6,
      );
      expect(match).toBe(true);
    }
    for (const piece of split ?? []) expect(piece.angle).toBeCloseTo(0.7);
  });

  it("erases a resized stroke in its new size", () => {
    const [resized] = resizeElements(
      [line()],
      "e",
      { x: 200, y: 0 },
      { x: 400, y: 0 },
    ) as [DrawElement];
    // Twice as long: the point that was at x = 150 is now at x = 300.
    expect(eraseStroke(resized, at(300, 0, 5))).toHaveLength(2);
    expect(eraseStroke(resized, at(450, 0, 5))).toBeNull();
  });
});

describe("splitStroke", () => {
  it("keeps the stroke's id for the first piece and its look on every piece", () => {
    const stroke = line({ pressures: Array.from({ length: 21 }, () => 0.5) });
    const split = splitStroke(stroke, at(100, 0, 10), {
      userId: "u1",
      above: "a6",
    });
    expect(split).toHaveLength(2);
    const [first, second] = split ?? [];
    expect(first?.id).toBe(stroke.id);
    expect(first?.version).toBe(stroke.version + 1);
    expect(second?.id).not.toBe(stroke.id);
    expect(second?.version).toBe(1);
    for (const piece of split ?? []) {
      expect(piece.strokeColor).toBe("#ff0000");
      expect(piece.strokeWidth).toBe(2);
      expect(piece.opacity).toBe(70);
      expect(piece.penStyle).toBe("pen");
      expect(piece.groupIds).toEqual(["g1"]);
      expect(piece.frameId).toBe("frame1");
      expect(piece.updatedBy).toBe("u1");
      expect(piece.points[0]).toEqual([0, 0]);
      expect(piece.pressures).toHaveLength(piece.points.length);
    }
    // The new piece stacks between the stroke and what was above it.
    expect((second?.order ?? "") > "a5").toBe(true);
    expect((second?.order ?? "") < "a6").toBe(true);
    expect(xs(first ?? { x: 0, points: [] })[0]).toBe(0);
  });

  it("deletes the stroke when nothing is left", () => {
    const stroke = line();
    const split = splitStroke(stroke, {
      from: { x: -10, y: 0 },
      to: { x: 210, y: 0 },
      radius: 8,
    });
    expect(split).toHaveLength(1);
    expect(split?.[0]?.id).toBe(stroke.id);
    expect(split?.[0]?.deleted).toBe(true);
  });

  it("returns null when the sweep misses", () => {
    expect(splitStroke(line(), at(100, 80))).toBeNull();
  });

  it("falls back to the stroke's key when the neighbour above is equal", () => {
    const split = splitStroke(line(), at(100, 0), { above: "a5" });
    expect(split?.[1]?.order).toBe("a5");
  });
});

describe("sweepTouches", () => {
  const box = createElement("rectangle", {
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    fillColor: "transparent",
    fillStyle: "none",
  });
  const sticky = createElement("sticky", {
    x: 0,
    y: 0,
    width: 100,
    height: 100,
  });

  it("touches an outlined shape only near its outline", () => {
    expect(sweepTouches(box, at(50, 50, 8))).toBe(false);
    expect(sweepTouches(box, at(50, 4, 8))).toBe(true);
  });

  it("touches a filled object anywhere inside", () => {
    expect(sweepTouches(sticky, at(50, 50, 8))).toBe(true);
    expect(sweepTouches(sticky, at(150, 50, 8))).toBe(false);
  });

  it("catches an object crossed between two pointer samples", () => {
    const arrow = createElement("arrow", {
      x: 50,
      y: -100,
      points: [
        [0, 0],
        [0, 200],
      ],
    });
    expect(
      sweepTouches(arrow, {
        from: { x: -300, y: 0 },
        to: { x: 300, y: 0 },
        radius: 3,
      }),
    ).toBe(true);
  });

  it("treats a stroke as touched when the sweep reaches its ink", () => {
    expect(sweepTouches(line(), at(100, 5, 4))).toBe(true);
    expect(sweepTouches(line(), at(100, 40, 4))).toBe(false);
  });

  it("never touches a deleted element", () => {
    expect(sweepTouches({ ...sticky, deleted: true }, at(50, 50))).toBe(false);
  });
});
