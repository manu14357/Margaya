// Outlines of `shape` elements. Every kind is designed in its own convenient
// coordinates and then fitted exactly to the element box (0..width by
// 0..height in element-local units), using the true extent of its curves, so
// every outline touches all four sides of the box and never leaves it.
//
// The first subpath of an outline is the closed silhouette used for fills,
// hit testing and binding; any further subpaths are open detail strokes (the
// visible rim of a cylinder's top).

import { type LocalPoint, SHAPE_KINDS, type ShapeKind } from "./elements.js";
import type { PathOp } from "./render/types.js";

/** A rectangle in element-local units. */
export type ShapeTextBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type Design = { ops: PathOp[]; text: ShapeTextBox };

const KAPPA = 0.5522847498;
const EPSILON = 1e-9;

export function isShapeKind(value: unknown): value is ShapeKind {
  return (
    typeof value === "string" &&
    (SHAPE_KINDS as readonly string[]).includes(value)
  );
}

const size = (value: number) =>
  Number.isFinite(value) && value > 0 ? value : 0;

function polygon(points: readonly LocalPoint[]): PathOp[] {
  const ops: PathOp[] = [];
  points.forEach(([x, y], index) => {
    ops.push(index === 0 ? ["M", x, y] : ["L", x, y]);
  });
  ops.push(["Z"]);
  return ops;
}

const area = (x: number, y: number, width: number, height: number) => ({
  x,
  y,
  width: Math.max(0, width),
  height: Math.max(0, height),
});

/** Points of a regular polygon (or star) on the unit circle, first at the top. */
function radialPoints(count: number, innerRatio?: number): LocalPoint[] {
  const total = innerRatio === undefined ? count : count * 2;
  const points: LocalPoint[] = [];
  for (let index = 0; index < total; index++) {
    const angle = -Math.PI / 2 + (index / total) * Math.PI * 2;
    const radius = innerRatio !== undefined && index % 2 === 1 ? innerRatio : 1;
    points.push([Math.cos(angle) * radius, Math.sin(angle) * radius]);
  }
  return points;
}

/** The t values in (0, 1) where one axis of a cubic turns around. */
function cubicTurns(p0: number, p1: number, p2: number, p3: number): number[] {
  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const b = 2 * (p0 - 2 * p1 + p2);
  const c = p1 - p0;
  const roots: number[] = [];
  if (Math.abs(a) < EPSILON) {
    if (Math.abs(b) > EPSILON) roots.push(-c / b);
  } else {
    const discriminant = b * b - 4 * a * c;
    if (discriminant >= 0) {
      const root = Math.sqrt(discriminant);
      roots.push((-b + root) / (2 * a), (-b - root) / (2 * a));
    }
  }
  return roots.filter((t) => t > 0 && t < 1);
}

function cubicAt(p0: number, p1: number, p2: number, p3: number, t: number) {
  const u = 1 - t;
  return (
    u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3
  );
}

/** The exact extent of a path, curves included. */
function pathExtent(ops: readonly PathOp[]) {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  const includeX = (x: number) => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
  };
  const includeY = (y: number) => {
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  };
  let cx = 0;
  let cy = 0;
  for (const op of ops) {
    if (op[0] === "Z") continue;
    if (op[0] === "C") {
      for (const t of cubicTurns(cx, op[1], op[3], op[5])) {
        includeX(cubicAt(cx, op[1], op[3], op[5], t));
      }
      for (const t of cubicTurns(cy, op[2], op[4], op[6])) {
        includeY(cubicAt(cy, op[2], op[4], op[6], t));
      }
      cx = op[5];
      cy = op[6];
    } else {
      cx = op[1];
      cy = op[2];
    }
    includeX(cx);
    includeY(cy);
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}

/** Scales a design (outline and label box) so its true extent becomes 0..w by 0..h. */
function fitToBox(design: Design, w: number, h: number): Design {
  const extent = pathExtent(design.ops);
  const spanX = extent.maxX - extent.minX;
  const spanY = extent.maxY - extent.minY;
  const sx = spanX > EPSILON ? w / spanX : 0;
  const sy = spanY > EPSILON ? h / spanY : 0;
  const mx = (x: number) => (sx === 0 ? 0 : (x - extent.minX) * sx);
  const my = (y: number) => (sy === 0 ? 0 : (y - extent.minY) * sy);
  const ops = design.ops.map((op): PathOp => {
    if (op[0] === "Z") return op;
    if (op[0] === "C") {
      return [
        "C",
        mx(op[1]),
        my(op[2]),
        mx(op[3]),
        my(op[4]),
        mx(op[5]),
        my(op[6]),
      ];
    }
    return [op[0], mx(op[1]), my(op[2])];
  });
  const { text } = design;
  return {
    ops,
    text: area(mx(text.x), my(text.y), text.width * sx, text.height * sy),
  };
}

/** A block arrow pointing along +u, `length` long and `thickness` wide. */
function blockArrow(length: number, thickness: number): Design {
  const head = Math.min(length * 0.45, thickness);
  const neck = length - head;
  const top = thickness * 0.25;
  const bottom = thickness * 0.75;
  return {
    ops: polygon([
      [0, top],
      [neck, top],
      [neck, 0],
      [length, thickness / 2],
      [neck, thickness],
      [neck, bottom],
      [0, bottom],
    ]),
    text: area(
      length * 0.03,
      thickness * 0.28,
      length * 0.97 - head * 0.55,
      thickness * 0.44,
    ),
  };
}

type Direction = "right" | "left" | "up" | "down";

/** Turns a +u block arrow into one of the four directions inside a w x h box. */
function directedArrow(direction: Direction, w: number, h: number): Design {
  const along = direction === "right" || direction === "left";
  const length = along ? w : h;
  const base = blockArrow(length, along ? h : w);
  const place = (u: number, v: number): LocalPoint => {
    switch (direction) {
      case "right":
        return [u, v];
      case "left":
        return [length - u, v];
      case "down":
        return [v, u];
      case "up":
        return [v, length - u];
    }
  };
  const ops = base.ops.map((op): PathOp => {
    if (op[0] !== "M" && op[0] !== "L") return op;
    const [x, y] = place(op[1], op[2]);
    return [op[0], x, y];
  });
  const a = place(base.text.x, base.text.y);
  const b = place(
    base.text.x + base.text.width,
    base.text.y + base.text.height,
  );
  return {
    ops,
    text: area(
      Math.min(a[0], b[0]),
      Math.min(a[1], b[1]),
      Math.abs(b[0] - a[0]),
      Math.abs(b[1] - a[1]),
    ),
  };
}

/** Puffs between valley points on an ellipse, each lobe bulging outwards. */
function cloudDesign(): Design {
  const rx = 1;
  const ry = 0.62;
  const bulges = [0.8, 0.95, 0.9, 0.8, 0.6, 0.55, 0.55, 0.6];
  const count = bulges.length;
  const valley = (index: number) => {
    const angle = Math.PI + (index / count) * Math.PI * 2;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const nx = cos / rx;
    const ny = sin / ry;
    const length = Math.hypot(nx, ny) || 1;
    return { x: cos * rx, y: sin * ry, nx: nx / length, ny: ny / length };
  };
  const first = valley(0);
  const ops: PathOp[] = [["M", first.x, first.y]];
  for (let index = 0; index < count; index++) {
    const a = valley(index);
    const b = valley((index + 1) % count);
    const reach = Math.hypot(b.x - a.x, b.y - a.y) * (bulges[index] ?? 0.7);
    ops.push([
      "C",
      a.x + a.nx * reach,
      a.y + a.ny * reach,
      b.x + b.nx * reach,
      b.y + b.ny * reach,
      b.x,
      b.y,
    ]);
  }
  ops.push(["Z"]);
  const inset = Math.SQRT1_2 * 0.95;
  return {
    ops,
    text: area(-rx * inset, -ry * inset, rx * inset * 2, ry * inset * 2),
  };
}

const CLOUD = cloudDesign();

const HEART: Design = {
  ops: [
    ["M", 0.5, 1],
    ["C", 0.3, 0.85, 0, 0.6, 0, 0.3],
    ["C", 0, 0.12, 0.12, 0, 0.25, 0],
    ["C", 0.38, 0, 0.5, 0.1, 0.5, 0.25],
    ["C", 0.5, 0.1, 0.62, 0, 0.75, 0],
    ["C", 0.88, 0, 1, 0.12, 1, 0.3],
    ["C", 1, 0.6, 0.7, 0.85, 0.5, 1],
    ["Z"],
  ],
  text: area(0.2, 0.3, 0.6, 0.32),
};

// A crescent opening to the right: a broad outer arc, a shallower inner arc.
const MOON: Design = {
  ops: [
    ["M", 0.7, 0],
    ["C", 0.3, -0.02, 0, 0.22, 0, 0.5],
    ["C", 0, 0.78, 0.3, 1.02, 0.7, 1],
    ["C", 0.45, 0.88, 0.32, 0.7, 0.32, 0.5],
    ["C", 0.32, 0.3, 0.45, 0.12, 0.7, 0],
    ["Z"],
  ],
  text: area(0.07, 0.38, 0.2, 0.24),
};

function speechDesign(w: number, h: number): Design {
  const body = h * 0.76;
  const r = Math.min(Math.min(w, h) * 0.12, body / 2, w / 2);
  const k = r * KAPPA;
  const tipX = w * 0.12;
  const left = Math.max(w * 0.22, r);
  const right = Math.min(Math.max(w * 0.4, left), w - r);
  const drop = h - body;
  const ops: PathOp[] = [
    ["M", r, 0],
    ["L", w - r, 0],
    ["C", w - r + k, 0, w, r - k, w, r],
    ["L", w, body - r],
    ["C", w, body - r + k, w - r + k, body, w - r, body],
    ["L", right, body],
    [
      "C",
      right - (right - tipX) * 0.3,
      body + drop * 0.45,
      tipX + (right - tipX) * 0.25,
      h - drop * 0.15,
      tipX,
      h,
    ],
    [
      "C",
      tipX + (left - tipX) * 0.6,
      h - drop * 0.35,
      left,
      body + drop * 0.3,
      left,
      body,
    ],
    ["L", r, body],
    ["C", r - k, body, 0, body - r + k, 0, body - r],
    ["L", 0, r],
    ["C", 0, r - k, r - k, 0, r, 0],
    ["Z"],
  ];
  const insetX = Math.max(w * 0.04, r * 0.3);
  const insetY = Math.max(body * 0.06, r * 0.3);
  return {
    ops,
    text: area(insetX, insetY, w - insetX * 2, body - insetY * 2),
  };
}

function cylinderDesign(w: number, h: number): Design {
  const ry = Math.min(h * 0.15, w * 0.3);
  const kx = (w / 2) * KAPPA;
  const ky = ry * KAPPA;
  const mid = w / 2;
  const ops: PathOp[] = [
    ["M", 0, ry],
    ["C", 0, ry - ky, mid - kx, 0, mid, 0],
    ["C", mid + kx, 0, w, ry - ky, w, ry],
    ["L", w, h - ry],
    ["C", w, h - ry + ky, mid + kx, h, mid, h],
    ["C", mid - kx, h, 0, h - ry + ky, 0, h - ry],
    ["Z"],
    // The near half of the top rim.
    ["M", 0, ry],
    ["C", 0, ry + ky, mid - kx, ry * 2, mid, ry * 2],
    ["C", mid + kx, ry * 2, w, ry + ky, w, ry],
  ];
  return {
    ops,
    text: area(w * 0.05, ry * 2 + h * 0.03, w * 0.9, h - ry * 3 - h * 0.06),
  };
}

function documentDesign(w: number, h: number): Design {
  const wave = h * 0.18;
  const base = h - wave;
  return {
    ops: [
      ["M", 0, 0],
      ["L", w, 0],
      ["L", w, base],
      ["C", w * 0.65, base - wave * 1.6, w * 0.35, base + wave * 1.6, 0, base],
      ["Z"],
    ],
    text: area(w * 0.05, h * 0.06, w * 0.9, base - wave * 0.5 - h * 0.06),
  };
}

const PENTAGON: Design = {
  ops: polygon(radialPoints(5)),
  text: area(-0.57, -0.45, 1.14, 1.11),
};

const STAR: Design = {
  ops: polygon(radialPoints(5, 0.382)),
  text: area(-0.25, -0.18, 0.5, 0.36),
};

function design(kind: ShapeKind, w: number, h: number): Design {
  switch (kind) {
    case "triangle":
      return {
        ops: polygon([
          [w / 2, 0],
          [w, h],
          [0, h],
        ]),
        text: area(w * 0.25, h * 0.55, w * 0.5, h * 0.4),
      };
    case "rightTriangle":
      return {
        ops: polygon([
          [0, 0],
          [w, h],
          [0, h],
        ]),
        text: area(w * 0.05, h * 0.55, w * 0.4, h * 0.4),
      };
    case "pentagon":
      return PENTAGON;
    case "hexagon": {
      const inset = Math.min(w * 0.25, h * 0.29);
      return {
        ops: polygon([
          [inset, 0],
          [w - inset, 0],
          [w, h / 2],
          [w - inset, h],
          [inset, h],
          [0, h / 2],
        ]),
        text: area(inset * 0.8, h * 0.12, w - inset * 1.6, h * 0.76),
      };
    }
    case "octagon": {
      const cut = Math.min(w, h) * 0.29;
      return {
        ops: polygon([
          [cut, 0],
          [w - cut, 0],
          [w, cut],
          [w, h - cut],
          [w - cut, h],
          [cut, h],
          [0, h - cut],
          [0, cut],
        ]),
        text: area(cut * 0.55, cut * 0.55, w - cut * 1.1, h - cut * 1.1),
      };
    }
    case "star":
      return STAR;
    case "parallelogram": {
      const skew = Math.min(w * 0.25, h * 0.5);
      return {
        ops: polygon([
          [skew, 0],
          [w, 0],
          [w - skew, h],
          [0, h],
        ]),
        text: area(skew, h * 0.06, w - skew * 2, h * 0.88),
      };
    }
    case "trapezoid": {
      const inset = Math.min(w * 0.2, h * 0.5);
      return {
        ops: polygon([
          [inset, 0],
          [w - inset, 0],
          [w, h],
          [0, h],
        ]),
        text: area(inset, h * 0.06, w - inset * 2, h * 0.88),
      };
    }
    case "plus": {
      const [a, b] = [w / 3, (w * 2) / 3];
      const [c, d] = [h / 3, (h * 2) / 3];
      return {
        ops: polygon([
          [a, 0],
          [b, 0],
          [b, c],
          [w, c],
          [w, d],
          [b, d],
          [b, h],
          [a, h],
          [a, d],
          [0, d],
          [0, c],
          [a, c],
        ]),
        text: area(w * 0.03, c + h * 0.02, w * 0.94, h / 3 - h * 0.04),
      };
    }
    case "cross": {
      const d = 0.2;
      const unit: LocalPoint[] = [
        [d, 0],
        [0.5, 0.5 - d],
        [1 - d, 0],
        [1, d],
        [0.5 + d, 0.5],
        [1, 1 - d],
        [1 - d, 1],
        [0.5, 0.5 + d],
        [d, 1],
        [0, 1 - d],
        [0.5 - d, 0.5],
        [0, d],
      ];
      return {
        ops: polygon(unit.map(([x, y]) => [x * w, y * h])),
        text: area(w * 0.32, h * 0.32, w * 0.36, h * 0.36),
      };
    }
    case "heart":
      return HEART;
    case "cloud":
      return CLOUD;
    case "speech":
      return speechDesign(w, h);
    case "cylinder":
      return cylinderDesign(w, h);
    case "document":
      return documentDesign(w, h);
    case "arrowRight":
      return directedArrow("right", w, h);
    case "arrowLeft":
      return directedArrow("left", w, h);
    case "arrowUp":
      return directedArrow("up", w, h);
    case "arrowDown":
      return directedArrow("down", w, h);
    case "arrowDouble": {
      const head = Math.min(w * 0.3, h);
      return {
        ops: polygon([
          [0, h / 2],
          [head, 0],
          [head, h * 0.25],
          [w - head, h * 0.25],
          [w - head, 0],
          [w, h / 2],
          [w - head, h],
          [w - head, h * 0.75],
          [head, h * 0.75],
          [head, h],
        ]),
        text: area(head * 0.5, h * 0.28, w - head, h * 0.44),
      };
    }
    case "chevron": {
      const notch = Math.min(w * 0.3, h * 0.5);
      return {
        ops: polygon([
          [0, 0],
          [w - notch, 0],
          [w, h / 2],
          [w - notch, h],
          [0, h],
          [notch, h / 2],
        ]),
        text: area(notch, h * 0.05, w - notch * 2, h * 0.9),
      };
    }
    case "moon":
      return MOON;
    default:
      // Unknown kinds (from a newer client) draw as their box.
      return {
        ops: polygon([
          [0, 0],
          [w, 0],
          [w, h],
          [0, h],
        ]),
        text: area(w * 0.05, h * 0.05, w * 0.9, h * 0.9),
      };
  }
}

const fitted = (kind: ShapeKind, width: number, height: number) => {
  const w = size(width);
  const h = size(height);
  return fitToBox(design(kind, w, h), w, h);
};

/**
 * The exact outline of a shape kind inside a `width` x `height` box: a closed
 * silhouette first, then any open detail strokes.
 */
export function shapeOutline(
  kind: ShapeKind,
  width: number,
  height: number,
): PathOp[] {
  return fitted(kind, width, height).ops;
}

/** The closed silhouette alone (the first subpath of `shapeOutline`). */
export function shapeSilhouette(
  kind: ShapeKind,
  width: number,
  height: number,
): PathOp[] {
  const ops = shapeOutline(kind, width, height);
  const end = ops.findIndex((op) => op[0] === "Z");
  return end < 0 ? ops : ops.slice(0, end + 1);
}

/** The open detail strokes drawn on top of the silhouette (may be empty). */
export function shapeDetails(
  kind: ShapeKind,
  width: number,
  height: number,
): PathOp[] {
  const ops = shapeOutline(kind, width, height);
  const end = ops.findIndex((op) => op[0] === "Z");
  return end < 0 ? [] : ops.slice(end + 1);
}

/** The corners of a kind whose silhouette is a straight-sided polygon, else null. */
export function shapeVertices(
  kind: ShapeKind,
  width: number,
  height: number,
): LocalPoint[] | null {
  const ops = shapeSilhouette(kind, width, height);
  const points: LocalPoint[] = [];
  for (const op of ops) {
    if (op[0] === "C") return null;
    if (op[0] === "M" || op[0] === "L") points.push([op[1], op[2]]);
  }
  return points;
}

const polygonCache = new Map<string, readonly LocalPoint[]>();
const POLYGON_CACHE_LIMIT = 512;

/**
 * The silhouette flattened to a polygon (curves sampled `segments` times
 * each), for hit testing, binding and hatch fills. The result is shared and
 * must not be changed.
 */
export function shapePolygon(
  kind: ShapeKind,
  width: number,
  height: number,
  segments = 8,
): readonly LocalPoint[] {
  const steps = Math.max(1, Math.min(64, Math.round(segments) || 1));
  const key = `${kind}|${width}|${height}|${steps}`;
  const cached = polygonCache.get(key);
  if (cached) return cached;
  const points: LocalPoint[] = [];
  let cx = 0;
  let cy = 0;
  for (const op of shapeSilhouette(kind, width, height)) {
    if (op[0] === "M" || op[0] === "L") {
      cx = op[1];
      cy = op[2];
      points.push([cx, cy]);
    } else if (op[0] === "C") {
      for (let step = 1; step <= steps; step++) {
        const t = step / steps;
        points.push([
          cubicAt(cx, op[1], op[3], op[5], t),
          cubicAt(cy, op[2], op[4], op[6], t),
        ]);
      }
      cx = op[5];
      cy = op[6];
    }
  }
  const first = points[0];
  const last = points[points.length - 1];
  if (
    points.length > 1 &&
    first &&
    last &&
    Math.abs(first[0] - last[0]) < EPSILON &&
    Math.abs(first[1] - last[1]) < EPSILON
  ) {
    points.pop();
  }
  if (polygonCache.size >= POLYGON_CACHE_LIMIT) polygonCache.clear();
  polygonCache.set(key, points);
  return points;
}

/** The rectangle inside the shape where its label is laid out. */
export function shapeTextBox(
  kind: ShapeKind,
  width: number,
  height: number,
): ShapeTextBox {
  return fitted(kind, width, height).text;
}

/** The kind that a mirror image of `kind` looks like (block arrows swap). */
export function flipShapeKind(
  kind: ShapeKind,
  axis: "horizontal" | "vertical",
): ShapeKind {
  if (axis === "horizontal") {
    if (kind === "arrowRight") return "arrowLeft";
    if (kind === "arrowLeft") return "arrowRight";
  } else {
    if (kind === "arrowUp") return "arrowDown";
    if (kind === "arrowDown") return "arrowUp";
  }
  return kind;
}
