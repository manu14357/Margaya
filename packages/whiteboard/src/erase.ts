// The eraser. A sweep is the round brush dragged from one pointer sample to
// the next: a capsule, so a fast drag leaves no gaps between samples.
//
// Freehand strokes lose only the part under the sweep and split where they
// are cut. Every other element (shapes, text, notes, pictures, frames, task
// cards, lines and arrows) is a whole object: touching it erases all of it.
// Lines and arrows stay whole on purpose: their heads, bindings, labels and
// routing have no sensible meaning for a fragment.

import {
  deleteElement,
  type ElementOptions,
  type ElementPatch,
  updateElement,
} from "./create.js";
import type { BoardElement, DrawElement, LocalPoint } from "./elements.js";
import {
  type Box,
  boxCenter,
  boxesIntersect,
  distanceToSegment,
  elementBounds,
  elementBox,
  FRAME_TITLE_HEIGHT,
  hitTest,
  type Point,
  rotatePoint,
} from "./geometry.js";
import { newElementId } from "./ids.js";
import { ordersBetween } from "./order.js";
import { penSize } from "./render/shapes.js";

/** The eraser dragged from `from` to `to`, in board coordinates. */
export type EraserSweep = { from: Point; to: Point; radius: number };

/** A surviving run of a stroke, placed like a drawing (first point at 0,0). */
export type StrokePiece = {
  x: number;
  y: number;
  points: LocalPoint[];
  /** Matches `points` one to one, or empty when the stroke had none. */
  pressures: number[];
};

const EPSILON = 1e-9;

type Interval = readonly [start: number, end: number];

/** Where the segment p→q (t in 0..1) is within `radius` of a circle centre. */
function circleInterval(
  p: Point,
  q: Point,
  centre: Point,
  radius: number,
): Interval | null {
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  const fx = p.x - centre.x;
  const fy = p.y - centre.y;
  const a = dx * dx + dy * dy;
  const c = fx * fx + fy * fy - radius * radius;
  if (a < EPSILON) return c <= 0 ? [0, 1] : null;
  const b = 2 * (dx * fx + dy * fy);
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const root = Math.sqrt(disc);
  const t0 = (-b - root) / (2 * a);
  const t1 = (-b + root) / (2 * a);
  if (t0 > 1 || t1 < 0) return null;
  return [Math.max(0, t0), Math.min(1, t1)];
}

/** Where the segment p→q is inside the band between the sweep's two ends. */
function bandInterval(
  p: Point,
  q: Point,
  a: Point,
  b: Point,
  radius: number,
): Interval | null {
  const ax = b.x - a.x;
  const ay = b.y - a.y;
  const length = Math.hypot(ax, ay);
  if (length < EPSILON) return null;
  const ux = ax / length;
  const uy = ay / length;
  const rx = p.x - a.x;
  const ry = p.y - a.y;
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  let start = 0;
  let end = 1;
  // Along the sweep (0..length), then across it (-radius..radius).
  const limits: [number, number, number, number][] = [
    [rx * ux + ry * uy, dx * ux + dy * uy, 0, length],
    [-rx * uy + ry * ux, -dx * uy + dy * ux, -radius, radius],
  ];
  for (const [origin, step, low, high] of limits) {
    if (Math.abs(step) < EPSILON) {
      if (origin < low || origin > high) return null;
      continue;
    }
    const t0 = (low - origin) / step;
    const t1 = (high - origin) / step;
    start = Math.max(start, Math.min(t0, t1));
    end = Math.min(end, Math.max(t0, t1));
    if (start > end) return null;
  }
  return [start, end];
}

/**
 * The part of segment p→q (t in 0..1) inside the capsule around a→b. The
 * capsule is convex, so the part is one interval: the union of what its two
 * end circles and its middle band cover.
 */
export function capsuleInterval(
  p: Point,
  q: Point,
  a: Point,
  b: Point,
  radius: number,
): Interval | null {
  let start = Number.POSITIVE_INFINITY;
  let end = Number.NEGATIVE_INFINITY;
  for (const part of [
    circleInterval(p, q, a, radius),
    circleInterval(p, q, b, radius),
    bandInterval(p, q, a, b, radius),
  ]) {
    if (!part) continue;
    start = Math.min(start, part[0]);
    end = Math.max(end, part[1]);
  }
  return start <= end ? [start, end] : null;
}

function sweepBox(sweep: EraserSweep, by: number): Box {
  const x = Math.min(sweep.from.x, sweep.to.x) - by;
  const y = Math.min(sweep.from.y, sweep.to.y) - by;
  return {
    x,
    y,
    width: Math.abs(sweep.to.x - sweep.from.x) + by * 2,
    height: Math.abs(sweep.to.y - sweep.from.y) + by * 2,
  };
}

/** Half the width of a stroke's visible ink. */
function inkRadius(element: DrawElement): number {
  return penSize(element.penStyle, element.strokeWidth) / 2;
}

type Run = { points: Point[]; pressures: number[] };

function polylineLength(points: readonly Point[]): number {
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as Point;
    const b = points[i] as Point;
    length += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return length;
}

/**
 * What is left of a freehand stroke after a sweep, as pieces in board
 * coordinates; null when the sweep misses it, an empty list when nothing is
 * left. The sweep reaches the edge of the visible ink, so the gap it leaves
 * is as wide as the eraser. Pieces shorter than `minLength` (board units)
 * are dropped as crumbs.
 */
export function eraseStroke(
  element: DrawElement,
  sweep: EraserSweep,
  options: { minLength?: number } = {},
): StrokePiece[] | null {
  if (element.deleted || element.points.length === 0) return null;
  const reach = Math.max(0, sweep.radius) + inkRadius(element);
  const box = elementBox(element);
  const centre = boxCenter(box);
  // Cheap rejection first: the stroke fits in a circle around its box.
  const bound = Math.hypot(box.width, box.height) / 2;
  if (distanceToSegment(centre, sweep.from, sweep.to) > bound + reach)
    return null;

  // Work in the stroke's unrotated frame; a resize is already in its points.
  const angle = element.angle;
  const from =
    angle === 0 ? sweep.from : rotatePoint(sweep.from, centre, -angle);
  const to = angle === 0 ? sweep.to : rotatePoint(sweep.to, centre, -angle);
  const points: Point[] = element.points.map(([px, py]) => ({
    x: element.x + px,
    y: element.y + py,
  }));
  const hasPressure =
    element.pressures.length > 0 &&
    element.pressures.length === element.points.length;
  const pressureAt = (index: number) =>
    hasPressure ? (element.pressures[index] as number) : 0;

  if (points.length === 1) {
    return distanceToSegment(points[0] as Point, from, to) <= reach ? [] : null;
  }

  const runs: Run[] = [];
  let run: Run | null = null;
  let touched = false;
  const at = (index: number): Run => ({
    points: [points[index] as Point],
    pressures: [pressureAt(index)],
  });
  const along = (index: number, t: number): [Point, number] => {
    const a = points[index] as Point;
    const b = points[index + 1] as Point;
    const pressure =
      pressureAt(index) + (pressureAt(index + 1) - pressureAt(index)) * t;
    return [{ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, pressure];
  };

  // Walk the segments: a cut ends the running piece where the sweep begins
  // and starts the next one where it ends.
  for (let i = 0; i < points.length - 1; i++) {
    const q = points[i + 1] as Point;
    const cut = capsuleInterval(points[i] as Point, q, from, to, reach);
    if (!cut) {
      run ??= at(i);
      run.points.push(q);
      run.pressures.push(pressureAt(i + 1));
      continue;
    }
    touched = true;
    const [start, end] = cut;
    if (start > EPSILON) {
      run ??= at(i);
      const [point, pressure] = along(i, start);
      run.points.push(point);
      run.pressures.push(pressure);
    }
    if (run) runs.push(run);
    run = null;
    if (end < 1 - EPSILON) {
      const [point, pressure] = along(i, end);
      run = { points: [point, q], pressures: [pressure, pressureAt(i + 1)] };
    }
  }
  if (run) runs.push(run);
  if (!touched) return null;

  const minLength = Math.max(0, options.minLength ?? 1);
  const pieces: StrokePiece[] = [];
  for (const kept of runs) {
    if (kept.points.length < 2) continue;
    if (polylineLength(kept.points) < minLength) continue;
    // A piece rotates about its own centre: shift it so its points stay
    // exactly where they were on screen.
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const point of kept.points) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
    const own = { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
    const moved = angle === 0 ? own : rotatePoint(own, centre, angle);
    const first = kept.points[0] as Point;
    const x = first.x + moved.x - own.x;
    const y = first.y + moved.y - own.y;
    pieces.push({
      x,
      y,
      points: kept.points.map(
        (point) => [point.x - first.x, point.y - first.y] as const,
      ),
      pressures: hasPressure
        ? kept.pressures.map((value) => Math.round(value * 100) / 100)
        : [],
    });
  }
  return pieces;
}

export type SplitStrokeOptions = ElementOptions & {
  minLength?: number;
  /**
   * The order key of the element just above the stroke, so new pieces stack
   * where the stroke was. Null when it is the top element.
   */
  above?: string | null;
};

/**
 * Erases the part of a stroke under the sweep. Returns null when the sweep
 * misses it; otherwise the stroke itself (cut to its first piece, or deleted
 * when nothing is left) followed by any further pieces as new elements with
 * the stroke's look, group and frame.
 */
export function splitStroke(
  element: DrawElement,
  sweep: EraserSweep,
  options: SplitStrokeOptions = {},
): DrawElement[] | null {
  const pieces = eraseStroke(element, sweep, options);
  if (!pieces) return null;
  const stamp = { userId: options.userId, now: options.now };
  const [first, ...rest] = pieces;
  if (!first) return [deleteElement(element, stamp)];
  const patch = (piece: StrokePiece): ElementPatch<DrawElement> => ({
    x: piece.x,
    y: piece.y,
    points: piece.points,
    pressures: piece.pressures,
  });
  const result: DrawElement[] = [updateElement(element, patch(first), stamp)];
  if (rest.length === 0) return result;
  let orders: string[];
  try {
    orders = ordersBetween(element.order, options.above ?? null, rest.length);
  } catch {
    // Equal or malformed neighbours: share the stroke's key instead.
    orders = rest.map(() => element.order);
  }
  rest.forEach((piece, index) => {
    const next = updateElement(element, patch(piece), stamp);
    result.push({
      ...next,
      id: newElementId(),
      version: 1,
      order: orders[index] ?? element.order,
    });
  });
  return result;
}

/**
 * True when the sweep touches the element at all: the rule for erasing a
 * whole object. Locked elements are the caller's to skip.
 */
export function sweepTouches(
  element: BoardElement,
  sweep: EraserSweep,
): boolean {
  if (element.deleted) return false;
  const radius = Math.max(0, sweep.radius);
  if (element.type === "draw") {
    return eraseStroke(element, sweep, { minLength: 0 }) !== null;
  }
  // Frames also answer on the title strip above their box.
  const reach =
    radius +
    element.strokeWidth +
    (element.type === "frame" ? FRAME_TITLE_HEIGHT : 0);
  if (!boxesIntersect(elementBounds(element), sweepBox(sweep, reach)))
    return false;
  // The brush stamped along the sweep, close enough that nothing thin slips
  // between two stamps.
  const length = Math.hypot(
    sweep.to.x - sweep.from.x,
    sweep.to.y - sweep.from.y,
  );
  const step = Math.max(radius / 2, 0.5);
  const count = Math.max(1, Math.ceil(length / step));
  for (let i = 0; i <= count; i++) {
    const t = i / count;
    const point = {
      x: sweep.from.x + (sweep.to.x - sweep.from.x) * t,
      y: sweep.from.y + (sweep.to.y - sweep.from.y) * t,
    };
    if (hitTest(element, point, radius)) return true;
  }
  return false;
}
