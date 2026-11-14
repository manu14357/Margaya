// Board geometry: boxes, hit testing, binding ends, transforms, alignment,
// orthogonal routing and snapping. Every function is pure; transforms return
// stamped copies (see `updateElement`) of the elements they changed.

import {
  type ElementOptions,
  type ElementPatch,
  updateElement,
} from "./create.js";
import type {
  ArrowElement,
  BoardElement,
  DrawElement,
  LinearElement,
  LineElement,
  LocalPoint,
  ShapeElement,
} from "./elements.js";
import { BOARD_LIMITS } from "./elements.js";
import { sortByOrder } from "./order.js";
import { penSize } from "./render/shapes.js";
import { flipShapeKind, shapePolygon } from "./shapes.js";

export type Point = { x: number; y: number };
export type Box = { x: number; y: number; width: number; height: number };
export type ResizeHandle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
/** `horizontal` mirrors left-right; `vertical` mirrors top-bottom. */
export type FlipAxis = "horizontal" | "vertical";
export type AlignEdge =
  | "left"
  | "center"
  | "right"
  | "top"
  | "middle"
  | "bottom";
export type DistributeAxis = "horizontal" | "vertical";
/** A snapping guide: a vertical line (`axis: "x"`) at x = `at` from y = `start` to `end`, or the horizontal equivalent. */
export type SnapGuide = {
  axis: "x" | "y";
  at: number;
  start: number;
  end: number;
};

type PointElement = ArrowElement | LineElement | DrawElement;

/** Height of a frame's title strip, drawn just above the frame. */
export const FRAME_TITLE_HEIGHT = 24;
/** Clearance an elbow route keeps around the boxes it connects. */
export const ELBOW_PADDING = 24;

const TURN = Math.PI * 2;
const EPSILON = 1e-9;

export const isLinear = (element: BoardElement): element is LinearElement =>
  element.type === "arrow" || element.type === "line";

export const hasPoints = (element: BoardElement): element is PointElement =>
  element.type === "arrow" ||
  element.type === "line" ||
  element.type === "draw";

/** True when the element paints its inside (so a click inside selects it). */
export function isFilled(element: BoardElement): boolean {
  if (
    element.type === "sticky" ||
    element.type === "text" ||
    element.type === "image" ||
    element.type === "task"
  ) {
    return true;
  }
  return (
    element.fillStyle !== "none" &&
    element.fillColor !== "transparent" &&
    !/^#(?:[0-9a-f]{3}0|[0-9a-f]{6}00)$/i.test(element.fillColor)
  );
}

function normalizeAngle(angle: number): number {
  const normalized = angle % TURN;
  return normalized < 0 ? normalized + TURN : normalized;
}

export function rotatePoint(point: Point, center: Point, angle: number): Point {
  if (angle === 0) return { x: point.x, y: point.y };
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return {
    x: center.x + dx * cos - dy * sin,
    y: center.y + dx * sin + dy * cos,
  };
}

export function boxCenter(box: Box): Point {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

function boxFromPoints(points: readonly Point[]): Box {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  if (points.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function unionBoxes(boxes: readonly Box[]): Box | null {
  if (boxes.length === 0) return null;
  return boxFromPoints(
    boxes.flatMap((box) => [
      { x: box.x, y: box.y },
      { x: box.x + box.width, y: box.y + box.height },
    ]),
  );
}

export function expandBox(box: Box, by: number): Box {
  return {
    x: box.x - by,
    y: box.y - by,
    width: box.width + by * 2,
    height: box.height + by * 2,
  };
}

export function boxContainsPoint(box: Box, point: Point): boolean {
  return (
    point.x >= box.x &&
    point.x <= box.x + box.width &&
    point.y >= box.y &&
    point.y <= box.y + box.height
  );
}

export function boxContainsBox(outer: Box, inner: Box): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

export function boxesIntersect(a: Box, b: Box): boolean {
  return (
    a.x <= b.x + b.width &&
    b.x <= a.x + a.width &&
    a.y <= b.y + b.height &&
    b.y <= a.y + a.height
  );
}

/** The element's box before rotation. For lines and drawings, the box around their points. */
export function elementBox(element: BoardElement): Box {
  if (hasPoints(element)) {
    const box = boxFromPoints(
      element.points.map(([px, py]) => ({
        x: element.x + px,
        y: element.y + py,
      })),
    );
    return box;
  }
  return {
    x: element.x,
    y: element.y,
    width: Math.max(0, element.width),
    height: Math.max(0, element.height),
  };
}

export function elementCenter(element: BoardElement): Point {
  return boxCenter(elementBox(element));
}

/** Points of a line or drawing in board coordinates, rotation applied. */
export function worldPoints(element: PointElement): Point[] {
  const center = elementCenter(element);
  return element.points.map(([px, py]) =>
    rotatePoint(
      { x: element.x + px, y: element.y + py },
      center,
      element.angle,
    ),
  );
}

function corners(box: Box): Point[] {
  return [
    { x: box.x, y: box.y },
    { x: box.x + box.width, y: box.y },
    { x: box.x + box.width, y: box.y + box.height },
    { x: box.x, y: box.y + box.height },
  ];
}

/** The axis-aligned box around the element after rotation. */
export function elementBounds(element: BoardElement): Box {
  if (hasPoints(element)) return boxFromPoints(worldPoints(element));
  const box = elementBox(element);
  if (element.angle === 0) return box;
  const center = boxCenter(box);
  // A shape's outline touches every side of its box, so only a rotated one
  // needs its real outline for a tight fit.
  const outline =
    element.type === "shape" ? outlinePolygon(element, box) : corners(box);
  return boxFromPoints(
    outline.map((corner) => rotatePoint(corner, center, element.angle)),
  );
}

/** The box around every live element, or null for an empty board. */
export function sceneBounds(elements: readonly BoardElement[]): Box | null {
  return unionBoxes(
    elements.filter((element) => !element.deleted).map(elementBounds),
  );
}

export function distanceToSegment(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  let t = 0;
  if (lengthSquared > EPSILON) {
    t = ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared;
    t = Math.max(0, Math.min(1, t));
  }
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

function distanceToPolyline(point: Point, points: readonly Point[]): number {
  if (points.length === 1) {
    return Math.hypot(point.x - points[0].x, point.y - points[0].y);
  }
  let best = Number.POSITIVE_INFINITY;
  for (let i = 1; i < points.length; i++) {
    best = Math.min(best, distanceToSegment(point, points[i - 1], points[i]));
  }
  return best;
}

/** Samples a smooth curve through the points (Catmull-Rom style). */
export function smoothCurve(points: readonly Point[], steps = 8): Point[] {
  if (points.length < 3) return [...points];
  const out: Point[] = [points[0]];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    for (let step = 1; step <= steps; step++) {
      const t = step / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      const blend = (a: number, b: number, c: number, d: number) =>
        0.5 *
        (2 * b +
          (c - a) * t +
          (2 * a - 5 * b + 4 * c - d) * t2 +
          (3 * b - a - 3 * c + d) * t3);
      out.push({
        x: blend(p0.x, p1.x, p2.x, p3.x),
        y: blend(p0.y, p1.y, p2.y, p3.y),
      });
    }
  }
  return out;
}

function pointInPolygon(point: Point, polygon: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

function diamondPoints(box: Box): Point[] {
  const center = boxCenter(box);
  return [
    { x: center.x, y: box.y },
    { x: box.x + box.width, y: center.y },
    { x: center.x, y: box.y + box.height },
    { x: box.x, y: center.y },
  ];
}

/** A shape element's outline in its unrotated frame (board units). */
function outlinePolygon(element: ShapeElement, box: Box): Point[] {
  return shapePolygon(element.shape, box.width, box.height).map(([px, py]) => ({
    x: box.x + px,
    y: box.y + py,
  }));
}

function polygonSignedDistance(
  point: Point,
  polygon: readonly Point[],
): number {
  const distance = distanceToPolyline(point, [...polygon, polygon[0]]);
  return pointInPolygon(point, polygon) ? -distance : distance;
}

function roundedBoxSignedDistance(
  point: Point,
  box: Box,
  radius: number,
): number {
  const halfW = box.width / 2;
  const halfH = box.height / 2;
  const r = Math.max(0, Math.min(radius, halfW, halfH));
  const center = boxCenter(box);
  const qx = Math.abs(point.x - center.x) - (halfW - r);
  const qy = Math.abs(point.y - center.y) - (halfH - r);
  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  const inside = Math.min(Math.max(qx, qy), 0);
  return outside + inside - r;
}

/** Distance to the ellipse outline, negative inside. */
function ellipseSignedDistance(point: Point, box: Box): number {
  const a = box.width / 2;
  const b = box.height / 2;
  const center = boxCenter(box);
  const px = Math.abs(point.x - center.x);
  const py = Math.abs(point.y - center.y);
  if (a < EPSILON || b < EPSILON) {
    // A flat ellipse is a segment.
    return a < EPSILON
      ? distanceToSegment({ x: px, y: py }, { x: 0, y: -b }, { x: 0, y: b })
      : distanceToSegment({ x: px, y: py }, { x: -a, y: 0 }, { x: a, y: 0 });
  }
  // Newton steps on the angle of the nearest outline point (first quadrant).
  let t = Math.atan2(a * py, b * px);
  for (let i = 0; i < 6; i++) {
    const cos = Math.cos(t);
    const sin = Math.sin(t);
    const f = (a * a - b * b) * sin * cos - px * a * sin + py * b * cos;
    const df =
      (a * a - b * b) * (cos * cos - sin * sin) - px * a * cos - py * b * sin;
    if (Math.abs(df) < EPSILON) break;
    t = Math.max(0, Math.min(Math.PI / 2, t - f / df));
  }
  const distance = Math.hypot(px - a * Math.cos(t), py - b * Math.sin(t));
  const inside = (px / a) ** 2 + (py / b) ** 2 <= 1;
  return inside ? -distance : distance;
}

function frameTitleBox(box: Box): Box {
  return {
    x: box.x,
    y: box.y - FRAME_TITLE_HEIGHT,
    width: box.width,
    height: FRAME_TITLE_HEIGHT,
  };
}

/** Distance from a point in the element's unrotated frame to its shape (negative inside). */
function shapeSignedDistance(element: BoardElement, local: Point): number {
  const box = elementBox(element);
  switch (element.type) {
    case "ellipse":
      return ellipseSignedDistance(local, box);
    case "diamond":
      return polygonSignedDistance(local, diamondPoints(box));
    case "rectangle":
      return roundedBoxSignedDistance(local, box, element.cornerRadius);
    case "shape":
      return polygonSignedDistance(local, outlinePolygon(element, box));
    default:
      return roundedBoxSignedDistance(local, box, 0);
  }
}

function toLocal(element: BoardElement, point: Point): Point {
  if (element.angle === 0) return point;
  return rotatePoint(point, elementCenter(element), -element.angle);
}

function localPolyline(element: PointElement): Point[] {
  const points = element.points.map(([px, py]) => ({
    x: element.x + px,
    y: element.y + py,
  }));
  return isLinear(element) && element.routing === "curved"
    ? smoothCurve(points)
    : points;
}

/**
 * True when `point` (board coordinates) touches the element. Unfilled
 * shapes count only near their outline (or on a label); filled shapes,
 * stickies, text, images and task cards count anywhere inside; frames count
 * on their outline and title strip; lines and drawings by distance.
 */
export function hitTest(
  element: BoardElement,
  point: Point,
  tolerance: number,
): boolean {
  if (element.deleted) return false;
  const local = toLocal(element, point);
  const reach = tolerance + element.strokeWidth / 2;
  if (hasPoints(element)) {
    // A pen stroke's ink is wider than its stroke width (a highlighter much
    // wider), so a click anywhere on the visible ink must count.
    const ink =
      element.type === "draw"
        ? tolerance + penSize(element.penStyle, element.strokeWidth) / 2
        : reach;
    return distanceToPolyline(local, localPolyline(element)) <= ink;
  }
  if (element.type === "frame") {
    const box = elementBox(element);
    if (boxContainsPoint(frameTitleBox(box), local)) return true;
    return Math.abs(shapeSignedDistance(element, local)) <= reach;
  }
  const distance = shapeSignedDistance(element, local);
  const solid =
    isFilled(element) || ("text" in element && element.text.trim().length > 0);
  return solid ? distance <= reach : Math.abs(distance) <= reach;
}

/** Live elements whose rotated bounds are fully inside (or touch) `box`. */
export function elementsInBox(
  elements: readonly BoardElement[],
  box: Box,
  options?: { fullyInside?: boolean },
): BoardElement[] {
  const fully = options?.fullyInside ?? true;
  return elements.filter((element) => {
    if (element.deleted) return false;
    const bounds = elementBounds(element);
    return fully ? boxContainsBox(box, bounds) : boxesIntersect(box, bounds);
  });
}

/** The top-most live element under the point, or null. */
export function topElementAt(
  elements: readonly BoardElement[],
  point: Point,
  tolerance: number,
): BoardElement | null {
  const sorted = sortByOrder(elements);
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (hitTest(sorted[i], point, tolerance)) return sorted[i];
  }
  return null;
}

/** Elements a line end can attach to. */
export function isBindable(element: BoardElement): boolean {
  return !element.deleted && !hasPoints(element);
}

/**
 * The top-most element a line end dropped at `point` should bind to: the
 * point is inside the shape or within `tolerance` of its outline.
 */
export function findBindTarget(
  elements: readonly BoardElement[],
  point: Point,
  tolerance: number,
  excludeIds?: ReadonlySet<string>,
): BoardElement | null {
  const sorted = sortByOrder(elements);
  for (let i = sorted.length - 1; i >= 0; i--) {
    const element = sorted[i];
    if (!isBindable(element) || excludeIds?.has(element.id)) continue;
    if (shapeSignedDistance(element, toLocal(element, point)) <= tolerance) {
      return element;
    }
  }
  return null;
}

/** The binding focus (fractions of the element's box) for a board point. */
export function focusFor(
  element: BoardElement,
  point: Point,
): readonly [number, number] {
  const box = elementBox(element);
  const local = toLocal(element, point);
  const fx = box.width > EPSILON ? (local.x - box.x) / box.width : 0.5;
  const fy = box.height > EPSILON ? (local.y - box.y) / box.height : 0.5;
  return [Math.max(0, Math.min(1, fx)), Math.max(0, Math.min(1, fy))];
}

/** The board point a binding focus refers to. */
export function focusPoint(
  element: BoardElement,
  focus: readonly [number, number],
): Point {
  const box = elementBox(element);
  return rotatePoint(
    { x: box.x + focus[0] * box.width, y: box.y + focus[1] * box.height },
    boxCenter(box),
    element.angle,
  );
}

/** Parameters t (along a→b) where the segment crosses another segment. */
function segmentCrossing(
  a: Point,
  b: Point,
  c: Point,
  d: Point,
): number | null {
  const rx = b.x - a.x;
  const ry = b.y - a.y;
  const sx = d.x - c.x;
  const sy = d.y - c.y;
  const denominator = rx * sy - ry * sx;
  if (Math.abs(denominator) < EPSILON) return null;
  const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / denominator;
  const u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / denominator;
  return u >= -EPSILON && u <= 1 + EPSILON ? t : null;
}

/** Parameters t along from→to where the line crosses the shape outline. */
function outlineCrossings(
  element: BoardElement,
  from: Point,
  to: Point,
): number[] {
  const box = elementBox(element);
  if (
    element.type === "ellipse" &&
    box.width > EPSILON &&
    box.height > EPSILON
  ) {
    const center = boxCenter(box);
    const a = box.width / 2;
    const b = box.height / 2;
    const ox = (from.x - center.x) / a;
    const oy = (from.y - center.y) / b;
    const dx = (to.x - from.x) / a;
    const dy = (to.y - from.y) / b;
    const qa = dx * dx + dy * dy;
    const qb = 2 * (ox * dx + oy * dy);
    const qc = ox * ox + oy * oy - 1;
    const discriminant = qb * qb - 4 * qa * qc;
    if (qa < EPSILON || discriminant < 0) return [];
    const root = Math.sqrt(discriminant);
    return [(-qb - root) / (2 * qa), (-qb + root) / (2 * qa)];
  }
  const polygon =
    element.type === "diamond"
      ? diamondPoints(box)
      : element.type === "shape"
        ? outlinePolygon(element, box)
        : corners(box);
  const hits: number[] = [];
  for (let i = 0; i < polygon.length; i++) {
    const t = segmentCrossing(
      from,
      to,
      polygon[i],
      polygon[(i + 1) % polygon.length],
    );
    if (t !== null) hits.push(t);
  }
  return hits;
}

/**
 * Where a line coming from `from` and aimed at the binding focus stops: on
 * the element's outline, pulled back towards `from` by `gap`. When `from`
 * lies inside the element, the focus point itself.
 */
export function pointOnOutline(
  element: BoardElement,
  focus: readonly [number, number],
  gap: number,
  from: Point,
): Point {
  const center = elementCenter(element);
  const aim = toLocal(element, focusPoint(element, focus));
  const start = toLocal(element, from);
  const back = (point: Point) => rotatePoint(point, center, element.angle);
  if (shapeSignedDistance(element, start) < 0) return back(aim);
  const length = Math.hypot(aim.x - start.x, aim.y - start.y);
  if (length < EPSILON) return back(aim);
  const hits = outlineCrossings(element, start, aim).filter(
    (t) => t >= -EPSILON && t <= 1 + EPSILON,
  );
  // An aim on the outline itself (focus 0 or 1) may miss by rounding.
  const t = hits.length > 0 ? Math.min(...hits) : 1;
  const reach = Math.max(0, t * length - Math.max(0, gap));
  return back({
    x: start.x + ((aim.x - start.x) / length) * reach,
    y: start.y + ((aim.y - start.y) / length) * reach,
  });
}

/* ------------------------------------------------------------------ */
/* Transforms                                                          */
/* ------------------------------------------------------------------ */

function withWorldPoints<E extends PointElement>(
  element: E,
  points: readonly Point[],
  options: ElementOptions | undefined,
  extra?: ElementPatch<E>,
): E {
  const [origin] = points;
  const local: LocalPoint[] = points.map(
    (point) => [point.x - origin.x, point.y - origin.y] as const,
  );
  return updateElement(
    element,
    {
      ...extra,
      x: origin.x,
      y: origin.y,
      angle: 0,
      points: local,
    } as unknown as ElementPatch<E>,
    options,
  );
}

export function translateElements(
  elements: readonly BoardElement[],
  dx: number,
  dy: number,
  options?: ElementOptions,
): BoardElement[] {
  if (dx === 0 && dy === 0) return [];
  return elements.map((element) =>
    updateElement(element, { x: element.x + dx, y: element.y + dy }, options),
  );
}

/** Rotates each element about `center` by `delta` radians. */
export function rotateElements(
  elements: readonly BoardElement[],
  center: Point,
  delta: number,
  options?: ElementOptions,
): BoardElement[] {
  return elements.map((element) => {
    const ownCenter = elementCenter(element);
    const moved = rotatePoint(ownCenter, center, delta);
    return updateElement(
      element,
      {
        x: element.x + moved.x - ownCenter.x,
        y: element.y + moved.y - ownCenter.y,
        angle: normalizeAngle(element.angle + delta),
      },
      options,
    );
  });
}

/** Mirrors the elements inside their combined bounds. */
export function flipElements(
  elements: readonly BoardElement[],
  axis: FlipAxis,
  options?: ElementOptions,
): BoardElement[] {
  const bounds = unionBoxes(elements.map(elementBounds));
  if (!bounds) return [];
  const center = boxCenter(bounds);
  const mirror = (point: Point): Point =>
    axis === "horizontal"
      ? { x: 2 * center.x - point.x, y: point.y }
      : { x: point.x, y: 2 * center.y - point.y };
  return elements.map((element) => {
    if (hasPoints(element)) {
      return withWorldPoints(
        element,
        worldPoints(element).map(mirror),
        options,
      );
    }
    const box = elementBox(element);
    const mirrored = mirror(boxCenter(box));
    const patch = {
      x: mirrored.x - box.width / 2,
      y: mirrored.y - box.height / 2,
      angle: normalizeAngle(-element.angle),
    };
    if (element.type === "shape") {
      return updateElement(
        element,
        { ...patch, shape: flipShapeKind(element.shape, axis) },
        options,
      );
    }
    return updateElement(element, patch, options);
  });
}

type Scale = { sx: number; sy: number; anchor: Point };

function scaleForHandle(
  box: Box,
  handle: ResizeHandle,
  delta: Point,
  keepAspect: boolean,
  fromCenter: boolean,
): Scale {
  const east = handle.includes("e");
  const west = handle.includes("w");
  const north = handle.includes("n");
  const south = handle.includes("s");
  const factor = fromCenter ? 2 : 1;
  let sx = 1;
  let sy = 1;
  if (box.width > EPSILON) {
    if (east) sx = (box.width + factor * delta.x) / box.width;
    if (west) sx = (box.width - factor * delta.x) / box.width;
  }
  if (box.height > EPSILON) {
    if (south) sy = (box.height + factor * delta.y) / box.height;
    if (north) sy = (box.height - factor * delta.y) / box.height;
  }
  const horizontal = east || west;
  const vertical = north || south;
  if (keepAspect) {
    if (horizontal && vertical) {
      const magnitude = Math.max(Math.abs(sx), Math.abs(sy));
      sx = (sx < 0 ? -1 : 1) * magnitude;
      sy = (sy < 0 ? -1 : 1) * magnitude;
    } else if (horizontal) {
      sy = Math.abs(sx);
    } else {
      sx = Math.abs(sy);
    }
  }
  const center = boxCenter(box);
  const anchor = {
    x: fromCenter || !horizontal ? center.x : east ? box.x : box.x + box.width,
    y: fromCenter || !vertical ? center.y : south ? box.y : box.y + box.height,
  };
  return { sx, sy, anchor };
}

function applyScale(scale: Scale, point: Point): Point {
  return {
    x: scale.anchor.x + (point.x - scale.anchor.x) * scale.sx,
    y: scale.anchor.y + (point.y - scale.anchor.y) * scale.sy,
  };
}

const clampFont = (size: number) => Math.max(1, Math.min(512, size));
const clampStroke = (width: number) =>
  Math.max(0.25, Math.min(BOARD_LIMITS.maxStrokeWidth, width));

/**
 * What a uniform scale does to an element's own sizes: its line thickness
 * and, when it has text, its font size. Scaling a group or a drawing from a
 * corner should look like zooming a picture, so these follow the geometry.
 */
function scaledSizes(
  element: BoardElement,
  factor: number,
): { strokeWidth?: number; fontSize?: number } {
  if (!(factor > 0) || factor === 1) return {};
  const sizes: { strokeWidth?: number; fontSize?: number } = {
    strokeWidth: clampStroke(element.strokeWidth * factor),
  };
  if ("fontSize" in element && typeof element.fontSize === "number") {
    sizes.fontSize = clampFont(element.fontSize * factor);
  }
  return sizes;
}

function resizeSingle(
  element: BoardElement,
  handle: ResizeHandle,
  from: Point,
  to: Point,
  keepAspect: boolean,
  fromCenter: boolean,
  options: ElementOptions | undefined,
): BoardElement {
  const box = elementBox(element);
  const center = boxCenter(box);
  const corner = handle.length === 2;
  const isText = element.type === "text";
  const delta = rotatePoint(
    { x: to.x - from.x, y: to.y - from.y },
    { x: 0, y: 0 },
    -element.angle,
  );
  const scale = scaleForHandle(
    box,
    handle,
    delta,
    keepAspect || (isText && corner),
    fromCenter,
  );
  const a = applyScale(scale, { x: box.x, y: box.y });
  const b = applyScale(scale, { x: box.x + box.width, y: box.y + box.height });
  const next = boxFromPoints([a, b]);
  // The resized box's centre moves in the unrotated frame; carry that move
  // through the rotation so the anchored side stays put on screen.
  const localCenter = boxCenter(next);
  const worldCenter = rotatePoint(localCenter, center, element.angle);
  const shift = {
    x: worldCenter.x - localCenter.x,
    y: worldCenter.y - localCenter.y,
  };

  if (hasPoints(element)) {
    const moved = element.points.map(([px, py]) => {
      const point = applyScale(scale, { x: element.x + px, y: element.y + py });
      return { x: point.x + shift.x, y: point.y + shift.y };
    });
    const [origin] = moved;
    // A freehand drawing resized from a corner thickens with it, like a
    // picture; lines and arrows keep their stroke, like shapes do.
    const thickness =
      element.type === "draw" && (corner || keepAspect)
        ? scaledSizes(element, Math.min(Math.abs(scale.sx), Math.abs(scale.sy)))
        : {};
    return updateElement(
      element,
      {
        ...thickness,
        x: origin.x,
        y: origin.y,
        points: moved.map(
          (point) => [point.x - origin.x, point.y - origin.y] as const,
        ),
      } as ElementPatch,
      options,
    );
  }
  const patch: { [key: string]: unknown } = {
    x: next.x + shift.x,
    y: next.y + shift.y,
    width: next.width,
    height: next.height,
  };
  if (isText) {
    if (corner)
      patch.fontSize = clampFont(element.fontSize * Math.abs(scale.sy));
    else if (handle === "e" || handle === "w") patch.autoSize = false;
  }
  return updateElement(element as BoardElement, patch as ElementPatch, options);
}

export type ResizeOptions = ElementOptions & {
  keepAspect?: boolean;
  fromCenter?: boolean;
};

/**
 * Resizes the elements by dragging `handle` from `from` to `to` (board
 * coordinates). Pass the elements as they were when the drag began. One
 * element resizes in its own rotated frame; several resize together inside
 * their combined bounds. Dragging past the opposite side mirrors.
 */
export function resizeElements(
  elements: readonly BoardElement[],
  handle: ResizeHandle,
  from: Point,
  to: Point,
  options?: ResizeOptions,
): BoardElement[] {
  const keepAspect = options?.keepAspect ?? false;
  const fromCenter = options?.fromCenter ?? false;
  if (elements.length === 0) return [];
  if (elements.length === 1) {
    return [
      resizeSingle(
        elements[0],
        handle,
        from,
        to,
        keepAspect,
        fromCenter,
        options,
      ),
    ];
  }
  const bounds = unionBoxes(elements.map(elementBounds)) as Box;
  const corner = handle.length === 2;
  const scale = scaleForHandle(
    bounds,
    handle,
    { x: to.x - from.x, y: to.y - from.y },
    keepAspect,
    fromCenter,
  );
  const { sx, sy } = scale;
  const mirrored = sx < 0 !== sy < 0;
  // A corner (or proportional) drag scales the selection like a picture:
  // strokes, labels and text grow with it. A side drag only stretches.
  const factor =
    corner || keepAspect ? Math.min(Math.abs(sx), Math.abs(sy)) : 1;
  return elements.map((element) => {
    if (hasPoints(element)) {
      return withWorldPoints(
        element,
        worldPoints(element).map((point) => applyScale(scale, point)),
        options,
        scaledSizes(element, factor) as ElementPatch<typeof element>,
      );
    }
    const box = elementBox(element);
    const center = applyScale(scale, boxCenter(box));
    const cos = Math.cos(element.angle);
    const sin = Math.sin(element.angle);
    // A rotated box under a non-uniform scale is approximated by scaling
    // each side along the direction it currently points.
    const width = box.width * Math.hypot(sx * cos, sy * sin);
    const height = box.height * Math.hypot(sx * sin, sy * cos);
    const patch: { [key: string]: unknown } = {
      x: center.x - width / 2,
      y: center.y - height / 2,
      width,
      height,
      angle: mirrored ? normalizeAngle(-element.angle) : element.angle,
      ...scaledSizes(element, factor),
    };
    return updateElement(
      element as BoardElement,
      patch as ElementPatch,
      options,
    );
  });
}

/* ------------------------------------------------------------------ */
/* Align and distribute                                                */
/* ------------------------------------------------------------------ */

type Unit = { members: BoardElement[]; bounds: Box };

/** Groups move as one: elements share a unit when they share a group below the selection's common groups. */
function selectionUnits(elements: readonly BoardElement[]): Unit[] {
  const live = elements.filter((element) => !element.deleted);
  let common = live[0]?.groupIds.length ?? 0;
  for (const element of live) {
    let shared = 0;
    while (
      shared < common &&
      shared < element.groupIds.length &&
      element.groupIds[shared] === live[0].groupIds[shared]
    ) {
      shared++;
    }
    common = shared;
  }
  const units = new Map<string, BoardElement[]>();
  for (const element of live) {
    const key = element.groupIds[common] ?? `element:${element.id}`;
    const members = units.get(key);
    if (members) members.push(element);
    else units.set(key, [element]);
  }
  return [...units.values()].map((members) => ({
    members,
    bounds: unionBoxes(members.map(elementBounds)) as Box,
  }));
}

function moveUnit(
  unit: Unit,
  dx: number,
  dy: number,
  options: ElementOptions | undefined,
): BoardElement[] {
  if (Math.abs(dx) < EPSILON && Math.abs(dy) < EPSILON) return [];
  return translateElements(unit.members, dx, dy, options);
}

/** Lines up the selection (groups as units) on one edge or centre line. */
export function alignElements(
  elements: readonly BoardElement[],
  edge: AlignEdge,
  options?: ElementOptions,
): BoardElement[] {
  const units = selectionUnits(elements);
  if (units.length < 2) return [];
  const bounds = unionBoxes(units.map((unit) => unit.bounds)) as Box;
  const right = bounds.x + bounds.width;
  const bottom = bounds.y + bounds.height;
  const offsets: Record<AlignEdge, (box: Box) => [number, number]> = {
    left: (box) => [bounds.x - box.x, 0],
    center: (box) => [bounds.x + bounds.width / 2 - (box.x + box.width / 2), 0],
    right: (box) => [right - (box.x + box.width), 0],
    top: (box) => [0, bounds.y - box.y],
    middle: (box) => [
      0,
      bounds.y + bounds.height / 2 - (box.y + box.height / 2),
    ],
    bottom: (box) => [0, bottom - (box.y + box.height)],
  };
  return units.flatMap((unit) => {
    const [dx, dy] = offsets[edge](unit.bounds);
    return moveUnit(unit, dx, dy, options);
  });
}

/** Spaces the selection (groups as units) with equal gaps; needs three or more units. */
export function distributeElements(
  elements: readonly BoardElement[],
  axis: DistributeAxis,
  options?: ElementOptions,
): BoardElement[] {
  const units = selectionUnits(elements);
  if (units.length < 3) return [];
  const horizontal = axis === "horizontal";
  const start = (box: Box) => (horizontal ? box.x : box.y);
  const size = (box: Box) => (horizontal ? box.width : box.height);
  const sorted = [...units].sort(
    (a, b) =>
      start(a.bounds) +
      size(a.bounds) / 2 -
      (start(b.bounds) + size(b.bounds) / 2),
  );
  const first = sorted[0].bounds;
  const last = sorted[sorted.length - 1].bounds;
  const span = start(last) + size(last) - start(first);
  const total = sorted.reduce((sum, unit) => sum + size(unit.bounds), 0);
  const gap = (span - total) / (sorted.length - 1);
  const changed: BoardElement[] = [];
  let cursor = start(first) + size(first) + gap;
  for (const unit of sorted.slice(1, -1)) {
    const shift = cursor - start(unit.bounds);
    changed.push(
      ...moveUnit(
        unit,
        horizontal ? shift : 0,
        horizontal ? 0 : shift,
        options,
      ),
    );
    cursor += size(unit.bounds) + gap;
  }
  return changed;
}

/* ------------------------------------------------------------------ */
/* Bound lines and elbow routing                                       */
/* ------------------------------------------------------------------ */

/**
 * Re-routes every live line with an end bound to one of `movedIds`, so it
 * follows the shapes it connects. Free ends and middle points stay where
 * they are; elbow lines get a fresh orthogonal route.
 */
export function updateBoundLines(
  all: readonly BoardElement[],
  movedIds: Iterable<string>,
  options?: ElementOptions,
): BoardElement[] {
  const moved = new Set(movedIds);
  const byId = new Map(all.map((element) => [element.id, element]));
  const target = (id: string | undefined) => {
    if (id === undefined) return null;
    const element = byId.get(id);
    return element && isBindable(element) ? element : null;
  };
  const changed: BoardElement[] = [];
  for (const line of all) {
    if (!isLinear(line) || line.deleted) continue;
    const startBinding = line.startBinding;
    const endBinding = line.endBinding;
    const touched =
      (startBinding !== null && moved.has(startBinding.elementId)) ||
      (endBinding !== null && moved.has(endBinding.elementId));
    if (!touched) continue;
    const points = worldPoints(line);
    const startTarget = target(startBinding?.elementId);
    const endTarget = target(endBinding?.elementId);
    const first = points[0];
    const last = points[points.length - 1];
    const startAim =
      startTarget && startBinding
        ? focusPoint(startTarget, startBinding.focus)
        : first;
    const endAim =
      endTarget && endBinding ? focusPoint(endTarget, endBinding.focus) : last;

    let next: Point[];
    if (line.routing === "elbow") {
      const start =
        startTarget && startBinding
          ? pointOnOutline(
              startTarget,
              startBinding.focus,
              startBinding.gap,
              endAim,
            )
          : first;
      const end =
        endTarget && endBinding
          ? pointOnOutline(
              endTarget,
              endBinding.focus,
              endBinding.gap,
              startAim,
            )
          : last;
      next = routeElbow(
        start,
        end,
        startTarget ? elementBounds(startTarget) : undefined,
        endTarget ? elementBounds(endTarget) : undefined,
      ).map(([px, py]) => ({ x: start.x + px, y: start.y + py }));
    } else {
      const towardsStart = points.length > 2 ? points[1] : endAim;
      const towardsEnd =
        points.length > 2 ? points[points.length - 2] : startAim;
      const start =
        startTarget && startBinding
          ? pointOnOutline(
              startTarget,
              startBinding.focus,
              startBinding.gap,
              towardsStart,
            )
          : first;
      const end =
        endTarget && endBinding
          ? pointOnOutline(
              endTarget,
              endBinding.focus,
              endBinding.gap,
              towardsEnd,
            )
          : last;
      next = [start, ...points.slice(1, -1), end];
    }
    changed.push(withWorldPoints(line, next, options));
  }
  return changed;
}

type Direction = 0 | 1 | 2 | 3;
const STEPS: readonly Point[] = [
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 0, y: -1 },
];
const opposite = (direction: Direction) => ((direction + 2) % 4) as Direction;

/** The side of `box` that `point` is on, as the outward direction. */
function outwardSide(box: Box, point: Point): Direction {
  const center = boxCenter(box);
  const dx = (point.x - center.x) / Math.max(box.width / 2, EPSILON);
  const dy = (point.y - center.y) / Math.max(box.height / 2, EPSILON);
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 0 : 2;
  return dy >= 0 ? 1 : 3;
}

function directionOf(from: Point, to: Point): Direction | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) < EPSILON && Math.abs(dy) < EPSILON) return null;
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? 0 : 2;
  return dy > 0 ? 1 : 3;
}

/** The point just outside `box` straight out from `point` on the given side. */
function stubPoint(
  box: Box,
  point: Point,
  side: Direction,
  padding: number,
): Point {
  switch (side) {
    case 0:
      return { x: box.x + box.width + padding, y: point.y };
    case 1:
      return { x: point.x, y: box.y + box.height + padding };
    case 2:
      return { x: box.x - padding, y: point.y };
    case 3:
      return { x: point.x, y: box.y - padding };
  }
}

/** True when the axis-aligned segment enters the open interior of `box`. */
function segmentEntersBox(a: Point, b: Point, box: Box): boolean {
  const left = box.x;
  const right = box.x + box.width;
  const top = box.y;
  const bottom = box.y + box.height;
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  return (
    maxX > left + EPSILON &&
    minX < right - EPSILON &&
    maxY > top + EPSILON &&
    minY < bottom - EPSILON
  );
}

function uniqueSorted(values: number[]): number[] {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  const out: number[] = [];
  for (const value of sorted) {
    if (out.length === 0 || value - out[out.length - 1] > 1e-6) out.push(value);
  }
  return out;
}

function simplifyPath(points: Point[]): Point[] {
  const deduped = points.filter(
    (point, i) =>
      i === 0 ||
      Math.abs(point.x - points[i - 1].x) > 1e-6 ||
      Math.abs(point.y - points[i - 1].y) > 1e-6,
  );
  const out: Point[] = [];
  for (const point of deduped) {
    const a = out[out.length - 2];
    const b = out[out.length - 1];
    if (
      a &&
      b &&
      ((Math.abs(a.x - b.x) < 1e-6 && Math.abs(b.x - point.x) < 1e-6) ||
        (Math.abs(a.y - b.y) < 1e-6 && Math.abs(b.y - point.y) < 1e-6))
    ) {
      out[out.length - 1] = point;
    } else {
      out.push(point);
    }
  }
  return out;
}

/**
 * An orthogonal path from `start` to `end` that leaves `startBox` and
 * enters `endBox` straight through the sides the points lie on, and goes
 * around both boxes. Returned relative to `start` (the first point is [0, 0]).
 */
export function routeElbow(
  start: Point,
  end: Point,
  startBox?: Box,
  endBox?: Box,
  padding: number = ELBOW_PADDING,
): LocalPoint[] {
  const startSide = startBox ? outwardSide(startBox, start) : null;
  const endSide = endBox ? outwardSide(endBox, end) : null;
  const startStub =
    startBox && startSide !== null
      ? stubPoint(startBox, start, startSide, padding)
      : start;
  const endStub =
    endBox && endSide !== null ? stubPoint(endBox, end, endSide, padding) : end;
  const boxes = [startBox, endBox].filter(
    (box): box is Box => box !== undefined,
  );
  // Routes may not enter either box; the grid lines sit `padding` outside
  // them, so routes keep that clearance whenever there is room for it.
  const obstacles = boxes;

  const xs = [startStub.x, endStub.x, (startStub.x + endStub.x) / 2];
  const ys = [startStub.y, endStub.y, (startStub.y + endStub.y) / 2];
  for (const box of boxes) {
    xs.push(box.x - padding, box.x + box.width + padding);
    ys.push(box.y - padding, box.y + box.height + padding);
  }
  if (startBox && endBox) {
    const gapX = [startBox, endBox].sort((a, b) => a.x - b.x);
    if (gapX[0].x + gapX[0].width < gapX[1].x) {
      xs.push((gapX[0].x + gapX[0].width + gapX[1].x) / 2);
    }
    const gapY = [startBox, endBox].sort((a, b) => a.y - b.y);
    if (gapY[0].y + gapY[0].height < gapY[1].y) {
      ys.push((gapY[0].y + gapY[0].height + gapY[1].y) / 2);
    }
  }
  const gridX = uniqueSorted(xs);
  const gridY = uniqueSorted(ys);
  const indexOf = (values: number[], value: number) =>
    values.findIndex((candidate) => Math.abs(candidate - value) <= 1e-6);
  const startNode = [indexOf(gridX, startStub.x), indexOf(gridY, startStub.y)];
  const goalNode = [indexOf(gridX, endStub.x), indexOf(gridY, endStub.y)];

  const columns = gridX.length;
  const rows = gridY.length;
  const blocked = (i: number, j: number) => {
    const point = { x: gridX[i], y: gridY[j] };
    return obstacles.some(
      (box) =>
        point.x > box.x + EPSILON &&
        point.x < box.x + box.width - EPSILON &&
        point.y > box.y + EPSILON &&
        point.y < box.y + box.height - EPSILON,
    );
  };

  // Dijkstra over (node, heading); each bend costs extra so routes stay simple.
  const bendCost = padding + 1;
  const stateCount = columns * rows * 5;
  const cost = new Float64Array(stateCount).fill(Number.POSITIVE_INFINITY);
  const previous = new Int32Array(stateCount).fill(-1);
  const done = new Uint8Array(stateCount);
  const stateId = (i: number, j: number, heading: number) =>
    (j * columns + i) * 5 + heading;
  const freeHeading = 4;
  const initialHeading = startSide ?? freeHeading;
  const first = stateId(startNode[0], startNode[1], initialHeading);
  cost[first] = 0;
  let bestGoal = -1;
  let bestGoalCost = Number.POSITIVE_INFINITY;
  const arrivalPenalty = (heading: number) => {
    if (endSide === null || heading === freeHeading) return 0;
    if (heading === opposite(endSide)) return 0;
    // Arriving while heading away from the box would need a U-turn.
    return heading === endSide ? bendCost * 4 : bendCost;
  };

  for (;;) {
    let current = -1;
    let currentCost = Number.POSITIVE_INFINITY;
    for (let s = 0; s < stateCount; s++) {
      if (!done[s] && cost[s] < currentCost) {
        currentCost = cost[s];
        current = s;
      }
    }
    if (current < 0 || currentCost >= bestGoalCost) break;
    done[current] = 1;
    const heading = current % 5;
    const node = (current - heading) / 5;
    const i = node % columns;
    const j = (node - i) / columns;
    if (i === goalNode[0] && j === goalNode[1]) {
      const total = currentCost + arrivalPenalty(heading);
      if (total < bestGoalCost) {
        bestGoalCost = total;
        bestGoal = current;
      }
      continue;
    }
    for (let d = 0; d < 4; d++) {
      if (heading !== freeHeading && d === opposite(heading as Direction))
        continue;
      const ni = i + STEPS[d].x;
      const nj = j + STEPS[d].y;
      if (ni < 0 || nj < 0 || ni >= columns || nj >= rows) continue;
      const isGoal = ni === goalNode[0] && nj === goalNode[1];
      if (!isGoal && blocked(ni, nj)) continue;
      const a = { x: gridX[i], y: gridY[j] };
      const b = { x: gridX[ni], y: gridY[nj] };
      if (obstacles.some((box) => segmentEntersBox(a, b, box))) continue;
      const step =
        Math.abs(b.x - a.x) +
        Math.abs(b.y - a.y) +
        (heading !== freeHeading && heading !== d ? bendCost : 0);
      const next = stateId(ni, nj, d);
      if (currentCost + step < cost[next]) {
        cost[next] = currentCost + step;
        previous[next] = current;
      }
    }
  }

  let path: Point[];
  if (bestGoal >= 0 && startNode[0] >= 0 && goalNode[0] >= 0) {
    const nodes: Point[] = [];
    for (let s = bestGoal; s >= 0; s = previous[s]) {
      const node = (s - (s % 5)) / 5;
      const i = node % columns;
      nodes.push({ x: gridX[i], y: gridY[(node - i) / columns] });
    }
    nodes.reverse();
    path = [start, ...nodes, end];
  } else {
    path = fallbackElbow(start, end, startStub, endStub, startSide);
  }
  return simplifyPath(path).map(
    (point) => [point.x - start.x, point.y - start.y] as const,
  );
}

function fallbackElbow(
  start: Point,
  end: Point,
  startStub: Point,
  endStub: Point,
  startSide: Direction | null,
): Point[] {
  const horizontal =
    startSide !== null
      ? startSide === 0 || startSide === 2
      : directionOf(start, end) === 0 || directionOf(start, end) === 2;
  if (horizontal) {
    const midX = (startStub.x + endStub.x) / 2;
    return [
      start,
      startStub,
      { x: midX, y: startStub.y },
      { x: midX, y: endStub.y },
      endStub,
      end,
    ];
  }
  const midY = (startStub.y + endStub.y) / 2;
  return [
    start,
    startStub,
    { x: startStub.x, y: midY },
    { x: endStub.x, y: midY },
    endStub,
    end,
  ];
}

/* ------------------------------------------------------------------ */
/* Snapping                                                            */
/* ------------------------------------------------------------------ */

export function snapToGrid(point: Point, size: number): Point {
  if (!(size > 0)) return { x: point.x, y: point.y };
  return {
    x: Math.round(point.x / size) * size,
    y: Math.round(point.y / size) * size,
  };
}

/**
 * The smallest shift (up to `threshold` per axis) that lines up an edge or
 * centre of `moving` with an edge or centre of another box, plus the guides
 * to draw for the lines that now match.
 */
export function snapToElements(
  moving: Box,
  others: readonly Box[],
  threshold: number,
): { dx: number; dy: number; guides: SnapGuide[] } {
  const linesX = (box: Box) => [
    box.x,
    box.x + box.width / 2,
    box.x + box.width,
  ];
  const linesY = (box: Box) => [
    box.y,
    box.y + box.height / 2,
    box.y + box.height,
  ];
  const best = (own: number[], lines: (box: Box) => number[]) => {
    let shift: number | null = null;
    for (const other of others) {
      for (const target of lines(other)) {
        for (const value of own) {
          const diff = target - value;
          if (
            Math.abs(diff) <= threshold &&
            (shift === null || Math.abs(diff) < Math.abs(shift))
          ) {
            shift = diff;
          }
        }
      }
    }
    return shift;
  };
  const dx = best(linesX(moving), linesX) ?? 0;
  const dy = best(linesY(moving), linesY) ?? 0;
  const snapped = { ...moving, x: moving.x + dx, y: moving.y + dy };
  const guides: SnapGuide[] = [];
  const addGuides = (
    axis: "x" | "y",
    lines: (box: Box) => number[],
    span: (box: Box) => [number, number],
  ) => {
    const byLine = new Map<number, [number, number]>();
    for (const other of others) {
      for (const target of lines(other)) {
        for (const value of lines(snapped)) {
          if (Math.abs(target - value) > 1e-6) continue;
          const key = Math.round(target * 1e6) / 1e6;
          const [a1, a2] = span(snapped);
          const [b1, b2] = span(other);
          const existing = byLine.get(key);
          const lo = Math.min(a1, b1, existing?.[0] ?? a1);
          const hi = Math.max(a2, b2, existing?.[1] ?? a2);
          byLine.set(key, [lo, hi]);
        }
      }
    }
    for (const [at, [start, end]] of byLine)
      guides.push({ axis, at, start, end });
  };
  if (others.length > 0) {
    addGuides("x", linesX, (box) => [box.y, box.y + box.height]);
    addGuides("y", linesY, (box) => [box.x, box.x + box.width]);
  }
  return { dx, dy, guides };
}
