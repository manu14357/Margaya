import type { BoardElement, ElementType } from "@margaya/whiteboard";
import type { ToolId } from "./tools";

// Which properties panel sections apply to a tool or a selection. Derived
// from what each element type stores and what the renderer draws, so the
// panel never offers a control that changes nothing.

/** Panel properties in the order the panel shows them. */
export const PANEL_PROPERTIES = [
  // What it is.
  "penStyle",
  "shape",
  // Colour.
  "strokeColor",
  "stickyColor",
  "fill",
  "fillStyle",
  // Outline.
  "strokeWidth",
  "strokeStyle",
  "sketch",
  "corners",
  // Text.
  "font",
  "fontSize",
  "textAlign",
  // Lines.
  "routing",
  "arrowheads",
  // Everything.
  "opacity",
  // One element of a kind.
  "frameName",
  "crop",
] as const;
export type PanelProperty = (typeof PANEL_PROPERTIES)[number];

type Props = readonly PanelProperty[];

const SHAPE: Props = [
  "shape",
  "strokeColor",
  "fill",
  "fillStyle",
  "strokeWidth",
  "strokeStyle",
  "sketch",
  "font",
  "fontSize",
  "textAlign",
  "opacity",
];
const LINEAR: Props = [
  "strokeColor",
  "strokeWidth",
  "strokeStyle",
  "sketch",
  "routing",
  "arrowheads",
  "opacity",
];
/** A line's label is centred on it, so only its font and size apply. */
const LINEAR_LABEL: Props = ["font", "fontSize"];

const ELEMENT_PROPERTIES: Record<ElementType, Props> = {
  rectangle: [...SHAPE, "corners"],
  ellipse: SHAPE,
  diamond: SHAPE,
  shape: SHAPE,
  // A note's outline is never drawn and its fill is the note colour.
  sticky: ["stickyColor", "font", "fontSize", "textAlign", "opacity"],
  // A text's colour is its stroke colour; it has no outline.
  text: ["strokeColor", "font", "fontSize", "textAlign", "opacity"],
  arrow: LINEAR,
  line: LINEAR,
  // Freehand ink: no dashes and no hand-drawn wobble.
  draw: ["penStyle", "strokeColor", "strokeWidth", "opacity"],
  image: ["crop", "opacity"],
  // A frame's fill is its background; its name labels it.
  frame: ["fill", "frameName", "opacity"],
  // A task card draws the task, in the app's own colours.
  task: ["opacity"],
};

/** Properties that only make sense for one element at a time. */
const SINGLE_ONLY: ReadonlySet<PanelProperty> = new Set(["frameName", "crop"]);

/** The properties one element supports. */
export function elementProperties(
  element: BoardElement,
): ReadonlySet<PanelProperty> {
  const own = ELEMENT_PROPERTIES[element.type] ?? [];
  if ((element.type === "arrow" || element.type === "line") && element.text)
    return new Set([...own, ...LINEAR_LABEL]);
  return new Set(own);
}

/**
 * What a creation tool's next element takes from the panel, with nothing
 * selected. Tools that create nothing styled (select, hand, laser, eraser,
 * and the image and task dialogs) have none.
 */
const TOOL_PROPERTIES: Record<ToolId, Props> = {
  select: [],
  hand: [],
  laser: [],
  eraser: [],
  image: [],
  task: [],
  // New shapes centre their text and get their outline from the picker.
  rectangle: [...without(SHAPE, "shape", "textAlign"), "corners"],
  ellipse: without(SHAPE, "shape", "textAlign"),
  diamond: without(SHAPE, "shape", "textAlign"),
  shape: without(SHAPE, "shape", "textAlign"),
  // New lines have no label yet, and no arrowheads.
  arrow: LINEAR,
  line: without(LINEAR, "arrowheads"),
  draw: ["penStyle", "strokeColor", "strokeWidth", "opacity"],
  text: ["strokeColor", "font", "fontSize", "textAlign", "opacity"],
  sticky: ["stickyColor", "font", "fontSize", "opacity"],
  // A new frame keeps its own look; only the opacity carries over.
  frame: ["opacity"],
};

function without(list: Props, ...drop: PanelProperty[]): Props {
  return list.filter((property) => !drop.includes(property));
}

export function toolProperties(tool: ToolId): ReadonlySet<PanelProperty> {
  return new Set(TOOL_PROPERTIES[tool] ?? []);
}

/**
 * The properties every selected element supports: a mixed selection shows
 * only what applies to all of it.
 */
export function selectionProperties(
  elements: readonly BoardElement[],
): ReadonlySet<PanelProperty> {
  const [first, ...rest] = elements;
  if (!first) return new Set();
  const shared = new Set(elementProperties(first));
  for (const element of rest) {
    const own = elementProperties(element);
    for (const property of shared) {
      if (!own.has(property)) shared.delete(property);
    }
  }
  if (elements.length > 1) {
    for (const property of SINGLE_ONLY) shared.delete(property);
  }
  return shared;
}

/** The text style an element's words take, in panel order. */
const TEXT_STYLE: Props = ["strokeColor", "font", "fontSize", "textAlign"];

/**
 * The properties the panel offers while an element's words are being
 * edited: its text style (colour, font, size and alignment where it has
 * them). A line's label can be styled before its first letter, and a
 * frame's name keeps its fixed style, so a frame being renamed has none.
 */
export function editingProperties(
  element: BoardElement,
): ReadonlySet<PanelProperty> {
  const own = elementProperties(element);
  const linear = element.type === "arrow" || element.type === "line";
  return new Set(
    TEXT_STYLE.filter(
      (property) =>
        own.has(property) || (linear && LINEAR_LABEL.includes(property)),
    ),
  );
}

/** The panel sections for the current selection, or the tool when empty. */
export function panelProperties(
  tool: ToolId,
  selected: readonly BoardElement[],
): ReadonlySet<PanelProperty> {
  return selected.length > 0
    ? selectionProperties(selected)
    : toolProperties(tool);
}

/** The panel property a style field belongs to (for patches and reads). */
const STYLE_FIELD_PROPERTY: Record<string, PanelProperty> = {
  strokeColor: "strokeColor",
  strokeWidth: "strokeWidth",
  strokeStyle: "strokeStyle",
  fillColor: "fill",
  fillStyle: "fillStyle",
  sketch: "sketch",
  cornerRadius: "corners",
  fontFamily: "font",
  fontSize: "fontSize",
  textAlign: "textAlign",
  routing: "routing",
  startHead: "arrowheads",
  endHead: "arrowheads",
  penStyle: "penStyle",
  opacity: "opacity",
};

/**
 * Whether a style field applies to an element. A field without a panel
 * property applies wherever the element stores it.
 */
export function styleFieldApplies(element: BoardElement, key: string): boolean {
  const property = STYLE_FIELD_PROPERTY[key];
  if (!property) return true;
  // A line's label font can be set before it has a label.
  if (
    (element.type === "arrow" || element.type === "line") &&
    (property === "font" || property === "fontSize")
  )
    return true;
  return elementProperties(element).has(property);
}
