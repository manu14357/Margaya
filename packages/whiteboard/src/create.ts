import type {
  BoardElement,
  ElementOf,
  ElementType,
  LocalPoint,
  TextFields,
} from "./elements.js";
import { newElementId, randomNonce, randomSeed } from "./ids.js";
import { ordersBetween } from "./order.js";

export const DEFAULT_STROKE_COLOR = "#1e1e1e";
export const DEFAULT_FILL_COLOR = "transparent";
export const STICKY_FILL_COLOR = "#fff3bf";
export const DEFAULT_FONT_SIZE = 20;
export const DEFAULT_ORDER = "a0";

/** Who makes an edit and when; both default to "unknown" and "now". */
export type ElementOptions = {
  userId?: string | null;
  now?: number;
};

type WithoutKeys<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

/** Fields an edit may change; `id` and `type` are fixed for life. */
export type ElementPatch<E extends BoardElement = BoardElement> = Partial<
  WithoutKeys<E, "id" | "type">
>;

/** Props accepted by createElement for one element type. */
export type ElementProps<T extends ElementType> = Partial<
  Omit<ElementOf<T>, "type">
>;

const textDefaults = (
  align: TextFields["textAlign"],
  vertical: TextFields["verticalAlign"],
): TextFields => ({
  text: "",
  fontSize: DEFAULT_FONT_SIZE,
  fontFamily: "hand",
  textAlign: align,
  verticalAlign: vertical,
});

/** Size of the box that holds a list of local points. */
export function pointsExtent(points: readonly LocalPoint[]): {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
} {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  if (points.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}

/**
 * Lines and drawings keep `width`/`height` equal to the extent of their
 * points, and their first point at [0, 0] (`x`/`y` is where it sits).
 */
function normalizePoints<E extends BoardElement>(element: E): E {
  if (!("points" in element)) return element;
  let points = element.points;
  let { x, y } = element;
  const first = points[0];
  if (first && (first[0] !== 0 || first[1] !== 0)) {
    const [ox, oy] = first;
    points = points.map(([px, py]) => [px - ox, py - oy] as const);
    x += ox;
    y += oy;
  }
  const extent = pointsExtent(points);
  return {
    ...element,
    x,
    y,
    points,
    width: extent.maxX - extent.minX,
    height: extent.maxY - extent.minY,
  };
}

function baseDefaults(options?: ElementOptions) {
  return {
    id: newElementId(),
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    angle: 0,
    strokeColor: DEFAULT_STROKE_COLOR,
    fillColor: DEFAULT_FILL_COLOR,
    fillStyle: "solid" as const,
    strokeWidth: 2,
    strokeStyle: "solid" as const,
    sketch: 1 as const,
    opacity: 100,
    order: DEFAULT_ORDER,
    groupIds: [] as string[],
    frameId: null,
    locked: false,
    link: null,
    seed: randomSeed(),
    version: 1,
    nonce: randomNonce(),
    deleted: false,
    updatedAt: options?.now ?? Date.now(),
    updatedBy: options?.userId ?? null,
  };
}

function defaultsFor(
  type: ElementType,
  options?: ElementOptions,
): BoardElement {
  const base = baseDefaults(options);
  switch (type) {
    case "rectangle":
      return {
        ...base,
        ...textDefaults("center", "middle"),
        type,
        width: 160,
        height: 100,
        cornerRadius: 0,
      };
    case "ellipse":
    case "diamond":
      return {
        ...base,
        ...textDefaults("center", "middle"),
        type,
        width: 160,
        height: 100,
      };
    case "sticky":
      return {
        ...base,
        ...textDefaults("center", "middle"),
        type,
        width: 200,
        height: 200,
        fillColor: STICKY_FILL_COLOR,
        strokeWidth: 1,
        sketch: 0,
      };
    case "text":
      return {
        ...base,
        ...textDefaults("left", "top"),
        type,
        width: 100,
        height: 25,
        autoSize: true,
      };
    case "arrow":
    case "line":
      return {
        ...base,
        ...textDefaults("center", "middle"),
        type,
        width: 100,
        height: 0,
        points: [
          [0, 0],
          [100, 0],
        ],
        routing: "straight",
        startHead: "none",
        endHead: type === "arrow" ? "arrow" : "none",
        startBinding: null,
        endBinding: null,
      };
    case "draw":
      return {
        ...base,
        type,
        width: 0,
        height: 0,
        points: [[0, 0]],
        pressures: [],
        simulatePressure: true,
        penStyle: "pen",
      };
    case "image":
      return {
        ...base,
        type,
        width: 200,
        height: 150,
        strokeWidth: 0,
        sketch: 0,
        assetId: null,
        crop: null,
      };
    case "frame":
      return {
        ...base,
        type,
        width: 480,
        height: 320,
        strokeWidth: 1,
        sketch: 0,
        name: "",
      };
    case "task":
      return {
        ...base,
        type,
        width: 260,
        height: 120,
        strokeWidth: 1,
        sketch: 0,
        taskId: "",
      };
    case "shape":
      return {
        ...base,
        ...textDefaults("center", "middle"),
        type,
        width: 160,
        height: 120,
        shape: "triangle",
      };
  }
}

/** A new element with every field filled in (fresh id, seed and nonce). */
export function createElement<T extends ElementType>(
  type: T,
  props?: ElementProps<T>,
  options?: ElementOptions,
): ElementOf<T> {
  const defaults = defaultsFor(type, options);
  const merged = { ...defaults, ...stripUndefined(props ?? {}), type };
  return normalizePoints(merged as BoardElement) as ElementOf<T>;
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(value) as (keyof T)[]) {
    if (value[key] !== undefined) out[key] = value[key];
  }
  return out;
}

/**
 * A copy with `patch` applied, the version bumped, a fresh nonce and the
 * editor stamped. The input is never mutated.
 */
export function updateElement<E extends BoardElement>(
  element: E,
  patch: ElementPatch<E>,
  options?: ElementOptions,
): E {
  const next = {
    ...element,
    ...stripUndefined(patch as object),
    id: element.id,
    type: element.type,
    version: element.version + 1,
    nonce: randomNonce(),
    updatedAt: options?.now ?? Date.now(),
    updatedBy:
      options?.userId !== undefined ? options.userId : element.updatedBy,
  } as E;
  return "points" in patch ? normalizePoints(next) : next;
}

/** Marks the element deleted (a tombstone that late edits cannot undo). */
export function deleteElement<E extends BoardElement>(
  element: E,
  options?: ElementOptions,
): E {
  return updateElement(element, { deleted: true } as ElementPatch<E>, options);
}

/**
 * Last writer wins: the higher version is newer; for equal versions the
 * lower nonce wins, so every client picks the same element.
 */
export function isNewer(a: BoardElement, b: BoardElement): boolean {
  if (a.version !== b.version) return a.version > b.version;
  return a.nonce < b.nonce;
}

/**
 * Re-stamps `next` so it wins over `current`. Use when `next` was computed
 * from an older snapshot (for example, the elements at the start of a drag),
 * so a write is never dropped as stale.
 */
export function rebaseElement<E extends BoardElement>(
  next: E,
  current: BoardElement | undefined,
): E {
  if (!current || current.version < next.version) return next;
  return { ...next, version: current.version + 1, nonce: randomNonce() };
}

export type DuplicateOptions = ElementOptions & {
  /** Copies go above this order key (default: the highest original). */
  above?: string | null;
  /** Copies go below this order key (default: open-ended). */
  below?: string | null;
};

/**
 * Copies of `elements` moved by `offset`, with new ids. Groups, frames and
 * line bindings inside the copied set point at the copies; bindings to
 * elements outside the set are dropped. Copies keep their relative order.
 */
export function duplicateElements(
  elements: readonly BoardElement[],
  offset: { x: number; y: number },
  options?: DuplicateOptions,
): BoardElement[] {
  const sorted = [...elements].sort(
    (a, b) =>
      (a.order < b.order ? -1 : a.order > b.order ? 1 : 0) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const idMap = new Map<string, string>();
  for (const element of sorted) idMap.set(element.id, newElementId());
  const groupMap = new Map<string, string>();
  const mapGroup = (groupId: string) => {
    let mapped = groupMap.get(groupId);
    if (!mapped) {
      mapped = newElementId();
      groupMap.set(groupId, mapped);
    }
    return mapped;
  };
  const above =
    options?.above !== undefined
      ? options.above
      : (sorted[sorted.length - 1]?.order ?? null);
  const below = options?.below ?? null;
  const keys = orderKeys(above, below, sorted.length);
  const now = options?.now ?? Date.now();
  const userId = options?.userId ?? null;

  return sorted.map((element, index) => {
    const copy = {
      ...element,
      id: idMap.get(element.id) as string,
      x: element.x + offset.x,
      y: element.y + offset.y,
      order: keys[index],
      groupIds: element.groupIds.map(mapGroup),
      frameId:
        element.frameId === null
          ? null
          : (idMap.get(element.frameId) ?? element.frameId),
      link: remapElementLink(element.link, idMap),
      seed: randomSeed(),
      version: 1,
      nonce: randomNonce(),
      deleted: false,
      updatedAt: now,
      updatedBy: userId,
    } as BoardElement;
    if (copy.type === "arrow" || copy.type === "line") {
      const remap = (binding: typeof copy.startBinding) => {
        if (!binding) return null;
        const target = idMap.get(binding.elementId);
        return target ? { ...binding, elementId: target } : null;
      };
      return {
        ...copy,
        startBinding: remap(copy.startBinding),
        endBinding: remap(copy.endBinding),
      };
    }
    return copy;
  });
}

const ELEMENT_LINK_PREFIX = "#element=";

function remapElementLink(
  link: string | null,
  idMap: Map<string, string>,
): string | null {
  if (!link?.startsWith(ELEMENT_LINK_PREFIX)) return link;
  const target = idMap.get(link.slice(ELEMENT_LINK_PREFIX.length));
  return target ? ELEMENT_LINK_PREFIX + target : link;
}

function orderKeys(
  above: string | null,
  below: string | null,
  count: number,
): string[] {
  try {
    return ordersBetween(above, below, count);
  } catch {
    return ordersBetween(null, null, count);
  }
}
