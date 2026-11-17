// Turns one element into a small display list in element-local units. The
// canvas and SVG renderers only replay these items, so both outputs match and
// the canvas renderer can cache an element's list by id and version.

import type {
  ArrowHead,
  BoardElement,
  DrawElement,
  FrameElement,
  LinearElement,
  LocalPoint,
  PenStyle,
  ShapeElement,
  StickyElement,
  TaskElement,
  TextAlign,
  TextElement,
  TextualElement,
} from "../elements.js";
import {
  shapeDetails,
  shapePolygon,
  shapeSilhouette,
  shapeTextBox,
  shapeVertices,
} from "../shapes.js";
import {
  isTransparentColor,
  mixColors,
  themeColor,
  withAlpha,
} from "./color.js";
import {
  type FreehandOptions,
  freehandOutline,
  outlineToOps,
} from "./freehand.js";
import {
  dashPattern,
  deriveSeed,
  diamondPoints,
  ellipseOps,
  ellipsePoints,
  hatchFill,
  jitterPath,
  opsToPolygon,
  polylineOps,
  rectOps,
  roundedPolygonOps,
  roundedRectOps,
  type SketchOptions,
  seededRandom,
  sketchCurve,
  sketchDiamond,
  sketchEllipse,
  sketchFillPath,
  sketchLine,
  sketchPolygon,
  sketchPolyline,
  sketchRect,
  splineOps,
} from "./sketch.js";
import { FONT_STACKS, fontCss, layoutText, truncateText } from "./text.js";
import type {
  MeasureText,
  PathOp,
  RenderBox,
  RenderTheme,
  TaskCardData,
} from "./types.js";

export type Shadow = {
  color: string;
  blur: number;
  offsetX: number;
  offsetY: number;
};

/** How a path mixes with what is under it: multiply darkens, screen lightens. */
export type BlendMode = "multiply" | "screen";

export type PathItem = {
  kind: "path";
  ops: PathOp[];
  fill?: string;
  stroke?: string;
  lineWidth?: number;
  dash?: number[];
  shadow?: Shadow;
  /** Extra opacity (0..1) on top of the element's own. */
  alpha?: number;
  /** Applied where the output supports blending; plain alpha otherwise. */
  blend?: BlendMode;
};

export type TextItem = {
  kind: "text";
  lines: string[];
  /** Left edge of the text box. */
  x: number;
  /** Top of the first line. */
  y: number;
  /** Box width the alignment refers to. */
  width: number;
  align: TextAlign;
  /** CSS font shorthand. */
  font: string;
  /** Font stack, for SVG `font-family`. */
  fontFamily: string;
  fontSize: number;
  fontWeight?: number;
  /** Line height in board units. */
  lineHeight: number;
  color: string;
};

export type ImageItem = {
  kind: "image";
  assetId: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  crop: { x: number; y: number; width: number; height: number } | null;
};

export type DrawItem = PathItem | TextItem | ImageItem;

export type ElementDrawing = {
  items: DrawItem[];
  /** Rotation pivot in element-local units. */
  pivotX: number;
  pivotY: number;
};

export type DrawingOptions = {
  theme: RenderTheme;
  measure: MeasureText;
  /** The canvas colour (already themed), used behind line labels. */
  background: string;
  /** Live data for a task card; null draws the loading card. */
  task?: TaskCardData | null;
  /**
   * Title drawn, muted, over a frame without a name, so its title strip
   * shows where to grab it. The renderer has no translations, so the caller
   * passes it in its own language; without it an unnamed frame has no title.
   */
  frameTitle?: string;
};

const LABEL_PADDING = 8;
const STICKY_PADDING = 14;
const STICKY_FILL = "#fff3bf";
const FRAME_LABEL_SIZE = 14;
const FRAME_LABEL_GAP = 6;
const HEAD_ANGLE = 0.5;

function finite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function sizeOf(el: BoardElement): { w: number; h: number } {
  return {
    w: Math.max(0, finite(el.width)),
    h: Math.max(0, finite(el.height)),
  };
}

function sketchOf(el: BoardElement, part: number): SketchOptions {
  return {
    seed: deriveSeed(finite(el.seed), part),
    level: finite(el.sketch),
    single: el.strokeStyle !== "solid",
  };
}

function strokeWidthOf(el: BoardElement): number {
  return clamp(finite(el.strokeWidth, 2), 0, 64);
}

export function arrowHeadSize(strokeWidth: number): number {
  return clamp(8 + strokeWidth * 3, 8, 48);
}

/** Vertical position of a text item's line baseline. */
export function textBaseline(item: TextItem, line: number): number {
  return (
    item.y + line * item.lineHeight + item.lineHeight / 2 + item.fontSize * 0.35
  );
}

/** Horizontal anchor of a text item for its alignment. */
export function textAnchorX(item: TextItem): number {
  if (item.align === "center") return item.x + item.width / 2;
  if (item.align === "right") return item.x + item.width;
  return item.x;
}

// ---------------------------------------------------------------------------
// Bounds and pivot (cheap: no drawing is built)

function pointsBox(points: readonly LocalPoint[]) {
  let minX = 0;
  let minY = 0;
  let maxX = 0;
  let maxY = 0;
  let first = true;
  for (const point of points) {
    const x = finite(point[0]);
    const y = finite(point[1]);
    if (first) {
      minX = maxX = x;
      minY = maxY = y;
      first = false;
      continue;
    }
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

/** Rotation pivot: the box centre, or the centre of a line's points. */
export function elementPivot(el: BoardElement): { x: number; y: number } {
  if (el.type === "arrow" || el.type === "line" || el.type === "draw") {
    const box = pointsBox(el.points);
    return { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
  }
  const { w, h } = sizeOf(el);
  return { x: w / 2, y: h / 2 };
}

/** Local bounds including everything drawn outside the box. */
export function elementLocalBounds(el: BoardElement): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  const sw = strokeWidthOf(el);
  if (el.type === "arrow" || el.type === "line" || el.type === "draw") {
    const box = pointsBox(el.points);
    const pad =
      el.type === "draw"
        ? penSize(el.penStyle, sw) / 2 + 4
        : sw + arrowHeadSize(sw) + 4;
    let extra = 0;
    if (el.type !== "draw" && el.text) extra = finite(el.fontSize, 16) * 2;
    return {
      minX: box.minX - pad - extra,
      minY: box.minY - pad - extra,
      maxX: box.maxX + pad + extra,
      maxY: box.maxY + pad + extra,
    };
  }
  const { w, h } = sizeOf(el);
  let pad = sw + 6;
  let top = 0;
  if (el.type === "frame") {
    pad = 4;
    top = FRAME_LABEL_SIZE * 1.25 + FRAME_LABEL_GAP + 4;
  } else if (el.type === "sticky") pad = 20;
  else if (el.type === "task") pad = 16;
  else if (el.type === "text") pad = 4 + finite(el.fontSize, 16) * 0.5;
  return { minX: -pad, minY: -pad - top, maxX: w + pad, maxY: h + pad };
}

/** Axis-aligned bounds in board units, after rotation. */
export function elementSceneBounds(el: BoardElement): RenderBox {
  const local = elementLocalBounds(el);
  const pivot = elementPivot(el);
  const angle = finite(el.angle);
  const x = finite(el.x);
  const y = finite(el.y);
  if (angle === 0) {
    return {
      x: x + local.minX,
      y: y + local.minY,
      width: local.maxX - local.minX,
      height: local.maxY - local.minY,
    };
  }
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const [cx, cy] of [
    [local.minX, local.minY],
    [local.maxX, local.minY],
    [local.maxX, local.maxY],
    [local.minX, local.maxY],
  ] as const) {
    const dx = cx - pivot.x;
    const dy = cy - pivot.y;
    const px = x + pivot.x + dx * cos - dy * sin;
    const py = y + pivot.y + dx * sin + dy * cos;
    if (px < minX) minX = px;
    if (py < minY) minY = py;
    if (px > maxX) maxX = px;
    if (py > maxY) maxY = py;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** A frame's clip outline in board units (its rotated box). */
export function frameClipPolygon(frame: FrameElement): LocalPoint[] {
  const { w, h } = sizeOf(frame);
  const pivot = elementPivot(frame);
  const angle = finite(frame.angle);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const x = finite(frame.x);
  const y = finite(frame.y);
  return (
    [
      [0, 0],
      [w, 0],
      [w, h],
      [0, h],
    ] as const
  ).map(([cx, cy]): LocalPoint => {
    const dx = cx - pivot.x;
    const dy = cy - pivot.y;
    return [
      x + pivot.x + dx * cos - dy * sin,
      y + pivot.y + dx * sin + dy * cos,
    ];
  });
}

// ---------------------------------------------------------------------------
// Shared pieces

function strokeOf(el: BoardElement, theme: RenderTheme): string {
  return themeColor(el.strokeColor, theme);
}

function fillItems(
  el: BoardElement,
  exact: PathOp[],
  polygon: readonly LocalPoint[],
  theme: RenderTheme,
): PathItem[] {
  if (el.fillStyle === "none" || isTransparentColor(el.fillColor)) return [];
  const fill = themeColor(el.fillColor, theme, "transparent");
  if (el.fillStyle === "solid") {
    return [
      { kind: "path", ops: sketchFillPath(exact, sketchOf(el, 1)), fill },
    ];
  }
  const sw = strokeWidthOf(el);
  const gap = Math.max(6, sw * 4);
  const ops = hatchFill(polygon, gap, -Math.PI / 4, {
    ...sketchOf(el, 2),
    single: true,
  });
  if (el.fillStyle === "cross") {
    ops.push(
      ...hatchFill(polygon, gap, Math.PI / 4, {
        ...sketchOf(el, 3),
        single: true,
      }),
    );
  }
  return [{ kind: "path", ops, stroke: fill, lineWidth: Math.max(1, sw / 2) }];
}

function outlineItem(
  el: BoardElement,
  ops: PathOp[],
  theme: RenderTheme,
): PathItem[] {
  const sw = strokeWidthOf(el);
  if (sw <= 0 || isTransparentColor(el.strokeColor)) return [];
  const dash = dashPattern(el.strokeStyle, sw);
  return [
    {
      kind: "path",
      ops,
      stroke: strokeOf(el, theme),
      lineWidth: sw,
      ...(dash.length ? { dash } : {}),
    },
  ];
}

function labelItems(
  el: TextualElement,
  box: { x: number; y: number; w: number; h: number },
  padding: number,
  options: DrawingOptions,
  maxWidth?: number,
): TextItem[] {
  if (!el.text) return [];
  const fontSize = clamp(finite(el.fontSize, 16), 1, 512);
  const innerWidth = Math.max(1, box.w - padding * 2);
  const layout = layoutText(
    el.text,
    { fontSize, fontFamily: el.fontFamily, maxWidth: maxWidth ?? innerWidth },
    options.measure,
  );
  let y = box.y + padding;
  if (el.verticalAlign === "middle") y = box.y + (box.h - layout.height) / 2;
  else if (el.verticalAlign === "bottom") {
    y = box.y + box.h - padding - layout.height;
  }
  return [
    {
      kind: "text",
      lines: layout.lines,
      x: box.x + padding,
      y,
      width: Math.max(innerWidth, maxWidth === undefined ? 0 : layout.width),
      align: el.textAlign,
      font: layout.font,
      fontFamily: FONT_STACKS[el.fontFamily] ?? FONT_STACKS.sans,
      fontSize,
      lineHeight: layout.lineHeightPx,
      color: strokeOf(el, options.theme),
    },
  ];
}

// ---------------------------------------------------------------------------
// Element builders

function rectangleItems(
  el: BoardElement & { cornerRadius: number },
  options: DrawingOptions,
) {
  const { w, h } = sizeOf(el);
  const radius = clamp(finite(el.cornerRadius), 0, Math.min(w, h) / 2);
  const exact = roundedRectOps(0, 0, w, h, radius);
  const polygon =
    radius > 0 ? opsToPolygon(exact) : opsToPolygon(rectOps(0, 0, w, h));
  return [
    ...fillItems(el, exact, polygon, options.theme),
    ...outlineItem(
      el,
      sketchRect(0, 0, w, h, { ...sketchOf(el, 0), radius }),
      options.theme,
    ),
  ];
}

function ellipseItems(el: BoardElement, options: DrawingOptions) {
  const { w, h } = sizeOf(el);
  const exact = ellipseOps(w / 2, h / 2, w / 2, h / 2);
  return [
    ...fillItems(
      el,
      exact,
      ellipsePoints(w / 2, h / 2, w / 2, h / 2),
      options.theme,
    ),
    ...outlineItem(
      el,
      sketchEllipse(w / 2, h / 2, w / 2, h / 2, sketchOf(el, 0)),
      options.theme,
    ),
  ];
}

function diamondItems(el: BoardElement, options: DrawingOptions) {
  const { w, h } = sizeOf(el);
  const points = diamondPoints(0, 0, w, h);
  return [
    ...fillItems(el, roundedPolygonOps(points, 0), points, options.theme),
    ...outlineItem(
      el,
      sketchDiamond(0, 0, w, h, sketchOf(el, 0)),
      options.theme,
    ),
  ];
}

function stickyItems(el: StickyElement, options: DrawingOptions): DrawItem[] {
  const { w, h } = sizeOf(el);
  const fold = Math.min(18, Math.min(w, h) * 0.12);
  const fill = themeColor(
    isTransparentColor(el.fillColor) ? STICKY_FILL : el.fillColor,
    options.theme,
    STICKY_FILL,
  );
  const body: PathOp[] = [
    ["M", 0, 0],
    ["L", w, 0],
    ["L", w, h - fold],
    ["L", w - fold, h],
    ["L", 0, h],
    ["Z"],
  ];
  const flap: PathOp[] = [
    ["M", w - fold, h],
    ["L", w, h - fold],
    ["L", w - fold, h - fold],
    ["Z"],
  ];
  return [
    {
      kind: "path",
      ops: body,
      fill,
      shadow: {
        color:
          options.theme === "dark"
            ? "rgba(0, 0, 0, 0.5)"
            : "rgba(0, 0, 0, 0.16)",
        blur: 12,
        offsetX: 0,
        offsetY: 4,
      },
    },
    { kind: "path", ops: flap, fill: mixColors(fill, "#000000", 0.12) },
    ...labelItems(el, { x: 0, y: 0, w, h }, STICKY_PADDING, options),
  ];
}

function textItems(el: TextElement, options: DrawingOptions): DrawItem[] {
  const { w, h } = sizeOf(el);
  return labelItems(
    el,
    { x: 0, y: 0, w, h },
    0,
    options,
    el.autoSize ? Number.POSITIVE_INFINITY : Math.max(1, w),
  );
}

/** Inserts corner points so every segment is horizontal or vertical. */
function orthogonalPoints(points: readonly LocalPoint[]): LocalPoint[] {
  const result: LocalPoint[] = [];
  for (const point of points) {
    const previous = result[result.length - 1];
    if (!previous) {
      result.push(point);
      continue;
    }
    const dx = point[0] - previous[0];
    const dy = point[1] - previous[1];
    if (Math.abs(dx) > 1e-6 && Math.abs(dy) > 1e-6) {
      if (Math.abs(dx) >= Math.abs(dy)) {
        const mid = previous[0] + dx / 2;
        result.push([mid, previous[1]], [mid, point[1]]);
      } else {
        const mid = previous[1] + dy / 2;
        result.push([previous[0], mid], [point[0], mid]);
      }
    }
    result.push(point);
  }
  // Drop repeated and collinear points so corners are real corners.
  const cleaned: LocalPoint[] = [];
  for (const point of result) {
    const last = cleaned[cleaned.length - 1];
    if (
      last &&
      Math.abs(last[0] - point[0]) < 1e-6 &&
      Math.abs(last[1] - point[1]) < 1e-6
    ) {
      continue;
    }
    const before = cleaned[cleaned.length - 2];
    if (before && last) {
      const sameX =
        Math.abs(before[0] - last[0]) < 1e-6 &&
        Math.abs(last[0] - point[0]) < 1e-6;
      const sameY =
        Math.abs(before[1] - last[1]) < 1e-6 &&
        Math.abs(last[1] - point[1]) < 1e-6;
      if (sameX || sameY) cleaned.pop();
    }
    cleaned.push(point);
  }
  return cleaned;
}

/** An open polyline with each interior corner rounded by up to `radius`. */
function roundedPolylineOps(
  points: readonly LocalPoint[],
  radius: number,
): PathOp[] {
  if (points.length < 3 || radius <= 0) return polylineOps(points, false);
  const first = points[0] as LocalPoint;
  const ops: PathOp[] = [["M", first[0], first[1]]];
  for (let index = 1; index < points.length - 1; index++) {
    const prev = points[index - 1] as LocalPoint;
    const corner = points[index] as LocalPoint;
    const next = points[index + 1] as LocalPoint;
    const inLength = Math.hypot(corner[0] - prev[0], corner[1] - prev[1]) || 1;
    const outLength = Math.hypot(next[0] - corner[0], next[1] - corner[1]) || 1;
    const cut = Math.min(radius, inLength / 2, outLength / 2);
    const ax = corner[0] - ((corner[0] - prev[0]) / inLength) * cut;
    const ay = corner[1] - ((corner[1] - prev[1]) / inLength) * cut;
    const bx = corner[0] + ((next[0] - corner[0]) / outLength) * cut;
    const by = corner[1] + ((next[1] - corner[1]) / outLength) * cut;
    ops.push(["L", ax, ay]);
    ops.push([
      "C",
      ax + (corner[0] - ax) * 0.55,
      ay + (corner[1] - ay) * 0.55,
      bx + (corner[0] - bx) * 0.55,
      by + (corner[1] - by) * 0.55,
      bx,
      by,
    ]);
  }
  const last = points[points.length - 1] as LocalPoint;
  ops.push(["L", last[0], last[1]]);
  return ops;
}

/** Unit direction the path travels at its start or its end. */
function pathDirection(
  ops: readonly PathOp[],
  atEnd: boolean,
): { x: number; y: number } {
  const normalise = (x: number, y: number) => {
    const length = Math.hypot(x, y);
    return length > 1e-9 ? { x: x / length, y: y / length } : null;
  };
  if (!atEnd) {
    const move = ops[0];
    if (move?.[0] !== "M") return { x: 1, y: 0 };
    for (let index = 1; index < ops.length; index++) {
      const op = ops[index] as PathOp;
      if (op[0] === "L") {
        const dir = normalise(op[1] - move[1], op[2] - move[2]);
        if (dir) return dir;
      } else if (op[0] === "C") {
        const dir =
          normalise(op[1] - move[1], op[2] - move[2]) ??
          normalise(op[5] - move[1], op[6] - move[2]);
        if (dir) return dir;
      }
    }
    return { x: 1, y: 0 };
  }
  const points: { x: number; y: number; handle?: { x: number; y: number } }[] =
    [];
  for (const op of ops) {
    if (op[0] === "M" || op[0] === "L") points.push({ x: op[1], y: op[2] });
    else if (op[0] === "C")
      points.push({ x: op[5], y: op[6], handle: { x: op[3], y: op[4] } });
  }
  const tip = points[points.length - 1];
  if (!tip) return { x: 1, y: 0 };
  if (tip.handle) {
    const dir = normalise(tip.x - tip.handle.x, tip.y - tip.handle.y);
    if (dir) return dir;
  }
  for (let index = points.length - 2; index >= 0; index--) {
    const from = points[index] as { x: number; y: number };
    const dir = normalise(tip.x - from.x, tip.y - from.y);
    if (dir) return dir;
  }
  return { x: 1, y: 0 };
}

function headItems(
  head: ArrowHead,
  tip: LocalPoint,
  dir: { x: number; y: number },
  size: number,
  el: LinearElement,
  color: string,
  part: number,
): PathItem[] {
  if (head === "none") return [];
  const sw = strokeWidthOf(el);
  const backX = tip[0] - dir.x * size;
  const backY = tip[1] - dir.y * size;
  const wing = (angle: number): LocalPoint => {
    const dx = backX - tip[0];
    const dy = backY - tip[1];
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    return [tip[0] + dx * cos - dy * sin, tip[1] + dx * sin + dy * cos];
  };
  const sketch: SketchOptions = {
    ...sketchOf(el, part),
    single: el.strokeStyle !== "solid",
  };
  if (head === "arrow") {
    const left = wing(HEAD_ANGLE);
    const right = wing(-HEAD_ANGLE);
    return [
      {
        kind: "path",
        ops: [
          ...sketchLine(tip[0], tip[1], left[0], left[1], sketch),
          ...sketchLine(tip[0], tip[1], right[0], right[1], {
            ...sketch,
            seed: sketch.seed + 1,
          }),
        ],
        stroke: color,
        lineWidth: sw,
      },
    ];
  }
  if (head === "triangle") {
    const points = [tip, wing(HEAD_ANGLE), wing(-HEAD_ANGLE)];
    return [
      { kind: "path", ops: roundedPolygonOps(points, 0), fill: color },
      {
        kind: "path",
        ops: sketchPolygon(points, sketch),
        stroke: color,
        lineWidth: sw,
      },
    ];
  }
  if (head === "dot") {
    const radius = Math.max(2, size * 0.28 + sw * 0.25);
    return [
      {
        kind: "path",
        ops: ellipseOps(tip[0], tip[1], radius, radius),
        fill: color,
      },
    ];
  }
  const half = size * 0.55;
  const nx = -dir.y * half;
  const ny = dir.x * half;
  return [
    {
      kind: "path",
      ops: sketchLine(
        tip[0] + nx,
        tip[1] + ny,
        tip[0] - nx,
        tip[1] - ny,
        sketch,
      ),
      stroke: color,
      lineWidth: sw,
    },
  ];
}

function polylineMidpoint(points: readonly LocalPoint[]): LocalPoint {
  let total = 0;
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1] as LocalPoint;
    const b = points[index] as LocalPoint;
    total += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  let remaining = total / 2;
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1] as LocalPoint;
    const b = points[index] as LocalPoint;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length >= remaining && length > 0) {
      const t = remaining / length;
      return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
    }
    remaining -= length;
  }
  return (points[0] as LocalPoint) ?? [0, 0];
}

function linearItems(el: LinearElement, options: DrawingOptions): DrawItem[] {
  const points = el.points.filter(
    (point) => Number.isFinite(point[0]) && Number.isFinite(point[1]),
  );
  if (points.length < 2) return [];
  const sketch = sketchOf(el, 0);
  let exact: PathOp[];
  let strokeOps: PathOp[];
  if (el.routing === "curved") {
    exact = splineOps(points);
    strokeOps = sketchCurve(points, sketch);
  } else if (el.routing === "elbow") {
    const corners = orthogonalPoints(points);
    exact = roundedPolylineOps(corners, 10);
    strokeOps =
      finite(el.sketch) > 0
        ? jitterPath(
            exact,
            seededRandom(sketch.seed),
            clamp(finite(el.sketch), 0, 2),
            sketch.single ? 1 : 2,
          )
        : exact;
  } else {
    exact = polylineOps(points, false);
    strokeOps = sketchPolyline(points, sketch);
  }
  const color = strokeOf(el, options.theme);
  const items: DrawItem[] = [...outlineItem(el, strokeOps, options.theme)];
  if (isTransparentColor(el.strokeColor)) return items;

  const flat = opsToPolygon(exact);
  let length = 0;
  for (let index = 1; index < flat.length; index++) {
    const a = flat[index - 1] as LocalPoint;
    const b = flat[index] as LocalPoint;
    length += Math.hypot(b[0] - a[0], b[1] - a[1]);
  }
  const size = Math.max(
    3,
    Math.min(arrowHeadSize(strokeWidthOf(el)), length * 0.45),
  );
  const end = pathDirection(exact, true);
  const start = pathDirection(exact, false);
  const last = (flat[flat.length - 1] ??
    points[points.length - 1]) as LocalPoint;
  const first = points[0] as LocalPoint;
  items.push(...headItems(el.endHead, last, end, size, el, color, 10));
  items.push(
    ...headItems(
      el.startHead,
      first,
      { x: -start.x, y: -start.y },
      size,
      el,
      color,
      20,
    ),
  );

  if (el.text) {
    const middle = polylineMidpoint(flat);
    const fontSize = clamp(finite(el.fontSize, 16), 1, 512);
    const layout = layoutText(
      el.text,
      {
        fontSize,
        fontFamily: el.fontFamily,
        maxWidth: Math.max(160, fontSize * 14),
      },
      options.measure,
    );
    const pad = 4;
    const width = layout.width;
    const left = middle[0] - width / 2;
    const top = middle[1] - layout.height / 2;
    if (!isTransparentColor(options.background)) {
      items.push({
        kind: "path",
        ops: roundedRectOps(
          left - pad,
          top - pad,
          width + pad * 2,
          layout.height + pad * 2,
          4,
        ),
        fill: options.background,
      });
    }
    items.push({
      kind: "text",
      lines: layout.lines,
      x: left,
      y: top,
      width,
      align: "center",
      font: layout.font,
      fontFamily: FONT_STACKS[el.fontFamily] ?? FONT_STACKS.sans,
      fontSize,
      lineHeight: layout.lineHeightPx,
      color,
    });
  }
  return items;
}

/** Opacity of highlighter ink, on top of the element's own opacity. */
export const HIGHLIGHTER_ALPHA = 0.38;

/** Diameter of a freehand stroke of this pen style, in board units. */
export function penSize(penStyle: PenStyle | undefined, strokeWidth: number) {
  const sw = clamp(finite(strokeWidth, 2), 0, 64);
  if (penStyle === "marker") return Math.max(2, sw * 3 + 2);
  if (penStyle === "highlighter") return Math.max(6, sw * 7 + 6);
  return Math.max(1, sw * 2.2 + 0.5);
}

/**
 * Outline settings for a pen style. A pen follows pressure; a marker and a
 * highlighter keep one width from end to end, the highlighter with flat ends.
 */
export function penOutlineOptions(
  penStyle: PenStyle | undefined,
  strokeWidth: number,
  simulatePressure: boolean,
): FreehandOptions {
  const size = penSize(penStyle, strokeWidth);
  if (penStyle === "marker" || penStyle === "highlighter") {
    return {
      size,
      thinning: 0,
      smoothing: 0.5,
      streamline: 0.4,
      simulatePressure: true,
      taperStart: 0,
      taperEnd: 0,
      flatCaps: penStyle === "highlighter",
    };
  }
  return {
    size,
    thinning: 0.6,
    smoothing: 0.5,
    streamline: 0.35,
    simulatePressure,
  };
}

function drawItems(el: DrawElement, options: DrawingOptions): DrawItem[] {
  if (isTransparentColor(el.strokeColor)) return [];
  const outline = freehandOutline(
    el.points,
    el.pressures,
    penOutlineOptions(
      el.penStyle,
      strokeWidthOf(el),
      el.simulatePressure || el.pressures.length === 0,
    ),
  );
  const ops = outlineToOps(outline);
  if (ops.length === 0) return [];
  const fill = strokeOf(el, options.theme);
  if (el.penStyle !== "highlighter") return [{ kind: "path", ops, fill }];
  return [
    {
      kind: "path",
      ops,
      fill,
      alpha: HIGHLIGHTER_ALPHA,
      // Multiply keeps ink under the highlight readable on a light canvas;
      // on a dark canvas it would vanish, so it lightens instead.
      blend: options.theme === "dark" ? "screen" : "multiply",
    },
  ];
}

function shapeItems(el: ShapeElement, options: DrawingOptions): DrawItem[] {
  const { w, h } = sizeOf(el);
  const silhouette = shapeSilhouette(el.shape, w, h);
  const details = shapeDetails(el.shape, w, h);
  const vertices = shapeVertices(el.shape, w, h);
  const sketch = sketchOf(el, 0);
  const level = clamp(finite(el.sketch), 0, 2);
  const passes = sketch.single ? 1 : 2;
  let stroke: PathOp[];
  if (level === 0) stroke = [...silhouette, ...details];
  else {
    const random = seededRandom(sketch.seed);
    stroke = vertices
      ? sketchPolygon(vertices, sketch)
      : jitterPath(silhouette, random, level, passes);
    if (details.length)
      stroke.push(...jitterPath(details, random, level, passes));
  }
  const box = shapeTextBox(el.shape, w, h);
  return [
    ...fillItems(el, silhouette, shapePolygon(el.shape, w, h), options.theme),
    ...outlineItem(el, stroke, options.theme),
    ...labelItems(
      el,
      { x: box.x, y: box.y, w: box.width, h: box.height },
      2,
      options,
    ),
  ];
}

/** The picture shown while an image is uploading, loading or missing. */
export function imagePlaceholder(
  width: number,
  height: number,
  theme: RenderTheme,
): PathItem[] {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const dark = theme === "dark";
  const ink = dark ? "#5c5f66" : "#adb5bd";
  const items: PathItem[] = [
    {
      kind: "path",
      ops: roundedRectOps(0, 0, w, h, Math.min(8, w / 4, h / 4)),
      fill: dark ? "#25262b" : "#f1f3f5",
    },
    {
      kind: "path",
      ops: roundedRectOps(0.5, 0.5, w - 1, h - 1, Math.min(8, w / 4, h / 4)),
      stroke: ink,
      lineWidth: 1,
      dash: [6, 4],
    },
  ];
  const icon = clamp(Math.min(w, h) * 0.35, 8, 64);
  if (icon * 1.2 > Math.min(w, h)) return items;
  const ix = (w - icon) / 2;
  const iy = (h - icon * 0.8) / 2;
  const ih = icon * 0.8;
  items.push({
    kind: "path",
    ops: roundedRectOps(ix, iy, icon, ih, icon * 0.1),
    stroke: ink,
    lineWidth: Math.max(1, icon / 20),
  });
  items.push({
    kind: "path",
    ops: polylineOps(
      [
        [ix + icon * 0.1, iy + ih * 0.85],
        [ix + icon * 0.38, iy + ih * 0.45],
        [ix + icon * 0.58, iy + ih * 0.68],
        [ix + icon * 0.72, iy + ih * 0.55],
        [ix + icon * 0.9, iy + ih * 0.85],
      ],
      true,
    ),
    fill: ink,
  });
  const sun = icon * 0.09;
  items.push({
    kind: "path",
    ops: ellipseOps(ix + icon * 0.72, iy + ih * 0.28, sun, sun),
    fill: ink,
  });
  return items;
}

function imageItems(el: Extract<BoardElement, { type: "image" }>): DrawItem[] {
  const { w, h } = sizeOf(el);
  const crop =
    el.crop &&
    [el.crop.x, el.crop.y, el.crop.width, el.crop.height].every(
      Number.isFinite,
    ) &&
    el.crop.width > 0 &&
    el.crop.height > 0
      ? { ...el.crop }
      : null;
  return [
    {
      kind: "image",
      assetId: el.assetId,
      x: 0,
      y: 0,
      width: w,
      height: h,
      crop,
    },
  ];
}

function frameItems(el: FrameElement, options: DrawingOptions): DrawItem[] {
  const { w, h } = sizeOf(el);
  const items: DrawItem[] = [];
  const exact = roundedRectOps(0, 0, w, h, Math.min(6, w / 2, h / 2));
  items.push(...fillItems(el, exact, opsToPolygon(exact), options.theme));
  const border = withAlpha(strokeOf(el, options.theme), 0.6);
  items.push({
    kind: "path",
    ops: exact,
    stroke: border,
    lineWidth: clamp(strokeWidthOf(el), 1, 2),
  });
  const name = el.name.replace(/\s+/g, " ").trim();
  const title = name || (options.frameTitle ?? "").replace(/\s+/g, " ").trim();
  if (title) {
    const font = fontCss("sans", FRAME_LABEL_SIZE, 500);
    const lineHeight = FRAME_LABEL_SIZE * 1.25;
    items.push({
      kind: "text",
      lines: [truncateText(title, Math.max(24, w), font, options.measure)],
      x: 0,
      y: -lineHeight - FRAME_LABEL_GAP,
      width: Math.max(24, w),
      align: "left",
      font,
      fontFamily: FONT_STACKS.sans,
      fontSize: FRAME_LABEL_SIZE,
      fontWeight: 500,
      lineHeight,
      // A stand-in title is fainter than a real name.
      color: withAlpha(strokeOf(el, options.theme), name ? 0.75 : 0.5),
    });
  }
  return items;
}

// ---------------------------------------------------------------------------
// Task cards

const IDENTITY_COLORS = [
  "#e8590c",
  "#1971c2",
  "#2f9e44",
  "#9c36b5",
  "#c2255c",
  "#0c8599",
  "#5f3dc4",
  "#f08c00",
];

const PRIORITY_LEVELS: Record<string, number> = {
  none: 0,
  "no-priority": 0,
  low: 1,
  medium: 2,
  high: 3,
  urgent: 3,
};

function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words
    .slice(0, 2)
    .map((word) => Array.from(word)[0] ?? "")
    .join("");
  return letters.toLocaleUpperCase();
}

function identityColor(name: string): string {
  let hash = 0;
  for (const char of name)
    hash = (Math.imul(hash, 31) + (char.codePointAt(0) ?? 0)) | 0;
  return IDENTITY_COLORS[Math.abs(hash) % IDENTITY_COLORS.length] as string;
}

function textItem(
  text: string,
  x: number,
  y: number,
  width: number,
  align: TextAlign,
  family: "sans" | "mono",
  size: number,
  color: string,
  weight?: number,
): TextItem {
  return {
    kind: "text",
    lines: [text],
    x,
    y,
    width,
    align,
    font: fontCss(family, size, weight),
    fontFamily: FONT_STACKS[family],
    fontSize: size,
    ...(weight ? { fontWeight: weight } : {}),
    lineHeight: size * 1.25,
    color,
  };
}

function taskItems(el: TaskElement, options: DrawingOptions): DrawItem[] {
  const { w, h } = sizeOf(el);
  const dark = options.theme === "dark";
  const palette = dark
    ? {
        card: "#1f2024",
        border: "#3a3b40",
        text: "#e9ecef",
        muted: "#9aa0a6",
        skeleton: "#2e3035",
      }
    : {
        card: "#ffffff",
        border: "#dee2e6",
        text: "#1e1e1e",
        muted: "#868e96",
        skeleton: "#e9ecef",
      };
  const pad = 12;
  const items: DrawItem[] = [
    {
      kind: "path",
      ops: roundedRectOps(0, 0, w, h, Math.min(10, w / 2, h / 2)),
      fill: palette.card,
      stroke: palette.border,
      lineWidth: 1,
      shadow: {
        color: dark ? "rgba(0, 0, 0, 0.4)" : "rgba(0, 0, 0, 0.08)",
        blur: 8,
        offsetX: 0,
        offsetY: 2,
      },
    },
  ];
  const inner = Math.max(1, w - pad * 2);
  const task = options.task;
  if (!task) {
    const bar = (
      x: number,
      y: number,
      width: number,
      height: number,
    ): PathItem => ({
      kind: "path",
      ops: roundedRectOps(x, y, Math.max(1, width), height, height / 2),
      fill: palette.skeleton,
    });
    items.push(bar(pad, pad, Math.min(48, inner * 0.3), 10));
    items.push(
      bar(
        w - pad - Math.min(56, inner * 0.3),
        pad - 2,
        Math.min(56, inner * 0.3),
        14,
      ),
    );
    items.push(bar(pad, pad + 26, inner, 12));
    items.push(bar(pad, pad + 44, inner * 0.6, 12));
    items.push({
      kind: "path",
      ops: ellipseOps(pad + 10, h - pad - 10, 10, 10),
      fill: palette.skeleton,
    });
    return items;
  }

  const status = themeColor(
    task.statusColor ?? "#868e96",
    options.theme,
    "#868e96",
  );
  const chipFont = fontCss("sans", 11, 600);
  const chipText = truncateText(
    task.statusName,
    Math.max(24, inner * 0.5 - 22),
    chipFont,
    options.measure,
  );
  const chipWidth = Math.min(
    inner * 0.55,
    options.measure(chipText, chipFont) + 24,
  );
  const chipX = w - pad - chipWidth;
  const chipY = pad - 3;
  const chipHeight = 18;
  if (chipText) {
    items.push({
      kind: "path",
      ops: roundedRectOps(chipX, chipY, chipWidth, chipHeight, chipHeight / 2),
      fill: withAlpha(status, 0.18),
    });
    items.push({
      kind: "path",
      ops: ellipseOps(chipX + 9, chipY + chipHeight / 2, 3.5, 3.5),
      fill: status,
    });
    items.push(
      textItem(
        chipText,
        chipX + 16,
        chipY + (chipHeight - 11 * 1.25) / 2,
        chipWidth - 20,
        "left",
        "sans",
        11,
        palette.text,
        600,
      ),
    );
  }
  const keyFont = fontCss("mono", 11);
  items.push(
    textItem(
      truncateText(
        task.key,
        Math.max(16, chipX - pad - 6),
        keyFont,
        options.measure,
      ),
      pad,
      pad - 3 + (chipHeight - 11 * 1.25) / 2,
      Math.max(16, chipX - pad - 6),
      "left",
      "mono",
      11,
      palette.muted,
    ),
  );

  const title = layoutText(
    task.title.replace(/\s+/g, " ").trim(),
    {
      fontSize: 14,
      fontFamily: "sans",
      maxWidth: inner,
      maxLines: 2,
      fontWeight: 600,
    },
    options.measure,
  );
  const titleItem: TextItem = {
    kind: "text",
    lines: title.lines,
    x: pad,
    y: pad + 24,
    width: inner,
    align: "left",
    font: title.font,
    fontFamily: FONT_STACKS.sans,
    fontSize: 14,
    fontWeight: 600,
    lineHeight: title.lineHeightPx,
    color: task.done ? palette.muted : palette.text,
  };
  items.push(titleItem);
  if (task.done) {
    const strike: PathOp[] = [];
    title.lines.forEach((line, index) => {
      const width = options.measure(line, title.font);
      const y = textBaseline(titleItem, index) - 14 * 0.3;
      strike.push(["M", pad, y], ["L", pad + width, y]);
    });
    items.push({
      kind: "path",
      ops: strike,
      stroke: palette.muted,
      lineWidth: 1.25,
    });
  }

  const rowY = h - pad - 10;
  let cursor = pad;
  if (task.assigneeName) {
    const initials = initialsOf(task.assigneeName);
    items.push({
      kind: "path",
      ops: ellipseOps(pad + 10, rowY, 10, 10),
      fill: identityColor(task.assigneeName),
    });
    items.push(
      textItem(
        initials,
        pad,
        rowY - (9 * 1.25) / 2,
        20,
        "center",
        "sans",
        9,
        "#ffffff",
        700,
      ),
    );
    cursor += 28;
  }
  const level = task.priority
    ? (PRIORITY_LEVELS[task.priority.toLowerCase()] ?? 0)
    : 0;
  if (task.priority && level > 0) {
    const urgent = task.priority.toLowerCase() === "urgent";
    for (let index = 0; index < 3; index++) {
      const barHeight = 5 + index * 3;
      items.push({
        kind: "path",
        ops: roundedRectOps(
          cursor + index * 5,
          rowY + 5.5 - barHeight,
          3,
          barHeight,
          1,
        ),
        fill:
          index < level
            ? urgent
              ? themeColor("#e03131", options.theme)
              : palette.muted
            : palette.border,
      });
    }
    cursor += 20;
  }
  if (task.dueDate) {
    const due = task.dueDate.slice(0, 10);
    items.push(
      textItem(
        due,
        cursor,
        rowY - (11 * 1.25) / 2,
        Math.max(1, w - pad - cursor),
        "right",
        "sans",
        11,
        palette.muted,
      ),
    );
  }
  return items;
}

// ---------------------------------------------------------------------------

/** Builds the display list for one element. Deleted elements draw nothing. */
export function buildElementDrawing(
  el: BoardElement,
  options: DrawingOptions,
): ElementDrawing {
  const pivot = elementPivot(el);
  let items: DrawItem[] = [];
  if (!el.deleted) {
    switch (el.type) {
      case "rectangle":
        items = [
          ...rectangleItems(el, options),
          ...labelItems(
            el,
            { x: 0, y: 0, ...sizeOf(el) },
            LABEL_PADDING,
            options,
          ),
        ];
        break;
      case "ellipse": {
        const { w, h } = sizeOf(el);
        const insetX = (w * (1 - Math.SQRT1_2)) / 2;
        const insetY = (h * (1 - Math.SQRT1_2)) / 2;
        items = [
          ...ellipseItems(el, options),
          ...labelItems(
            el,
            { x: insetX, y: insetY, w: w - insetX * 2, h: h - insetY * 2 },
            4,
            options,
          ),
        ];
        break;
      }
      case "diamond": {
        const { w, h } = sizeOf(el);
        items = [
          ...diamondItems(el, options),
          ...labelItems(
            el,
            { x: w / 4, y: h / 4, w: w / 2, h: h / 2 },
            2,
            options,
          ),
        ];
        break;
      }
      case "sticky":
        items = stickyItems(el, options);
        break;
      case "text":
        items = textItems(el, options);
        break;
      case "arrow":
      case "line":
        items = linearItems(el, options);
        break;
      case "draw":
        items = drawItems(el, options);
        break;
      case "image":
        items = imageItems(el);
        break;
      case "frame":
        items = frameItems(el, options);
        break;
      case "task":
        items = taskItems(el, options);
        break;
      case "shape":
        items = shapeItems(el, options);
        break;
    }
  }
  return { items, pivotX: pivot.x, pivotY: pivot.y };
}
