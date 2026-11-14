// Pressure-sensitive pen outlines. A stroke's centre line is smoothed, each
// sample gets a radius from pressure (real or simulated from speed), and the
// outline is the left edge, a round end cap, the right edge backwards and a
// round start cap. The result is one closed polygon filled with the ink colour.

import type { LocalPoint } from "../elements.js";
import { pathOpsToSvg } from "./sketch.js";
import type { PathOp } from "./types.js";

export type FreehandOptions = {
  /** Stroke diameter at full pressure, in board units. */
  size: number;
  /** -1..1: how strongly pressure changes the width (negative = thicker when light). */
  thinning?: number;
  /** 0..1: how much the outline edges are evened out. */
  smoothing?: number;
  /** 0..1: how far each sample is pulled towards the previous one. */
  streamline?: number;
  /** Derive pressure from drawing speed instead of the given pressures. */
  simulatePressure?: boolean;
  /** Length over which the stroke narrows at its start; default from size. */
  taperStart?: number;
  /** Length over which the stroke narrows at its end; default from size. */
  taperEnd?: number;
  /** Square the ends off instead of rounding them (a chisel-tip highlighter). */
  flatCaps?: boolean;
};

type Sample = { x: number; y: number; pressure: number; distance: number };

const CAP_STEPS = 8;
/** Tapered ends never shrink below this share of the radius. */
const TAPER_FLOOR = 0.35;

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function smoothstep(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

function collectSamples(
  points: readonly LocalPoint[],
  pressures: readonly number[],
  usePressure: boolean,
  streamline: number,
  minGap: number,
): Sample[] {
  const samples: Sample[] = [];
  let lastRaw: LocalPoint | null = null;
  for (let index = 0; index < points.length; index++) {
    const point = points[index] as LocalPoint;
    if (!Number.isFinite(point[0]) || !Number.isFinite(point[1])) continue;
    lastRaw = point;
    const rawPressure = usePressure ? finiteOr(pressures[index], 0.5) : 0.5;
    const pressure = clamp(rawPressure, 0, 1);
    const previous = samples[samples.length - 1];
    if (!previous) {
      samples.push({ x: point[0], y: point[1], pressure, distance: 0 });
      continue;
    }
    const follow = 1 - streamline;
    const x = previous.x + (point[0] - previous.x) * follow;
    const y = previous.y + (point[1] - previous.y) * follow;
    const step = Math.hypot(x - previous.x, y - previous.y);
    if (step < minGap) {
      previous.pressure = Math.max(previous.pressure, pressure);
      continue;
    }
    samples.push({ x, y, pressure, distance: previous.distance + step });
  }
  // Streamlining lags behind the pen; finish exactly where the pen lifted.
  const tail = samples[samples.length - 1];
  if (lastRaw && tail) {
    const step = Math.hypot(lastRaw[0] - tail.x, lastRaw[1] - tail.y);
    if (step >= minGap) {
      samples.push({
        x: lastRaw[0],
        y: lastRaw[1],
        pressure: tail.pressure,
        distance: tail.distance + step,
      });
    }
  }
  return samples;
}

/** Fast movement thins the line; the pressure eases towards its target. */
function simulatePressures(samples: Sample[], size: number): void {
  let pressure = 0.5;
  for (let index = 0; index < samples.length; index++) {
    const sample = samples[index] as Sample;
    const previous = samples[index - 1];
    const travelled = previous ? sample.distance - previous.distance : 0;
    const speed = clamp(travelled / Math.max(size, 1), 0, 1);
    const target = 1 - speed;
    pressure += (target - pressure) * 0.3;
    sample.pressure = clamp(pressure, 0.05, 1);
  }
}

function circleOutline(x: number, y: number, radius: number): LocalPoint[] {
  const outline: LocalPoint[] = [];
  const steps = 16;
  for (let index = 0; index < steps; index++) {
    const angle = (index / steps) * Math.PI * 2;
    outline.push([x + Math.cos(angle) * radius, y + Math.sin(angle) * radius]);
  }
  outline.push(outline[0] as LocalPoint);
  return outline;
}

function evenOut(edge: LocalPoint[], amount: number): LocalPoint[] {
  if (amount <= 0 || edge.length < 3) return edge;
  let current = edge;
  const weight = amount * 0.5;
  for (let pass = 0; pass < 2; pass++) {
    const next: LocalPoint[] = [current[0] as LocalPoint];
    for (let index = 1; index < current.length - 1; index++) {
      const a = current[index - 1] as LocalPoint;
      const b = current[index] as LocalPoint;
      const c = current[index + 1] as LocalPoint;
      next.push([
        b[0] * (1 - weight) + ((a[0] + c[0]) / 2) * weight,
        b[1] * (1 - weight) + ((a[1] + c[1]) / 2) * weight,
      ]);
    }
    next.push(current[current.length - 1] as LocalPoint);
    current = next;
  }
  return current;
}

/**
 * The closed outline polygon of a pen stroke; the last point repeats the
 * first. Returns an empty list when there is nothing to draw.
 */
export function freehandOutline(
  points: readonly LocalPoint[],
  pressures: readonly number[],
  options: FreehandOptions,
): LocalPoint[] {
  const size = Math.max(0.1, finiteOr(options.size, 4));
  const thinning = clamp(finiteOr(options.thinning, 0.6), -1, 1);
  const smoothing = clamp(finiteOr(options.smoothing, 0.5), 0, 1);
  const streamline = clamp(finiteOr(options.streamline, 0.5), 0, 0.95);
  const usePressure =
    !options.simulatePressure &&
    pressures.length > 0 &&
    pressures.length === points.length;
  const samples = collectSamples(
    points,
    pressures,
    usePressure,
    streamline,
    Math.max(0.2, size * 0.04),
  );
  if (samples.length === 0) return [];
  if (!usePressure) simulatePressures(samples, size);

  const radiusAt = (sample: Sample) =>
    (size / 2) * Math.max(0.05, 1 - thinning * (1 - sample.pressure));

  const total = (samples[samples.length - 1] as Sample).distance;
  if (samples.length === 1 || total < size * 0.1) {
    const first = samples[0] as Sample;
    return circleOutline(first.x, first.y, radiusAt(first));
  }

  const taperStart = Math.max(
    0,
    finiteOr(options.taperStart, Math.min(size * 2.5, total * 0.3)),
  );
  const taperEnd = Math.max(
    0,
    finiteOr(options.taperEnd, Math.min(size * 2.5, total * 0.3)),
  );
  const left: LocalPoint[] = [];
  const right: LocalPoint[] = [];
  const radii: number[] = [];
  const normals: [number, number][] = [];
  let lastNormal: [number, number] = [0, -1];
  for (let index = 0; index < samples.length; index++) {
    const sample = samples[index] as Sample;
    const before = samples[Math.max(0, index - 1)] as Sample;
    const after = samples[Math.min(samples.length - 1, index + 1)] as Sample;
    let dx = after.x - before.x;
    let dy = after.y - before.y;
    const length = Math.hypot(dx, dy);
    let normal = lastNormal;
    if (length > 1e-9) {
      dx /= length;
      dy /= length;
      normal = [-dy, dx];
    }
    lastNormal = normal;
    let radius = radiusAt(sample);
    if (taperStart > 0) {
      radius *=
        TAPER_FLOOR +
        (1 - TAPER_FLOOR) * smoothstep(sample.distance / taperStart);
    }
    if (taperEnd > 0) {
      radius *=
        TAPER_FLOOR +
        (1 - TAPER_FLOOR) * smoothstep((total - sample.distance) / taperEnd);
    }
    radii.push(radius);
    normals.push(normal);
    left.push([sample.x + normal[0] * radius, sample.y + normal[1] * radius]);
    right.push([sample.x - normal[0] * radius, sample.y - normal[1] * radius]);
  }

  const leftEdge = evenOut(left, smoothing);
  const rightEdge = evenOut(right, smoothing);
  const outline: LocalPoint[] = [...leftEdge];

  const capSteps = options.flatCaps ? 0 : CAP_STEPS;
  // End cap: sweep from the left edge, around the tip, to the right edge.
  const last = samples.length - 1;
  const end = samples[last] as Sample;
  const endNormal = normals[last] as [number, number];
  const endAngle = Math.atan2(endNormal[1], endNormal[0]);
  for (let step = 1; step < capSteps; step++) {
    const angle = endAngle - (step / CAP_STEPS) * Math.PI;
    const radius = radii[last] as number;
    outline.push([
      end.x + Math.cos(angle) * radius,
      end.y + Math.sin(angle) * radius,
    ]);
  }
  for (let index = rightEdge.length - 1; index >= 0; index--) {
    outline.push(rightEdge[index] as LocalPoint);
  }
  // Start cap: from the right edge, around the back, to the left edge.
  const start = samples[0] as Sample;
  const startNormal = normals[0] as [number, number];
  const startAngle = Math.atan2(startNormal[1], startNormal[0]) + Math.PI;
  for (let step = 1; step < capSteps; step++) {
    const angle = startAngle - (step / CAP_STEPS) * Math.PI;
    const radius = radii[0] as number;
    outline.push([
      start.x + Math.cos(angle) * radius,
      start.y + Math.sin(angle) * radius,
    ]);
  }
  outline.push(outline[0] as LocalPoint);
  return outline;
}

/**
 * Smooth path commands for an outline: quadratic curves through the edge
 * midpoints, expressed as cubics so every renderer shares one command set.
 */
export function outlineToOps(outline: readonly LocalPoint[]): PathOp[] {
  let points = outline;
  const first = outline[0];
  const final = outline[outline.length - 1];
  if (
    first &&
    final &&
    outline.length > 1 &&
    first[0] === final[0] &&
    first[1] === final[1]
  ) {
    points = outline.slice(0, -1);
  }
  const count = points.length;
  if (count < 3) return [];
  const mid = (a: LocalPoint, b: LocalPoint): LocalPoint => [
    (a[0] + b[0]) / 2,
    (a[1] + b[1]) / 2,
  ];
  const begin = mid(points[0] as LocalPoint, points[1] as LocalPoint);
  const ops: PathOp[] = [["M", begin[0], begin[1]]];
  let from = begin;
  for (let index = 1; index <= count; index++) {
    const control = points[index % count] as LocalPoint;
    const to = mid(control, points[(index + 1) % count] as LocalPoint);
    ops.push([
      "C",
      from[0] + ((control[0] - from[0]) * 2) / 3,
      from[1] + ((control[1] - from[1]) * 2) / 3,
      to[0] + ((control[0] - to[0]) * 2) / 3,
      to[1] + ((control[1] - to[1]) * 2) / 3,
      to[0],
      to[1],
    ]);
    from = to;
  }
  ops.push(["Z"]);
  return ops;
}

/** SVG path data for an outline from `freehandOutline`. */
export function outlineToPath(outline: readonly LocalPoint[]): string {
  return pathOpsToSvg(outlineToOps(outline));
}

/**
 * Outline of a fading laser trail: oldest point first, thin at the tail and
 * full width at the pointer.
 */
export function laserTrailOutline(
  points: readonly LocalPoint[],
  options: { size?: number } = {},
): LocalPoint[] {
  const count = points.length;
  const pressures = points.map((_, index) =>
    count > 1 ? 0.15 + (index / (count - 1)) * 0.85 : 1,
  );
  return freehandOutline(points, pressures, {
    size: Math.max(1, finiteOr(options.size, 6)),
    thinning: 0.9,
    smoothing: 0.6,
    streamline: 0.3,
    taperEnd: 0,
  });
}
