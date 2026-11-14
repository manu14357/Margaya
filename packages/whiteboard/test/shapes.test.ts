import { describe, expect, it } from "vitest";
import {
  type LocalPoint,
  SHAPE_KINDS,
  type ShapeKind,
} from "../src/elements.js";
import {
  flipShapeKind,
  isShapeKind,
  shapeDetails,
  shapeOutline,
  shapePolygon,
  shapeSilhouette,
  shapeTextBox,
  shapeVertices,
} from "../src/shapes.js";

const SIZES = [
  [160, 120],
  [400, 60],
  [40, 300],
  [1, 1],
] as const;

function coordinates(ops: ReturnType<typeof shapeOutline>): number[][] {
  const points: number[][] = [];
  for (const op of ops) {
    if (op[0] === "M" || op[0] === "L") points.push([op[1], op[2]]);
    else if (op[0] === "C") {
      points.push([op[1], op[2]], [op[3], op[4]], [op[5], op[6]]);
    }
  }
  return points;
}

function inside(point: LocalPoint, polygon: readonly LocalPoint[]): boolean {
  let result = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (
      a[1] > point[1] !== b[1] > point[1] &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]
    ) {
      result = !result;
    }
  }
  return result;
}

function distanceToOutline(
  point: LocalPoint,
  polygon: readonly LocalPoint[],
): number {
  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const length = dx * dx + dy * dy;
    const t =
      length > 0
        ? Math.max(
            0,
            Math.min(
              1,
              ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / length,
            ),
          )
        : 0;
    best = Math.min(
      best,
      Math.hypot(point[0] - (a[0] + t * dx), point[1] - (a[1] + t * dy)),
    );
  }
  return best;
}

describe("shape outlines", () => {
  it("has 22 kinds and recognises them", () => {
    expect(SHAPE_KINDS).toHaveLength(22);
    for (const kind of SHAPE_KINDS) expect(isShapeKind(kind)).toBe(true);
    expect(isShapeKind("rectangle")).toBe(false);
    expect(isShapeKind(42)).toBe(false);
  });

  for (const kind of SHAPE_KINDS) {
    it(`${kind}: a closed, finite silhouette that fills its box exactly`, () => {
      for (const [w, h] of SIZES) {
        const ops = shapeOutline(kind, w, h);
        expect(ops[0]?.[0]).toBe("M");
        const silhouette = shapeSilhouette(kind, w, h);
        expect(silhouette[silhouette.length - 1]).toEqual(["Z"]);
        // Control points may sit outside the box; the curves never do.
        for (const [x, y] of coordinates(ops)) {
          expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
        }
        const polygon = shapePolygon(kind, w, h, 32);
        expect(polygon.length).toBeGreaterThanOrEqual(3);
        let minX = Number.POSITIVE_INFINITY;
        let minY = Number.POSITIVE_INFINITY;
        let maxX = Number.NEGATIVE_INFINITY;
        let maxY = Number.NEGATIVE_INFINITY;
        for (const [x, y] of polygon) {
          expect(x).toBeGreaterThanOrEqual(-1e-6);
          expect(y).toBeGreaterThanOrEqual(-1e-6);
          expect(x).toBeLessThanOrEqual(w + 1e-6);
          expect(y).toBeLessThanOrEqual(h + 1e-6);
          minX = Math.min(minX, x);
          minY = Math.min(minY, y);
          maxX = Math.max(maxX, x);
          maxY = Math.max(maxY, y);
        }
        // The outline touches all four sides (sampling may miss a curve's
        // exact extreme by a hair).
        const slack = Math.max(w, h) * 0.01;
        expect(minX).toBeLessThan(slack);
        expect(minY).toBeLessThan(slack);
        expect(maxX).toBeGreaterThan(w - slack);
        expect(maxY).toBeGreaterThan(h - slack);
      }
    });

    it(`${kind}: the label box sits inside the outline`, () => {
      for (const [w, h] of SIZES.slice(0, 3)) {
        const box = shapeTextBox(kind, w, h);
        expect(box.width).toBeGreaterThan(0);
        expect(box.height).toBeGreaterThan(0);
        const polygon = shapePolygon(kind, w, h, 64);
        const tolerance = Math.max(w, h) * 0.002;
        const probes: LocalPoint[] = [];
        for (const fx of [0, 0.25, 0.5, 0.75, 1]) {
          for (const fy of [0, 0.5, 1]) {
            probes.push([box.x + box.width * fx, box.y + box.height * fy]);
          }
        }
        for (const probe of probes) {
          const ok =
            inside(probe, polygon) ||
            distanceToOutline(probe, polygon) <= tolerance;
          expect(ok, `${kind} ${w}x${h} at ${probe}`).toBe(true);
        }
      }
    });
  }

  it("draws the cylinder's top rim as an open detail stroke", () => {
    const details = shapeDetails("cylinder", 160, 120);
    expect(details[0]?.[0]).toBe("M");
    expect(details.some((op) => op[0] === "Z")).toBe(false);
    expect(shapeDetails("hexagon", 160, 120)).toEqual([]);
  });

  it("uses curves for the round kinds and corners for the polygons", () => {
    for (const kind of ["heart", "cloud", "moon", "speech"] as ShapeKind[]) {
      expect(shapeVertices(kind, 100, 100)).toBeNull();
      expect(shapeSilhouette(kind, 100, 100).some((op) => op[0] === "C")).toBe(
        true,
      );
    }
    expect(shapeVertices("triangle", 100, 80)).toEqual([
      [50, 0],
      [100, 80],
      [0, 80],
    ]);
    expect(shapeVertices("star", 100, 100)).toHaveLength(10);
    expect(shapeVertices("plus", 90, 90)).toHaveLength(12);
  });

  it("keeps the speech bubble's tail at the bottom of the box", () => {
    const polygon = shapePolygon("speech", 200, 100);
    const lowest = polygon.reduce((a, b) => (b[1] > a[1] ? b : a));
    expect(lowest[1]).toBeCloseTo(100);
    expect(lowest[0]).toBeLessThan(100);
    const box = shapeTextBox("speech", 200, 100);
    expect(box.y + box.height).toBeLessThan(80);
  });

  it("puts a triangle's label in its lower half", () => {
    const box = shapeTextBox("triangle", 200, 100);
    expect(box.y).toBeGreaterThanOrEqual(50);
  });

  it("points block arrows the way they are named", () => {
    const right = shapeVertices("arrowRight", 200, 100) ?? [];
    expect(right.filter((p) => p[0] === 200)).toEqual([[200, 50]]);
    const left = shapeVertices("arrowLeft", 200, 100) ?? [];
    expect(left.filter((p) => p[0] === 0)).toEqual([[0, 50]]);
    const up = shapeVertices("arrowUp", 100, 200) ?? [];
    expect(up.filter((p) => p[1] === 0)).toEqual([[50, 0]]);
    const down = shapeVertices("arrowDown", 100, 200) ?? [];
    expect(down.filter((p) => p[1] === 200)).toEqual([[50, 200]]);
  });

  it("degrades to a finite outline for zero size and unknown kinds", () => {
    for (const kind of SHAPE_KINDS) {
      for (const [x, y] of coordinates(shapeOutline(kind, 0, 0))) {
        expect(x).toBe(0);
        expect(y).toBe(0);
      }
      const box = shapeTextBox(kind, Number.NaN, -5);
      expect(box).toEqual({ x: 0, y: 0, width: 0, height: 0 });
    }
    const unknown = shapePolygon("blob" as ShapeKind, 50, 40);
    expect(unknown).toEqual([
      [0, 0],
      [50, 0],
      [50, 40],
      [0, 40],
    ]);
  });

  it("caches flattened outlines", () => {
    expect(shapePolygon("heart", 120, 100)).toBe(
      shapePolygon("heart", 120, 100),
    );
    expect(shapePolygon("heart", 120, 100, 4).length).toBeLessThan(
      shapePolygon("heart", 120, 100, 16).length,
    );
  });

  it("mirrors block arrows and leaves symmetric kinds alone", () => {
    expect(flipShapeKind("arrowRight", "horizontal")).toBe("arrowLeft");
    expect(flipShapeKind("arrowLeft", "horizontal")).toBe("arrowRight");
    expect(flipShapeKind("arrowUp", "vertical")).toBe("arrowDown");
    expect(flipShapeKind("arrowDown", "vertical")).toBe("arrowUp");
    expect(flipShapeKind("arrowRight", "vertical")).toBe("arrowRight");
    expect(flipShapeKind("star", "horizontal")).toBe("star");
  });
});
