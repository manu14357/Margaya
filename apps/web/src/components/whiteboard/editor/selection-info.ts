import type {
  BoardElement,
  PenStyle,
  StickyElement,
} from "@margaya/whiteboard";
import { isSwappableShape, shapeChoiceOf } from "./shapes";
import type { ShapeChoice } from "./tools";

// What the current selection supports, shared by the properties panel and
// the context menu so both offer the same actions.

const SHAPES = new Set(["rectangle", "ellipse", "diamond", "shape"]);
const STROKED = new Set([
  "rectangle",
  "ellipse",
  "diamond",
  "shape",
  "arrow",
  "line",
  "draw",
  "text",
]);
const TEXTUAL = new Set([
  "rectangle",
  "ellipse",
  "diamond",
  "shape",
  "sticky",
  "text",
  "arrow",
  "line",
]);

export type SelectionInfo = {
  elements: BoardElement[];
  count: number;
  hasStroke: boolean;
  hasFill: boolean;
  hasSticky: boolean;
  hasText: boolean;
  hasLinear: boolean;
  hasRectangle: boolean;
  hasSketch: boolean;
  hasDraw: boolean;
  /** Every element is a shape whose outline "Change shape" can swap. */
  allShapes: boolean;
  /** The outline all shapes share, or null when they differ. */
  shapeChoice: ShapeChoice | null;
  /** The pen style all drawings share, or null when they differ. */
  penStyle: PenStyle | null;
  stickies: StickyElement[];
  allLocked: boolean;
  anyLocked: boolean;
  grouped: boolean;
  /** A single arrow bound to two task cards, as source and target. */
  dependency: { sourceTaskId: string; targetTaskId: string } | null;
  link: string | null;
};

export function describeSelection(
  elements: readonly BoardElement[],
  lookup: (id: string) => BoardElement | undefined,
): SelectionInfo {
  const types = new Set(elements.map((element) => element.type));
  const has = (set: ReadonlySet<string>) =>
    [...types].some((type) => set.has(type));
  const stickies = elements.filter(
    (element): element is StickyElement => element.type === "sticky",
  );
  const only = elements.length === 1 ? elements[0] : undefined;
  const link = only ? dependencyLinkOf(only, lookup) : null;
  const choices = new Set(elements.map((element) => shapeChoiceOf(element)));
  const drawings = elements.filter((element) => element.type === "draw");
  const penStyles = new Set(
    drawings.map((element) => element.penStyle ?? "pen"),
  );
  const dependency: SelectionInfo["dependency"] = link
    ? { sourceTaskId: link.sourceTaskId, targetTaskId: link.targetTaskId }
    : null;
  return {
    elements: [...elements],
    count: elements.length,
    hasStroke: has(STROKED),
    hasFill: has(SHAPES),
    hasSticky: stickies.length > 0,
    hasText: has(TEXTUAL),
    hasLinear: types.has("arrow") || types.has("line"),
    hasRectangle: types.has("rectangle"),
    hasSketch: has(SHAPES) || types.has("arrow") || types.has("line"),
    hasDraw: drawings.length > 0,
    allShapes:
      elements.length > 0 &&
      elements.every((element) => isSwappableShape(element.type)),
    shapeChoice: choices.size === 1 ? ([...choices][0] ?? null) : null,
    penStyle: penStyles.size === 1 ? ([...penStyles][0] ?? null) : null,
    stickies,
    allLocked:
      elements.length > 0 && elements.every((element) => element.locked),
    anyLocked: elements.some((element) => element.locked),
    grouped: elements.some((element) => element.groupIds.length > 0),
    dependency,
    link: only?.link ?? null,
  };
}

/** An arrow from one task card to another: the start task blocks the end task. */
export type DependencyLink = {
  arrowId: string;
  sourceTaskId: string;
  targetTaskId: string;
};

export function dependencyLinkOf(
  element: BoardElement,
  lookup: (id: string) => BoardElement | undefined,
): DependencyLink | null {
  if (element.type !== "arrow" || !element.startBinding || !element.endBinding)
    return null;
  const source = lookup(element.startBinding.elementId);
  const target = lookup(element.endBinding.elementId);
  if (
    source?.type !== "task" ||
    target?.type !== "task" ||
    !source.taskId ||
    !target.taskId ||
    source.taskId === target.taskId
  )
    return null;
  return {
    arrowId: element.id,
    sourceTaskId: source.taskId,
    targetTaskId: target.taskId,
  };
}

/** The value all elements share for a field, or null when they differ. */
const LINEAR = new Set(["arrow", "line"]);

/**
 * Which element types a Style panel option changes. Every element carries
 * the base style fields, but a sticky's fill is its note colour and a text
 * has no outline, so those fields must neither show as "mixed" nor change
 * when the option is used on a mixed selection.
 */
const STYLE_TYPES: Record<string, (type: string) => boolean> = {
  strokeColor: (type) => STROKED.has(type),
  strokeWidth: (type) => STROKED.has(type) && type !== "text",
  strokeStyle: (type) =>
    STROKED.has(type) && type !== "text" && type !== "draw",
  fillColor: (type) => SHAPES.has(type),
  fillStyle: (type) => SHAPES.has(type),
  sketch: (type) => SHAPES.has(type) || LINEAR.has(type),
  cornerRadius: (type) => type === "rectangle",
  fontFamily: (type) => TEXTUAL.has(type),
  fontSize: (type) => TEXTUAL.has(type),
  textAlign: (type) => TEXTUAL.has(type),
  routing: (type) => LINEAR.has(type),
  startHead: (type) => LINEAR.has(type),
  endHead: (type) => LINEAR.has(type),
  penStyle: (type) => type === "draw",
};

/** Whether the Style panel's `key` option applies to `element`. */
export function styleApplies(element: BoardElement, key: string): boolean {
  if (!(key in element)) return false;
  return STYLE_TYPES[key]?.(element.type) ?? true;
}

/** The part of a Style panel patch that applies to `element`. */
export function stylePatchFor(
  element: BoardElement,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const own: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (styleApplies(element, key)) own[key] = value;
  }
  return own;
}

/** The value of a Style panel option across the elements it applies to. */
export function sharedStyle<T>(
  elements: readonly BoardElement[],
  key: string,
): T | null {
  return sharedValue<T>(
    elements.filter((element) => styleApplies(element, key)),
    key,
  );
}

export function sharedValue<T>(
  elements: readonly BoardElement[],
  key: string,
): T | null {
  let value: T | undefined;
  for (const element of elements) {
    if (!(key in element)) continue;
    const next = (element as Record<string, unknown>)[key] as T;
    if (value === undefined) value = next;
    else if (value !== next) return null;
  }
  return value ?? null;
}
