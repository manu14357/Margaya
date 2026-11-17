// Canvas renderer. Elements are culled against the viewport, drawn in order
// key order, clipped to their frame, and replayed from a per-element display
// list cached by id and version. When `Path2D` exists each cached path is
// also kept as a `Path2D`, otherwise the commands are traced every frame.

import type {
  BackgroundPattern,
  BoardElement,
  FrameElement,
} from "../elements.js";
import { isTransparentColor, themeColor } from "./color.js";
import {
  buildElementDrawing,
  type DrawItem,
  type ElementDrawing,
  elementSceneBounds,
  frameClipPolygon,
  type ImageItem,
  imagePlaceholder,
  type PathItem,
  type TextItem,
  textAnchorX,
  textBaseline,
} from "./shapes.js";
import type {
  CanvasImageLike,
  MeasureText,
  PathConstructor,
  PathLike,
  PathOp,
  RenderBox,
  RenderContext,
  RenderTheme,
  TaskCardData,
  Viewport,
} from "./types.js";

export type ElementRenderOptions = {
  theme: RenderTheme;
  measureText: MeasureText;
  /** Canvas colour as stored (it is themed here); used behind line labels. */
  background?: string;
  resolveImage?: (assetId: string) => CanvasImageLike | null;
  resolveTask?: (taskId: string) => TaskCardData | null;
  /** Title of frames without a name, in the viewer's language. */
  frameTitle?: string;
  cache?: RenderCache;
  /** Set false to always trace commands instead of building `Path2D`s. */
  usePath2D?: boolean;
};

export type RenderSceneOptions = ElementRenderOptions & {
  viewport: Viewport;
  /** Viewport size in CSS pixels. */
  width: number;
  height: number;
  pixelRatio: number;
  background: string;
  /**
   * Grid spacing in board units; 0 hides the grid. Only drawn when `pattern`
   * is left out (callers from before background patterns existed).
   */
  gridSize: number;
  /** Background pattern; "plain" draws none. */
  pattern?: BackgroundPattern;
  /** Pattern spacing in board units (default 24). */
  patternSize?: number;
  /** Elements the caller draws itself (e.g. the one being edited). */
  skipIds?: Set<string>;
};

export type RenderStats = { drawn: number; culled: number };

function finite(value: number, fallback = 0): number {
  return Number.isFinite(value) ? value : fallback;
}

/** Board coordinates of a screen point (CSS pixels). */
export function screenToBoard(
  viewport: Viewport,
  x: number,
  y: number,
): { x: number; y: number } {
  const zoom = finite(viewport.zoom, 1) || 1;
  return { x: x / zoom - viewport.scrollX, y: y / zoom - viewport.scrollY };
}

/** Screen coordinates (CSS pixels) of a board point. */
export function boardToScreen(
  viewport: Viewport,
  x: number,
  y: number,
): { x: number; y: number } {
  const zoom = finite(viewport.zoom, 1) || 1;
  return { x: (x + viewport.scrollX) * zoom, y: (y + viewport.scrollY) * zoom };
}

/** The part of the board a viewport of `width` x `height` CSS pixels shows. */
export function visibleBoardRect(
  viewport: Viewport,
  width: number,
  height: number,
): RenderBox {
  const zoom = finite(viewport.zoom, 1) || 1;
  return {
    x: -finite(viewport.scrollX),
    y: -finite(viewport.scrollY),
    width: Math.max(0, width) / zoom,
    height: Math.max(0, height) / zoom,
  };
}

function boxesIntersect(a: RenderBox, b: RenderBox): boolean {
  return (
    a.x <= b.x + b.width &&
    b.x <= a.x + a.width &&
    a.y <= b.y + b.height &&
    b.y <= a.y + a.height
  );
}

function intersectBoxes(a: RenderBox, b: RenderBox): RenderBox | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (right < x || bottom < y) return null;
  return { x, y, width: right - x, height: bottom - y };
}

const isHighlight = (el: BoardElement) =>
  el.type === "draw" && el.penStyle === "highlighter";

/**
 * Stacking order: order key, then highlighter strokes beneath others of the
 * same key, then id, so every client agrees.
 */
export function compareRenderOrder(a: BoardElement, b: BoardElement): number {
  if (a.order < b.order) return -1;
  if (a.order > b.order) return 1;
  const highlightA = isHighlight(a);
  if (highlightA !== isHighlight(b)) return highlightA ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function taskSignature(task: TaskCardData | null | undefined): string {
  if (!task) return "-";
  return [
    task.key,
    task.title,
    task.statusName,
    task.statusColor,
    task.assigneeName,
    task.dueDate,
    task.priority,
    task.done ? 1 : 0,
  ].join("\u0001");
}

/**
 * Fields that never change an element's local drawing: where it sits, how it
 * is turned and faded (applied when it is painted), and bookkeeping. A moved
 * or turned element reuses its drawing.
 */
const PLACEMENT_FIELDS = new Set([
  "id",
  "x",
  "y",
  "angle",
  "opacity",
  "version",
  "nonce",
  "order",
  "groupIds",
  "frameId",
  "locked",
  "link",
  "startBinding",
  "endBinding",
  "createdAt",
  "createdBy",
  "updatedAt",
  "updatedBy",
]);

/** Arrays (points, pressures) count by identity: copying one is cheap to spot. */
const arrayIds = new WeakMap<object, number>();
let nextArrayId = 1;

function arrayId(value: object): number {
  let found = arrayIds.get(value);
  if (found === undefined) {
    found = nextArrayId++;
    arrayIds.set(value, found);
  }
  return found;
}

/**
 * Everything that shapes an element's local drawing. Editors preview a drag
 * or resize on copies that only get a fresh nonce, so the key follows the
 * content, never the version or nonce: a preview that only moves elements
 * rebuilds nothing.
 */
function drawingKey(
  el: BoardElement,
  theme: RenderTheme,
  background: string,
  task: string,
): string {
  let key = `${theme}|${background}|${task}`;
  const record = el as unknown as Record<string, unknown>;
  for (const field in record) {
    if (PLACEMENT_FIELDS.has(field)) continue;
    const value = record[field];
    if (value === null || typeof value !== "object") {
      key += `|${field}=${String(value)}`;
    } else if (Array.isArray(value)) {
      key += `|${field}#${arrayId(value)}:${value.length}`;
    } else {
      key += `|${field}=${JSON.stringify(value)}`;
    }
  }
  return key;
}

type CacheEntry = {
  key: string;
  /** The element the drawing was last checked against. */
  source: BoardElement;
  context: string;
  drawing: ElementDrawing;
  paths: WeakMap<PathItem, PathLike>;
};

/** Per-element display lists (and `Path2D`s), keyed by id and content. */
export class RenderCache {
  private readonly entries = new Map<string, CacheEntry>();

  get size(): number {
    return this.entries.size;
  }

  entry(
    el: BoardElement,
    theme: RenderTheme,
    background: string,
    task: TaskCardData | null | undefined,
    build: () => ElementDrawing,
    /** Anything else outside the element that its drawing shows. */
    variant = "",
  ): CacheEntry {
    const signature = variant
      ? `${taskSignature(task)}|${variant}`
      : taskSignature(task);
    const context = `${theme}|${background}|${signature}`;
    const found = this.entries.get(el.id);
    // The same element object in the same context: nothing to compare.
    if (found && found.source === el && found.context === context) return found;
    const key = drawingKey(el, theme, background, signature);
    if (found && found.key === key) {
      found.source = el;
      found.context = context;
      return found;
    }
    const created: CacheEntry = {
      key,
      source: el,
      context,
      drawing: build(),
      paths: new WeakMap(),
    };
    this.entries.set(el.id, created);
    return created;
  }

  /** Drops entries for elements that are no longer on the board. */
  prune(liveIds: ReadonlySet<string>): void {
    for (const id of this.entries.keys()) {
      if (!liveIds.has(id)) this.entries.delete(id);
    }
  }

  clear(): void {
    this.entries.clear();
  }
}

const sharedCache = new RenderCache();

function pathConstructor(enabled: boolean | undefined): PathConstructor | null {
  if (enabled === false) return null;
  const candidate = (globalThis as { Path2D?: unknown }).Path2D;
  return typeof candidate === "function"
    ? (candidate as PathConstructor)
    : null;
}

function trace(target: PathLike, ops: readonly PathOp[]): void {
  for (const op of ops) {
    if (op[0] === "M") target.moveTo(op[1], op[2]);
    else if (op[0] === "L") target.lineTo(op[1], op[2]);
    else if (op[0] === "C")
      target.bezierCurveTo(op[1], op[2], op[3], op[4], op[5], op[6]);
    else target.closePath();
  }
}

function paintPath(
  ctx: RenderContext,
  item: PathItem,
  entry: CacheEntry | null,
  Path: PathConstructor | null,
): void {
  let path: PathLike | null = null;
  if (Path) {
    path = entry?.paths.get(item) ?? null;
    if (!path) {
      path = new Path();
      trace(path, item.ops);
      entry?.paths.set(item, path);
    }
  }
  const apply = (action: "fill" | "stroke") => {
    if (path) {
      if (action === "fill") ctx.fill(path);
      else ctx.stroke(path);
      return;
    }
    ctx.beginPath();
    trace(ctx, item.ops);
    if (action === "fill") ctx.fill();
    else ctx.stroke();
  };
  const layered = item.alpha !== undefined || item.blend !== undefined;
  if (layered) {
    ctx.save();
    if (item.alpha !== undefined) {
      ctx.globalAlpha *= Math.min(1, Math.max(0, finite(item.alpha, 1)));
    }
    if (item.blend && "globalCompositeOperation" in ctx) {
      ctx.globalCompositeOperation = item.blend;
    }
  }
  if (item.fill && !isTransparentColor(item.fill)) {
    ctx.fillStyle = item.fill;
    if (item.shadow) {
      ctx.save();
      ctx.shadowColor = item.shadow.color;
      ctx.shadowBlur = item.shadow.blur;
      ctx.shadowOffsetX = item.shadow.offsetX;
      ctx.shadowOffsetY = item.shadow.offsetY;
      apply("fill");
      ctx.restore();
    } else apply("fill");
  }
  if (
    item.stroke &&
    !isTransparentColor(item.stroke) &&
    (item.lineWidth ?? 1) > 0
  ) {
    ctx.strokeStyle = item.stroke;
    ctx.lineWidth = item.lineWidth ?? 1;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.setLineDash(item.dash ?? []);
    apply("stroke");
    if (item.dash) ctx.setLineDash([]);
  }
  if (layered) ctx.restore();
}

function paintText(ctx: RenderContext, item: TextItem): void {
  ctx.font = item.font;
  ctx.fillStyle = item.color;
  ctx.textAlign = item.align;
  ctx.textBaseline = "alphabetic";
  const x = textAnchorX(item);
  item.lines.forEach((line, index) => {
    if (line) ctx.fillText(line, x, textBaseline(item, index));
  });
}

function paintImage(
  ctx: RenderContext,
  item: ImageItem,
  options: ElementRenderOptions,
  Path: PathConstructor | null,
): void {
  const image = item.assetId
    ? (options.resolveImage?.(item.assetId) ?? null)
    : null;
  if (image && item.width > 0 && item.height > 0) {
    if (item.crop) {
      ctx.drawImage(
        image,
        item.crop.x,
        item.crop.y,
        item.crop.width,
        item.crop.height,
        item.x,
        item.y,
        item.width,
        item.height,
      );
    } else ctx.drawImage(image, item.x, item.y, item.width, item.height);
    return;
  }
  for (const part of imagePlaceholder(item.width, item.height, options.theme)) {
    paintPath(ctx, part, null, Path);
  }
}

function paintItems(
  ctx: RenderContext,
  items: readonly DrawItem[],
  entry: CacheEntry | null,
  options: ElementRenderOptions,
  Path: PathConstructor | null,
): void {
  for (const item of items) {
    if (item.kind === "path") paintPath(ctx, item, entry, Path);
    else if (item.kind === "text") paintText(ctx, item);
    else paintImage(ctx, item, options, Path);
  }
}

/**
 * Draws one element in board units onto the context's current transform.
 * Deleted elements draw nothing.
 */
export function renderElement(
  ctx: RenderContext,
  el: BoardElement,
  options: ElementRenderOptions,
): void {
  if (el.deleted) return;
  const theme = options.theme;
  const background = themeColor(
    options.background ?? "#ffffff",
    theme,
    "#ffffff",
  );
  const task =
    el.type === "task" ? (options.resolveTask?.(el.taskId) ?? null) : undefined;
  const cache = options.cache ?? sharedCache;
  const frameTitle =
    el.type === "frame" && !el.name.trim() ? (options.frameTitle ?? "") : "";
  const entry = cache.entry(
    el,
    theme,
    background,
    task,
    () =>
      buildElementDrawing(el, {
        theme,
        measure: options.measureText,
        background,
        task,
        frameTitle,
      }),
    frameTitle,
  );
  const { drawing } = entry;
  if (drawing.items.length === 0) return;
  const Path = pathConstructor(options.usePath2D);
  ctx.save();
  const opacity = Math.min(100, Math.max(0, finite(el.opacity, 100))) / 100;
  ctx.globalAlpha *= opacity;
  ctx.translate(finite(el.x) + drawing.pivotX, finite(el.y) + drawing.pivotY);
  const angle = finite(el.angle);
  if (angle !== 0) ctx.rotate(angle);
  ctx.translate(-drawing.pivotX, -drawing.pivotY);
  paintItems(ctx, drawing.items, entry, options, Path);
  ctx.restore();
}

function drawGrid(
  ctx: RenderContext,
  visible: RenderBox,
  gridSize: number,
  zoom: number,
  theme: RenderTheme,
): void {
  let step = gridSize;
  // Keep lines at least 8 screen pixels apart when zoomed out.
  while (step * zoom < 8) step *= 5;
  const startX = Math.floor(visible.x / step) * step;
  const startY = Math.floor(visible.y / step) * step;
  const endX = visible.x + visible.width;
  const endY = visible.y + visible.height;
  if ((endX - startX) / step + (endY - startY) / step > 4000) return;
  ctx.beginPath();
  for (let x = startX; x <= endX; x += step) {
    ctx.moveTo(x, visible.y);
    ctx.lineTo(x, endY);
  }
  for (let y = startY; y <= endY; y += step) {
    ctx.moveTo(visible.x, y);
    ctx.lineTo(endX, y);
  }
  ctx.strokeStyle =
    theme === "dark" ? "rgba(255, 255, 255, 0.07)" : "rgba(0, 0, 0, 0.07)";
  ctx.lineWidth = 1 / zoom;
  ctx.setLineDash([]);
  ctx.stroke();
}

/** Patterns fade out below this many screen pixels between marks and vanish at it. */
export const PATTERN_MIN_SCREEN_SPACING = 6;
const PATTERN_FADE_SPACING = 12;
const PATTERN_MAX_MARKS = 20_000;
const DEFAULT_PATTERN_SIZE = 24;
const MAJOR_GRID_EVERY = 5;

/** Clamps a pattern size the way board settings do. */
export function patternSpacing(size: number | undefined): number {
  if (typeof size !== "number" || !Number.isFinite(size)) {
    return DEFAULT_PATTERN_SIZE;
  }
  return Math.min(200, Math.max(8, size));
}

/**
 * How strongly a pattern shows at this zoom: 0 when its marks would be
 * closer than PATTERN_MIN_SCREEN_SPACING pixels, easing to 1 as they spread.
 */
export function patternFade(size: number, zoom: number): number {
  const spacing = size * zoom;
  if (!(spacing >= PATTERN_MIN_SCREEN_SPACING)) return 0;
  return Math.min(
    1,
    (spacing - PATTERN_MIN_SCREEN_SPACING) /
      (PATTERN_FADE_SPACING - PATTERN_MIN_SCREEN_SPACING),
  );
}

function patternInk(theme: RenderTheme, alpha: number): string {
  const channel = theme === "dark" ? "255, 255, 255" : "0, 0, 0";
  return `rgba(${channel}, ${Math.round(alpha * 1000) / 1000})`;
}

/** Dots, a grid or ruled lines on board coordinates, so they pan and zoom. */
function drawPattern(
  ctx: RenderContext,
  visible: RenderBox,
  pattern: BackgroundPattern,
  size: number,
  zoom: number,
  theme: RenderTheme,
): void {
  if (pattern !== "dots" && pattern !== "grid" && pattern !== "lines") return;
  const fade = patternFade(size, zoom);
  if (fade <= 0) return;
  const dark = theme === "dark";
  const endX = visible.x + visible.width;
  const endY = visible.y + visible.height;
  const columns = Math.ceil(visible.width / size) + 1;
  const rows = Math.ceil(visible.height / size) + 1;
  ctx.setLineDash([]);
  if (pattern === "dots") {
    // Skipping whole rows and columns keeps the remaining dots on the lattice.
    let step = size;
    while (
      (visible.width / step + 1) * (visible.height / step + 1) >
      PATTERN_MAX_MARKS
    ) {
      step *= 2;
    }
    const dot = 1.5 / zoom;
    ctx.fillStyle = patternInk(theme, (dark ? 0.2 : 0.24) * fade);
    for (let x = Math.floor(visible.x / step) * step; x <= endX; x += step) {
      for (let y = Math.floor(visible.y / step) * step; y <= endY; y += step) {
        ctx.fillRect(x - dot / 2, y - dot / 2, dot, dot);
      }
    }
    return;
  }
  if (columns + rows > PATTERN_MAX_MARKS) return;
  ctx.lineWidth = 1 / zoom;
  const minor = (dark ? 0.06 : 0.07) * fade;
  const major = (dark ? 0.11 : 0.13) * fade;
  const firstRow = Math.floor(visible.y / size);
  const lastRow = Math.ceil(endY / size);
  const firstColumn = Math.floor(visible.x / size);
  const lastColumn = Math.ceil(endX / size);
  const strokeLines = (strong: boolean | null) => {
    ctx.beginPath();
    for (let row = firstRow; row <= lastRow; row++) {
      if (strong !== null && (row % MAJOR_GRID_EVERY === 0) !== strong)
        continue;
      ctx.moveTo(visible.x, row * size);
      ctx.lineTo(endX, row * size);
    }
    if (pattern === "grid") {
      for (let column = firstColumn; column <= lastColumn; column++) {
        if (strong !== null && (column % MAJOR_GRID_EVERY === 0) !== strong) {
          continue;
        }
        ctx.moveTo(column * size, visible.y);
        ctx.lineTo(column * size, endY);
      }
    }
    ctx.stroke();
  };
  if (pattern === "lines") {
    ctx.strokeStyle = patternInk(theme, major * 0.85);
    strokeLines(null);
    return;
  }
  ctx.strokeStyle = patternInk(theme, minor);
  strokeLines(false);
  ctx.strokeStyle = patternInk(theme, major);
  strokeLines(true);
}

/**
 * Draws the whole board for a viewport. The context's transform is reset;
 * the canvas is expected to be `width * pixelRatio` by `height * pixelRatio`.
 */
export function renderScene(
  ctx: RenderContext,
  elements: readonly BoardElement[],
  options: RenderSceneOptions,
): RenderStats {
  const zoom = finite(options.viewport.zoom, 1) || 1;
  const ratio = finite(options.pixelRatio, 1) || 1;
  const scrollX = finite(options.viewport.scrollX);
  const scrollY = finite(options.viewport.scrollY);
  const theme = options.theme;
  const cache = options.cache ?? sharedCache;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  const background = themeColor(options.background, theme, "#ffffff");
  const pixelWidth = Math.max(0, options.width) * ratio;
  const pixelHeight = Math.max(0, options.height) * ratio;
  ctx.clearRect(0, 0, pixelWidth, pixelHeight);
  if (!isTransparentColor(background)) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, pixelWidth, pixelHeight);
  }
  const scale = ratio * zoom;
  ctx.setTransform(scale, 0, 0, scale, scale * scrollX, scale * scrollY);
  const visible = visibleBoardRect(
    { scrollX, scrollY, zoom },
    options.width,
    options.height,
  );
  if (options.pattern !== undefined) {
    drawPattern(
      ctx,
      visible,
      options.pattern,
      patternSpacing(options.patternSize),
      zoom,
      theme,
    );
  } else if (options.gridSize > 0 && Number.isFinite(options.gridSize)) {
    drawGrid(ctx, visible, options.gridSize, zoom, theme);
  }

  const frames = new Map<string, FrameElement>();
  const live: BoardElement[] = [];
  const liveIds = new Set<string>();
  for (const el of elements) {
    if (el.deleted) continue;
    liveIds.add(el.id);
    if (el.type === "frame") frames.set(el.id, el);
    if (options.skipIds?.has(el.id)) continue;
    live.push(el);
  }
  live.sort(compareRenderOrder);

  const elementOptions: ElementRenderOptions = { ...options, cache };
  const stats: RenderStats = { drawn: 0, culled: 0 };
  for (const el of live) {
    let bounds: RenderBox | null = elementSceneBounds(el);
    const frame =
      el.frameId && el.frameId !== el.id ? frames.get(el.frameId) : undefined;
    if (frame) bounds = intersectBoxes(bounds, elementSceneBounds(frame));
    if (!bounds || !boxesIntersect(bounds, visible)) {
      stats.culled++;
      continue;
    }
    if (frame) {
      ctx.save();
      const clip = frameClipPolygon(frame);
      ctx.beginPath();
      clip.forEach((point, index) => {
        if (index === 0) ctx.moveTo(point[0], point[1]);
        else ctx.lineTo(point[0], point[1]);
      });
      ctx.closePath();
      ctx.clip();
      renderElement(ctx, el, elementOptions);
      ctx.restore();
    } else renderElement(ctx, el, elementOptions);
    stats.drawn++;
  }
  if (cache.size > liveIds.size * 2 + 64) cache.prune(liveIds);
  return stats;
}
