// Hand-drawn stroke generator. Every function returns plain path commands so
// the canvas and SVG renderers share one geometry. Randomness comes only from
// a small seeded generator: the same seed always yields the same drawing on
// every client and on the server. Level 0 returns exact geometry.

import type { LocalPoint } from "../elements.js";
import type { PathOp } from "./types.js";

/** Uniform numbers in [0, 1) from a 32-bit seed. */
export type Random = () => number;

/** xorshift32 over a scrambled seed; tiny, fast and identical everywhere. */
export function seededRandom(seed: number): Random {
  let state = Math.imul((seed | 0) ^ 0x5bd1e995, 0x27d4eb2d) >>> 0;
  if (state === 0) state = 0x2f6b1c3d;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return (state - 1) / 4294967295;
  };
}

/** A stable sub-seed so separate parts of one element vary independently. */
export function deriveSeed(seed: number, part: number): number {
  return (
    (Math.imul((seed | 0) + 0x632be5ab, 31) + Math.imul(part, 0x9e3779b1)) | 0
  );
}

export type SketchOptions = {
  seed: number;
  /** 0 = exact geometry, 1 = lightly hand-drawn, 2 = sketchy. */
  level: number;
  /** One pass instead of the doubled stroke (dashed and dotted strokes). */
  single?: boolean;
  /** Corner radius for rectangles and polygons. */
  radius?: number;
};

type Pt = { x: number; y: number };

const KAPPA = 0.5522847498;

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function levelOf(options: SketchOptions): number {
  const level = Number.isFinite(options.level) ? options.level : 0;
  return clamp(level, 0, 2);
}

/** How far points may wander for a stroke of the given length. */
function wobble(level: number, length: number): number {
  return level * clamp(0.35 + length * 0.012, 0.35, 1.9);
}

function spread(random: Random, amount: number): number {
  return (random() * 2 - 1) * amount;
}

function passesOf(options: SketchOptions): number {
  return options.single ? 1 : 2;
}

// ---------------------------------------------------------------------------
// Exact geometry (level 0 and fill outlines)

export function rectOps(x: number, y: number, w: number, h: number): PathOp[] {
  return [
    ["M", x, y],
    ["L", x + w, y],
    ["L", x + w, y + h],
    ["L", x, y + h],
    ["Z"],
  ];
}

export function ellipseOps(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
): PathOp[] {
  const ox = rx * KAPPA;
  const oy = ry * KAPPA;
  return [
    ["M", cx + rx, cy],
    ["C", cx + rx, cy + oy, cx + ox, cy + ry, cx, cy + ry],
    ["C", cx - ox, cy + ry, cx - rx, cy + oy, cx - rx, cy],
    ["C", cx - rx, cy - oy, cx - ox, cy - ry, cx, cy - ry],
    ["C", cx + ox, cy - ry, cx + rx, cy - oy, cx + rx, cy],
    ["Z"],
  ];
}

/**
 * A closed polygon whose corners are cut by `radius` (limited to half of each
 * adjacent edge) and replaced by a curve through the corner region.
 */
export function roundedPolygonOps(
  points: readonly LocalPoint[],
  radius: number,
): PathOp[] {
  const count = points.length;
  if (count < 3) return polylineOps(points, true);
  if (!(radius > 0)) return polylineOps(points, true);
  const corners = points.map((point, index) => {
    const prev = points[(index + count - 1) % count] as LocalPoint;
    const next = points[(index + 1) % count] as LocalPoint;
    const toPrev = { x: prev[0] - point[0], y: prev[1] - point[1] };
    const toNext = { x: next[0] - point[0], y: next[1] - point[1] };
    const lenPrev = Math.hypot(toPrev.x, toPrev.y) || 1;
    const lenNext = Math.hypot(toNext.x, toNext.y) || 1;
    const cut = Math.min(radius, lenPrev / 2, lenNext / 2);
    const a = {
      x: point[0] + (toPrev.x / lenPrev) * cut,
      y: point[1] + (toPrev.y / lenPrev) * cut,
    };
    const b = {
      x: point[0] + (toNext.x / lenNext) * cut,
      y: point[1] + (toNext.y / lenNext) * cut,
    };
    return { a, b, v: { x: point[0], y: point[1] } };
  });
  const first = corners[0] as (typeof corners)[number];
  const ops: PathOp[] = [["M", first.b.x, first.b.y]];
  for (let index = 1; index <= count; index++) {
    const corner = corners[index % count] as (typeof corners)[number];
    ops.push(["L", corner.a.x, corner.a.y]);
    ops.push([
      "C",
      corner.a.x + (corner.v.x - corner.a.x) * KAPPA,
      corner.a.y + (corner.v.y - corner.a.y) * KAPPA,
      corner.b.x + (corner.v.x - corner.b.x) * KAPPA,
      corner.b.y + (corner.v.y - corner.b.y) * KAPPA,
      corner.b.x,
      corner.b.y,
    ]);
  }
  ops.push(["Z"]);
  return ops;
}

export function roundedRectOps(
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
): PathOp[] {
  const r = Math.min(Math.max(0, radius), Math.abs(w) / 2, Math.abs(h) / 2);
  if (!(r > 0)) return rectOps(x, y, w, h);
  return roundedPolygonOps(
    [
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
    ],
    r,
  );
}

export function polylineOps(
  points: readonly LocalPoint[],
  closed: boolean,
): PathOp[] {
  if (points.length === 0) return [];
  const [head, ...rest] = points as [LocalPoint, ...LocalPoint[]];
  const ops: PathOp[] = [["M", head[0], head[1]]];
  for (const point of rest) ops.push(["L", point[0], point[1]]);
  if (closed) ops.push(["Z"]);
  return ops;
}

/** A smooth curve passing through every point (uniform cardinal spline). */
export function splineOps(
  points: readonly LocalPoint[],
  closed = false,
): PathOp[] {
  const count = points.length;
  if (count < 3) return polylineOps(points, closed);
  const at = (index: number): LocalPoint => {
    if (closed) return points[(index + count) % count] as LocalPoint;
    return points[clamp(index, 0, count - 1)] as LocalPoint;
  };
  const first = points[0] as LocalPoint;
  const ops: PathOp[] = [["M", first[0], first[1]]];
  const segments = closed ? count : count - 1;
  for (let index = 0; index < segments; index++) {
    const p0 = at(index - 1);
    const p1 = at(index);
    const p2 = at(index + 1);
    const p3 = at(index + 2);
    ops.push([
      "C",
      p1[0] + (p2[0] - p0[0]) / 6,
      p1[1] + (p2[1] - p0[1]) / 6,
      p2[0] - (p3[0] - p1[0]) / 6,
      p2[1] - (p3[1] - p1[1]) / 6,
      p2[0],
      p2[1],
    ]);
  }
  if (closed) ops.push(["Z"]);
  return ops;
}

export function ellipsePoints(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  segments = 48,
): LocalPoint[] {
  const points: LocalPoint[] = [];
  for (let index = 0; index < segments; index++) {
    const angle = (index / segments) * Math.PI * 2;
    points.push([cx + Math.cos(angle) * rx, cy + Math.sin(angle) * ry]);
  }
  return points;
}

/** Flattens path commands into a polygon (curves sampled), e.g. for hatching. */
export function opsToPolygon(ops: readonly PathOp[], steps = 6): LocalPoint[] {
  const points: LocalPoint[] = [];
  let cx = 0;
  let cy = 0;
  for (const op of ops) {
    if (op[0] === "M" || op[0] === "L") {
      cx = op[1];
      cy = op[2];
      points.push([cx, cy]);
    } else if (op[0] === "C") {
      for (let step = 1; step <= steps; step++) {
        const t = step / steps;
        const u = 1 - t;
        points.push([
          u * u * u * cx +
            3 * u * u * t * op[1] +
            3 * u * t * t * op[3] +
            t * t * t * op[5],
          u * u * u * cy +
            3 * u * u * t * op[2] +
            3 * u * t * t * op[4] +
            t * t * t * op[6],
        ]);
      }
      cx = op[5];
      cy = op[6];
    }
  }
  return points;
}

// ---------------------------------------------------------------------------
// Hand-drawn strokes

/** One wobbly pass of a straight stroke: a bowed cubic between jittered ends. */
function wobblyLine(
  random: Random,
  from: Pt,
  to: Pt,
  amount: number,
  moveFirst: boolean,
  ops: PathOp[],
): void {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  const nx = length > 0 ? -dy / length : 0;
  const ny = length > 0 ? dx / length : 0;
  const bow = spread(random, amount * 0.9);
  const t1 = 0.25 + random() * 0.15;
  const t2 = 0.6 + random() * 0.15;
  if (moveFirst) ops.push(["M", from.x, from.y]);
  ops.push([
    "C",
    from.x + dx * t1 + nx * bow + spread(random, amount * 0.4),
    from.y + dy * t1 + ny * bow + spread(random, amount * 0.4),
    from.x + dx * t2 + nx * bow + spread(random, amount * 0.4),
    from.y + dy * t2 + ny * bow + spread(random, amount * 0.4),
    to.x,
    to.y,
  ]);
}

function jitter(random: Random, point: Pt, amount: number): Pt {
  return {
    x: point.x + spread(random, amount),
    y: point.y + spread(random, amount),
  };
}

function strokeSegment(
  random: Random,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  level: number,
  passes: number,
  ops: PathOp[],
): void {
  const length = Math.hypot(x2 - x1, y2 - y1);
  const base = wobble(level, length);
  for (let pass = 0; pass < passes; pass++) {
    const amount = pass === 0 ? base : base * 0.75;
    const from = jitter(random, { x: x1, y: y1 }, amount * 0.7);
    const to = jitter(random, { x: x2, y: y2 }, amount * 0.7);
    wobblyLine(random, from, to, amount, true, ops);
  }
}

export function sketchLine(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  options: SketchOptions,
): PathOp[] {
  const level = levelOf(options);
  if (level === 0) {
    return [
      ["M", x1, y1],
      ["L", x2, y2],
    ];
  }
  const ops: PathOp[] = [];
  strokeSegment(
    seededRandom(options.seed),
    x1,
    y1,
    x2,
    y2,
    level,
    passesOf(options),
    ops,
  );
  return ops;
}

/** An open polyline drawn edge by edge, each edge with its own wobble. */
export function sketchPolyline(
  points: readonly LocalPoint[],
  options: SketchOptions,
): PathOp[] {
  const level = levelOf(options);
  if (level === 0 || points.length < 2) return polylineOps(points, false);
  const random = seededRandom(options.seed);
  const ops: PathOp[] = [];
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1] as LocalPoint;
    const b = points[index] as LocalPoint;
    strokeSegment(
      random,
      a[0],
      a[1],
      b[0],
      b[1],
      level,
      passesOf(options),
      ops,
    );
  }
  return ops;
}

/**
 * Wobbles an exact path while keeping each pass continuous: shared vertices
 * get one offset per pass, straight pieces bow, curve handles drift.
 */
export function jitterPath(
  ops: readonly PathOp[],
  random: Random,
  level: number,
  passes: number,
): PathOp[] {
  if (level <= 0) return ops.slice();
  const out: PathOp[] = [];
  for (let pass = 0; pass < passes; pass++) {
    const scale = pass === 0 ? 1 : 0.75;
    let start: Pt = { x: 0, y: 0 };
    let startMoved: Pt = start;
    let current: Pt = start;
    let currentMoved: Pt = start;
    for (const op of ops) {
      if (op[0] === "M") {
        start = { x: op[1], y: op[2] };
        startMoved = jitter(random, start, wobble(level, 40) * 0.5 * scale);
        current = start;
        currentMoved = startMoved;
        out.push(["M", startMoved.x, startMoved.y]);
      } else if (op[0] === "L") {
        const target = { x: op[1], y: op[2] };
        const length = Math.hypot(target.x - current.x, target.y - current.y);
        const amount = wobble(level, length) * scale;
        const moved = jitter(random, target, amount * 0.5);
        wobblyLine(random, currentMoved, moved, amount, false, out);
        current = target;
        currentMoved = moved;
      } else if (op[0] === "C") {
        const target = { x: op[5], y: op[6] };
        const length = Math.hypot(target.x - current.x, target.y - current.y);
        const amount = wobble(level, length) * scale;
        const moved = jitter(random, target, amount * 0.5);
        out.push([
          "C",
          op[1] + spread(random, amount),
          op[2] + spread(random, amount),
          op[3] + spread(random, amount),
          op[4] + spread(random, amount),
          moved.x,
          moved.y,
        ]);
        current = target;
        currentMoved = moved;
      } else {
        if (current.x !== start.x || current.y !== start.y) {
          const length = Math.hypot(start.x - current.x, start.y - current.y);
          wobblyLine(
            random,
            currentMoved,
            startMoved,
            wobble(level, length) * scale,
            false,
            out,
          );
        } else if (
          currentMoved.x !== startMoved.x ||
          currentMoved.y !== startMoved.y
        ) {
          out.push(["L", startMoved.x, startMoved.y]);
        }
        out.push(["Z"]);
        current = start;
        currentMoved = startMoved;
      }
    }
  }
  return out;
}

/**
 * A closed polygon. Without a radius each edge is its own wobbly stroke with
 * slightly overshooting ends; with a radius the rounded outline is wobbled.
 */
export function sketchPolygon(
  points: readonly LocalPoint[],
  options: SketchOptions,
): PathOp[] {
  const level = levelOf(options);
  const radius = options.radius ?? 0;
  if (level === 0) return roundedPolygonOps(points, radius);
  if (points.length < 3) return sketchPolyline(points, options);
  const random = seededRandom(options.seed);
  if (radius > 0) {
    return jitterPath(
      roundedPolygonOps(points, radius),
      random,
      level,
      passesOf(options),
    );
  }
  const ops: PathOp[] = [];
  for (let index = 0; index < points.length; index++) {
    const a = points[index] as LocalPoint;
    const b = points[(index + 1) % points.length] as LocalPoint;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const length = Math.hypot(dx, dy) || 1;
    const over = Math.min(wobble(level, length) * 0.8, length * 0.05) / length;
    strokeSegment(
      random,
      a[0] - dx * over * random(),
      a[1] - dy * over * random(),
      b[0] + dx * over * random(),
      b[1] + dy * over * random(),
      level,
      passesOf(options),
      ops,
    );
  }
  return ops;
}

export function sketchRect(
  x: number,
  y: number,
  w: number,
  h: number,
  options: SketchOptions,
): PathOp[] {
  const r = Math.min(
    Math.max(0, options.radius ?? 0),
    Math.abs(w) / 2,
    Math.abs(h) / 2,
  );
  if (levelOf(options) === 0) return roundedRectOps(x, y, w, h, r);
  return sketchPolygon(
    [
      [x, y],
      [x + w, y],
      [x + w, y + h],
      [x, y + h],
    ],
    { ...options, radius: r },
  );
}

/** A diamond inscribed in the box, optionally with rounded corners. */
export function sketchDiamond(
  x: number,
  y: number,
  w: number,
  h: number,
  options: SketchOptions,
): PathOp[] {
  return sketchPolygon(diamondPoints(x, y, w, h), options);
}

export function diamondPoints(
  x: number,
  y: number,
  w: number,
  h: number,
): LocalPoint[] {
  return [
    [x + w / 2, y],
    [x + w, y + h / 2],
    [x + w / 2, y + h],
    [x, y + h / 2],
  ];
}

/**
 * Each pass walks once around the ellipse through jittered sample points,
 * starting at a random angle and running a little past its start so the
 * ends overlap like a pen that does not quite close the loop.
 */
export function sketchEllipse(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  options: SketchOptions,
): PathOp[] {
  const level = levelOf(options);
  if (level === 0) return ellipseOps(cx, cy, rx, ry);
  const random = seededRandom(options.seed);
  const absX = Math.abs(rx);
  const absY = Math.abs(ry);
  const perimeter =
    Math.PI *
    (3 * (absX + absY) - Math.sqrt((3 * absX + absY) * (absX + 3 * absY)));
  const count = Math.round(clamp(perimeter / 22, 10, 36));
  const minRadius = Math.max(1, Math.min(absX, absY));
  const ops: PathOp[] = [];
  const passes = passesOf(options);
  for (let pass = 0; pass < passes; pass++) {
    const amount = wobble(level, perimeter / count) * (pass === 0 ? 1 : 0.75);
    const begin = random() * Math.PI * 2;
    const overshoot = 0.12 + random() * 0.25 * level;
    const step = (Math.PI * 2) / count;
    const points: LocalPoint[] = [];
    for (let index = 0; index <= count; index++) {
      const angle =
        begin +
        index * step +
        (index > 0 && index < count ? spread(random, step * 0.12) : 0);
      const stretch = 1 + spread(random, (amount / minRadius) * 0.8);
      points.push([
        cx + Math.cos(angle) * absX * stretch,
        cy + Math.sin(angle) * absY * stretch,
      ]);
    }
    const tail = begin + Math.PI * 2 + overshoot;
    points.push([cx + Math.cos(tail) * absX, cy + Math.sin(tail) * absY]);
    ops.push(...splineOps(points));
  }
  return ops;
}

/** A smooth curve through the points; at level > 0 interior points drift. */
export function sketchCurve(
  points: readonly LocalPoint[],
  options: SketchOptions,
): PathOp[] {
  const level = levelOf(options);
  if (level === 0 || points.length < 2) return splineOps(points);
  const random = seededRandom(options.seed);
  const ops: PathOp[] = [];
  const passes = passesOf(options);
  for (let pass = 0; pass < passes; pass++) {
    const moved = points.map((point, index): LocalPoint => {
      const prev = points[Math.max(0, index - 1)] as LocalPoint;
      const next = points[Math.min(points.length - 1, index + 1)] as LocalPoint;
      const length = Math.hypot(next[0] - prev[0], next[1] - prev[1]);
      const amount = wobble(level, length) * (pass === 0 ? 0.8 : 0.6);
      return [
        point[0] + spread(random, amount),
        point[1] + spread(random, amount),
      ];
    });
    if (moved.length === 2) {
      const a = moved[0] as LocalPoint;
      const b = moved[1] as LocalPoint;
      wobblyLine(
        random,
        { x: a[0], y: a[1] },
        { x: b[0], y: b[1] },
        wobble(level, Math.hypot(b[0] - a[0], b[1] - a[1])),
        true,
        ops,
      );
    } else {
      ops.push(...splineOps(moved));
    }
  }
  return ops;
}

/** The fill region for a shape: exact at level 0, gently wobbled otherwise. */
export function sketchFillPath(
  exact: readonly PathOp[],
  options: SketchOptions,
): PathOp[] {
  const level = levelOf(options);
  if (level === 0) return exact.slice();
  return jitterPath(exact, seededRandom(options.seed), level * 0.5, 1);
}

/**
 * Parallel hatch lines `gap` apart at `angle` (radians), clipped to the
 * polygon with an even-odd scanline so concave shapes hatch correctly.
 */
export function hatchFill(
  polygon: readonly LocalPoint[],
  gap: number,
  angle: number,
  sketch?: SketchOptions,
): PathOp[] {
  if (polygon.length < 3 || !(gap > 0) || !Number.isFinite(angle)) return [];
  const cos = Math.cos(-angle);
  const sin = Math.sin(-angle);
  const turned = polygon.map(
    (point): LocalPoint => [
      point[0] * cos - point[1] * sin,
      point[0] * sin + point[1] * cos,
    ],
  );
  let minY = Number.POSITIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of turned) {
    if (point[1] < minY) minY = point[1];
    if (point[1] > maxY) maxY = point[1];
  }
  if (!Number.isFinite(minY) || !Number.isFinite(maxY)) return [];
  // Bounds the work for huge shapes with a tiny gap.
  const step = Math.max(gap, (maxY - minY) / 2000);
  const backCos = Math.cos(angle);
  const backSin = Math.sin(angle);
  const back = (x: number, y: number): LocalPoint => [
    x * backCos - y * backSin,
    x * backSin + y * backCos,
  ];
  const level = sketch ? levelOf(sketch) : 0;
  const random = sketch && level > 0 ? seededRandom(sketch.seed) : null;
  const ops: PathOp[] = [];
  for (let y = minY + step / 2; y < maxY; y += step) {
    const crossings: number[] = [];
    for (let index = 0; index < turned.length; index++) {
      const a = turned[index] as LocalPoint;
      const b = turned[(index + 1) % turned.length] as LocalPoint;
      if (a[1] <= y !== b[1] <= y) {
        crossings.push(a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]));
      }
    }
    crossings.sort((p, q) => p - q);
    for (let index = 0; index + 1 < crossings.length; index += 2) {
      const left = crossings[index] as number;
      const right = crossings[index + 1] as number;
      if (right - left < 0.5) continue;
      const from = back(left, y);
      const to = back(right, y);
      if (random) {
        const amount = Math.min(wobble(level, right - left) * 0.6, gap * 0.3);
        wobblyLine(
          random,
          { x: from[0], y: from[1] },
          { x: to[0], y: to[1] },
          amount,
          true,
          ops,
        );
      } else {
        ops.push(["M", from[0], from[1]], ["L", to[0], to[1]]);
      }
    }
  }
  return ops;
}

/** Dash pattern for a stroke style; empty for solid. */
export function dashPattern(style: string, strokeWidth: number): number[] {
  const width = Math.max(0.5, strokeWidth);
  if (style === "dashed")
    return [Math.max(6, width * 4), Math.max(5, width * 3)];
  // A near-zero dash with round caps draws a row of dots.
  if (style === "dotted") return [0.5, Math.max(4, width * 2.5)];
  return [];
}

function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const rounded = Math.round(value * 100) / 100;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

/** SVG path data for a list of commands. */
export function pathOpsToSvg(ops: readonly PathOp[]): string {
  const parts: string[] = [];
  for (const op of ops) {
    if (op[0] === "Z") parts.push("Z");
    else if (op[0] === "C") {
      parts.push(
        `C${formatNumber(op[1])} ${formatNumber(op[2])} ${formatNumber(op[3])} ${formatNumber(op[4])} ${formatNumber(op[5])} ${formatNumber(op[6])}`,
      );
    } else parts.push(`${op[0]}${formatNumber(op[1])} ${formatNumber(op[2])}`);
  }
  return parts.join("");
}
