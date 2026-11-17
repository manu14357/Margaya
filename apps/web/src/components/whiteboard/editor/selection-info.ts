import type {
  BoardElement,
  PenStyle,
  StickyElement,
} from "@margaya/whiteboard";
import {
  type PanelProperty,
  selectionProperties,
  styleFieldApplies,
} from "./property-capabilities";
import { isSwappableShape, shapeChoiceOf } from "./shapes";
import type { ShapeChoice } from "./tools";

// What the current selection supports, shared by the properties panel and
// the context menu so both offer the same actions. Which style sections
// apply comes from property-capabilities.ts.

export type SelectionInfo = {
  elements: BoardElement[];
  count: number;
  /** The panel properties every selected element supports. */
  properties: ReadonlySet<PanelProperty>;
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
    properties: selectionProperties(elements),
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

/** Whether the Style panel's `key` option applies to `element`. */
export function styleApplies(element: BoardElement, key: string): boolean {
  if (!(key in element)) return false;
  return styleFieldApplies(element, key);
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

/** The value all elements share for a field, or null when they differ. */
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
