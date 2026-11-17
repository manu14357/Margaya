// Turns untrusted input (a client's Yjs update, an uploaded file, an API body)
// into well-formed elements. Only known fields of the element's own type are
// copied; everything else is dropped. Geometry that cannot be trusted rejects
// the element; a bad style value falls back to its default.

import {
  DEFAULT_FILL_COLOR,
  DEFAULT_FONT_SIZE,
  DEFAULT_ORDER,
  DEFAULT_STROKE_COLOR,
  isNewer,
  pointsExtent,
  STICKY_FILL_COLOR,
} from "./create.js";
import {
  ARROW_HEADS,
  BACKGROUND_PATTERNS,
  type Binding,
  BOARD_LIMITS,
  type BoardElement,
  type BoardSettings,
  DEFAULT_BOARD_SETTINGS,
  ELEMENT_TYPES,
  type ElementType,
  FILL_STYLES,
  FONT_FAMILIES,
  LINE_ROUTINGS,
  type LocalPoint,
  PEN_STYLES,
  SHAPE_KINDS,
  type ShapeKind,
  STROKE_STYLES,
  TEXT_ALIGNS,
  type TextFields,
  VERTICAL_ALIGNS,
} from "./elements.js";
import { MAX_ORDER_LENGTH } from "./order.js";

type Raw = Record<string, unknown>;

/** Internal rejection: the element cannot be repaired. */
class Unrecoverable extends Error {}

const ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const ORDER_PATTERN = /^[0-9A-Za-z]+$/;
const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const CHANNEL = String.raw`\s*\d{1,3}(?:\.\d+)?%?\s*`;
const ALPHA = String.raw`\s*(?:0|1|0?\.\d+|\d{1,3}%)\s*`;
const RGB_COLOR = new RegExp(
  `^rgba?\\(${CHANNEL},${CHANNEL},${CHANNEL}(?:,${ALPHA})?\\)$`,
  "i",
);
// Whitespace, control characters, quotes and angle brackets never belong in a
// stored link; rejecting them keeps links inert wherever they are rendered.
const UNSAFE_LINK_CHARS = /[\s"'<>\\`]/;
const hasControlCharacter = (value: string) => {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
};
const WEB_LINK = /^https?:\/\/[^/?#@:]+(?::\d{1,5})?(?:[/?#].*)?$/i;
const MAIL_LINK = /^mailto:[^/?#]+@[^/?#]+(?:\?.*)?$/i;
export const ELEMENT_LINK_PREFIX = "#element=";

const MAX_GAP = 1_000;
const MAX_SETTINGS_GRID = 1_000;
const MIN_PATTERN_SIZE = 8;
const MAX_PATTERN_SIZE = 200;

// Plain objects only: class instances and objects with a custom prototype
// could supply fields through inheritance or getters.
const isRecord = (value: unknown): value is Raw => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
};

const clamp = (value: number, min: number, max: number) =>
  value < min ? min : value > max ? max : value;

/** Pen pressure in 0..1, kept to two decimals so long strokes stay small. */
export const quantizePressure = (value: number): number =>
  Math.round(clamp(value, 0, 1) * 100) / 100;

export function isValidId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= BOARD_LIMITS.maxIdLength &&
    ID_PATTERN.test(value)
  );
}

/** Accepts `#rgb`, `#rrggbb`, `#rrggbbaa`, `transparent`, `rgb()`/`rgba()`. */
export function isValidColor(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.length === 0 || value.length > BOARD_LIMITS.maxColorLength) {
    return false;
  }
  return (
    value === "transparent" || HEX_COLOR.test(value) || RGB_COLOR.test(value)
  );
}

/** Accepts http(s) and mailto links, or `#element=<id>` on the same board. */
export function isValidLink(value: unknown): value is string {
  if (typeof value !== "string") return false;
  if (value.length === 0 || value.length > BOARD_LIMITS.maxLinkLength) {
    return false;
  }
  if (value.startsWith(ELEMENT_LINK_PREFIX)) {
    return isValidId(value.slice(ELEMENT_LINK_PREFIX.length));
  }
  if (UNSAFE_LINK_CHARS.test(value) || hasControlCharacter(value)) return false;
  return WEB_LINK.test(value) || MAIL_LINK.test(value);
}

/** A finite number, or `fallback` when the field is absent. */
function geometryNumber(raw: Raw, key: string, fallback: number): number {
  const value = raw[key];
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Unrecoverable(key);
  }
  return value;
}

/** A finite number, or `fallback` when absent or unusable. */
function styleNumber(
  raw: Raw,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const value = raw[key];
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return clamp(value, min, max);
}

function pick<T extends string | number>(
  raw: Raw,
  key: string,
  allowed: readonly T[],
  fallback: T,
): T {
  const value = raw[key] as T;
  return allowed.includes(value) ? value : fallback;
}

function bool(raw: Raw, key: string, fallback: boolean): boolean {
  const value = raw[key];
  return typeof value === "boolean" ? value : fallback;
}

function cappedString(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function hashSeed(id: string): number {
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) {
    hash = Math.imul(hash ^ id.charCodeAt(i), 16777619);
  }
  return hash >>> 1 || 1;
}

const coordinate = (value: number) =>
  clamp(value, -BOARD_LIMITS.maxCoordinate, BOARD_LIMITS.maxCoordinate);
const dimension = (value: number) =>
  clamp(Math.abs(value), 0, BOARD_LIMITS.maxDimension);

function normalizeAngle(angle: number): number {
  const turn = Math.PI * 2;
  const normalized = angle % turn;
  return normalized < 0 ? normalized + turn : normalized;
}

function parsePoints(value: unknown, minimum: number): LocalPoint[] {
  if (!Array.isArray(value)) throw new Unrecoverable("points");
  if (value.length < minimum) throw new Unrecoverable("points");
  const limit = BOARD_LIMITS.maxDimension;
  return value.slice(0, BOARD_LIMITS.maxPoints).map((point) => {
    if (
      !Array.isArray(point) ||
      point.length < 2 ||
      typeof point[0] !== "number" ||
      typeof point[1] !== "number" ||
      !Number.isFinite(point[0]) ||
      !Number.isFinite(point[1])
    ) {
      throw new Unrecoverable("point");
    }
    return [clamp(point[0], -limit, limit), clamp(point[1], -limit, limit)];
  });
}

function parseBinding(value: unknown, ownId: string): Binding | null {
  if (!isRecord(value)) return null;
  const { elementId, focus, gap } = value;
  if (!isValidId(elementId) || elementId === ownId) return null;
  let fx = 0.5;
  let fy = 0.5;
  if (Array.isArray(focus) && focus.length >= 2) {
    if (typeof focus[0] === "number" && Number.isFinite(focus[0])) {
      fx = clamp(focus[0], 0, 1);
    }
    if (typeof focus[1] === "number" && Number.isFinite(focus[1])) {
      fy = clamp(focus[1], 0, 1);
    }
  }
  const safeGap =
    typeof gap === "number" && Number.isFinite(gap)
      ? clamp(gap, 0, MAX_GAP)
      : 0;
  return { elementId, focus: [fx, fy], gap: safeGap };
}

function parseText(
  raw: Raw,
  align: TextFields["textAlign"],
  vertical: TextFields["verticalAlign"],
): TextFields {
  return {
    text: cappedString(raw.text, BOARD_LIMITS.maxTextLength),
    fontSize: styleNumber(
      raw,
      "fontSize",
      DEFAULT_FONT_SIZE,
      1,
      BOARD_LIMITS.maxFontSize,
    ),
    fontFamily: pick(raw, "fontFamily", FONT_FAMILIES, "hand"),
    textAlign: pick(raw, "textAlign", TEXT_ALIGNS, align),
    verticalAlign: pick(raw, "verticalAlign", VERTICAL_ALIGNS, vertical),
  };
}

function parseBase(raw: Raw, id: string, type: ElementType) {
  const order =
    typeof raw.order === "string" &&
    raw.order.length >= 2 &&
    raw.order.length <= MAX_ORDER_LENGTH &&
    ORDER_PATTERN.test(raw.order)
      ? raw.order
      : DEFAULT_ORDER;
  const groupIds = Array.isArray(raw.groupIds)
    ? [...new Set(raw.groupIds.filter(isValidId))].slice(
        0,
        BOARD_LIMITS.maxGroupDepth,
      )
    : [];
  const frameId =
    isValidId(raw.frameId) && raw.frameId !== id && type !== "frame"
      ? raw.frameId
      : null;
  const version = styleNumber(raw, "version", 1, 1, Number.MAX_SAFE_INTEGER);
  const nonce = styleNumber(raw, "nonce", 0, 0, 2 ** 31);
  const seed = styleNumber(raw, "seed", hashSeed(id), 1, 2 ** 31 - 1);
  const sketch = styleNumber(raw, "sketch", 1, 0, 2);
  return {
    id,
    x: coordinate(geometryNumber(raw, "x", 0)),
    y: coordinate(geometryNumber(raw, "y", 0)),
    width: dimension(geometryNumber(raw, "width", 0)),
    height: dimension(geometryNumber(raw, "height", 0)),
    angle: normalizeAngle(geometryNumber(raw, "angle", 0)),
    strokeColor: isValidColor(raw.strokeColor)
      ? raw.strokeColor
      : DEFAULT_STROKE_COLOR,
    fillColor: isValidColor(raw.fillColor)
      ? raw.fillColor
      : type === "sticky"
        ? STICKY_FILL_COLOR
        : DEFAULT_FILL_COLOR,
    fillStyle: pick(raw, "fillStyle", FILL_STYLES, "solid"),
    strokeWidth: styleNumber(
      raw,
      "strokeWidth",
      2,
      0,
      BOARD_LIMITS.maxStrokeWidth,
    ),
    strokeStyle: pick(raw, "strokeStyle", STROKE_STYLES, "solid"),
    sketch: Math.round(sketch) as 0 | 1 | 2,
    opacity: Math.round(styleNumber(raw, "opacity", 100, 0, 100)),
    order,
    groupIds,
    frameId,
    locked: bool(raw, "locked", false),
    link: isValidLink(raw.link) ? raw.link : null,
    seed: Math.round(seed),
    version: Math.floor(version),
    nonce: Math.floor(nonce),
    deleted: bool(raw, "deleted", false),
    updatedAt: styleNumber(raw, "updatedAt", 0, 0, Number.MAX_SAFE_INTEGER),
    updatedBy:
      typeof raw.updatedBy === "string" &&
      raw.updatedBy.length <= BOARD_LIMITS.maxIdLength
        ? raw.updatedBy
        : null,
  };
}

function parseTyped(raw: Raw): BoardElement {
  const type = raw.type as ElementType;
  if (!ELEMENT_TYPES.includes(type)) throw new Unrecoverable("type");
  if (!isValidId(raw.id)) throw new Unrecoverable("id");
  const base = parseBase(raw, raw.id, type);
  switch (type) {
    case "rectangle":
      return {
        ...base,
        ...parseText(raw, "center", "middle"),
        type,
        cornerRadius: styleNumber(
          raw,
          "cornerRadius",
          0,
          0,
          BOARD_LIMITS.maxDimension,
        ),
      };
    case "ellipse":
    case "diamond":
    case "sticky":
      return { ...base, ...parseText(raw, "center", "middle"), type };
    case "text":
      return {
        ...base,
        ...parseText(raw, "left", "top"),
        type,
        autoSize: bool(raw, "autoSize", true),
      };
    case "arrow":
    case "line": {
      const placed = placePoints(base, parsePoints(raw.points, 2));
      return {
        ...placed,
        ...parseText(raw, "center", "middle"),
        type,
        routing: pick(raw, "routing", LINE_ROUTINGS, "straight"),
        startHead: pick(raw, "startHead", ARROW_HEADS, "none"),
        endHead: pick(
          raw,
          "endHead",
          ARROW_HEADS,
          type === "arrow" ? "arrow" : "none",
        ),
        startBinding: parseBinding(raw.startBinding, base.id),
        endBinding: parseBinding(raw.endBinding, base.id),
      };
    }
    case "draw": {
      const placed = placePoints(base, parsePoints(raw.points, 1));
      const pressures =
        Array.isArray(raw.pressures) &&
        raw.pressures.length === placed.points.length &&
        raw.pressures.every(
          (value) => typeof value === "number" && Number.isFinite(value),
        )
          ? (raw.pressures as number[]).map(quantizePressure)
          : [];
      return {
        ...placed,
        type,
        pressures,
        simulatePressure: bool(raw, "simulatePressure", pressures.length === 0),
        // Boards saved before pen styles existed have no field: a plain pen.
        penStyle: pick(raw, "penStyle", PEN_STYLES, "pen"),
      };
    }
    case "image":
      return {
        ...base,
        type,
        assetId: isValidId(raw.assetId) ? raw.assetId : null,
        crop: parseCrop(raw.crop),
      };
    case "frame":
      return {
        ...base,
        type,
        name: cappedString(raw.name, BOARD_LIMITS.maxNameLength),
      };
    case "task":
      if (!isValidId(raw.taskId)) throw new Unrecoverable("taskId");
      return { ...base, type, taskId: raw.taskId };
    case "shape": {
      const shape = raw.shape as ShapeKind;
      if (!SHAPE_KINDS.includes(shape)) throw new Unrecoverable("shape");
      return { ...base, ...parseText(raw, "center", "middle"), type, shape };
    }
  }
}

/** Moves the first point to [0, 0] and derives width/height from the points. */
function placePoints<B extends { x: number; y: number }>(
  base: B,
  points: LocalPoint[],
): B & { points: LocalPoint[]; width: number; height: number } {
  const [ox, oy] = points[0];
  const local =
    ox === 0 && oy === 0
      ? points
      : points.map(([px, py]) => [px - ox, py - oy] as const);
  const extent = pointsExtent(local);
  return {
    ...base,
    x: coordinate(base.x + ox),
    y: coordinate(base.y + oy),
    points: local,
    width: dimension(extent.maxX - extent.minX),
    height: dimension(extent.maxY - extent.minY),
  };
}

function parseCrop(value: unknown): {
  x: number;
  y: number;
  width: number;
  height: number;
} | null {
  if (!isRecord(value)) return null;
  const fields = [value.x, value.y, value.width, value.height];
  if (
    !fields.every(
      (field) =>
        typeof field === "number" && Number.isFinite(field) && field >= 0,
    )
  ) {
    return null;
  }
  const [x, y, width, height] = (fields as number[]).map((field) =>
    Math.min(field, BOARD_LIMITS.maxDimension),
  );
  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

/**
 * A well-formed element built only from allowed fields of `raw`, or null when
 * the input cannot be repaired (unknown type, bad id, broken geometry).
 */
export function parseElement(raw: unknown): BoardElement | null {
  if (!isRecord(raw)) return null;
  try {
    return parseTyped(raw);
  } catch (error) {
    if (error instanceof Unrecoverable) return null;
    throw error;
  }
}

export function parseSettings(raw: unknown): BoardSettings {
  if (!isRecord(raw)) return { ...DEFAULT_BOARD_SETTINGS };
  const gridSize =
    typeof raw.gridSize === "number" && Number.isFinite(raw.gridSize)
      ? Math.round(clamp(raw.gridSize, 0, MAX_SETTINGS_GRID))
      : DEFAULT_BOARD_SETTINGS.gridSize;
  const patternSize =
    typeof raw.patternSize === "number" && Number.isFinite(raw.patternSize)
      ? Math.round(clamp(raw.patternSize, MIN_PATTERN_SIZE, MAX_PATTERN_SIZE))
      : DEFAULT_BOARD_SETTINGS.patternSize;
  return {
    background: isValidColor(raw.background)
      ? raw.background
      : DEFAULT_BOARD_SETTINGS.background,
    gridSize,
    pattern: pick(
      raw,
      "pattern",
      BACKGROUND_PATTERNS,
      DEFAULT_BOARD_SETTINGS.pattern,
    ),
    patternSize,
  };
}

/**
 * Parses a list of untrusted elements: drops unrecoverable entries, keeps
 * the newer copy of a repeated id, and stops at the element limit.
 */
export function sanitizeElements(raw: unknown): BoardElement[] {
  if (!Array.isArray(raw)) return [];
  const byId = new Map<string, BoardElement>();
  for (const entry of raw) {
    const element = parseElement(entry);
    if (!element) continue;
    const existing = byId.get(element.id);
    if (existing) {
      if (isNewer(element, existing)) byId.set(element.id, element);
      continue;
    }
    if (byId.size >= BOARD_LIMITS.maxElements) continue;
    byId.set(element.id, element);
  }
  return [...byId.values()];
}
