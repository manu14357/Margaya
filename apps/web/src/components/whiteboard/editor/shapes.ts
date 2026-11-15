import type { ShapeKind } from "@margaya/whiteboard";
import type { ShapeChoice } from "./tools";

// The shape library: which shapes the picker offers, in which group, and
// their (static) label keys. Pure, so the toolbar, the context menu, the
// properties panel and the tests share one list.

export type ShapeGroupId = "basic" | "polygons" | "arrows" | "symbols";

export type ShapeGroup = {
  id: ShapeGroupId;
  labelKey: string;
  shapes: readonly ShapeChoice[];
};

export const SHAPE_GROUPS: readonly ShapeGroup[] = [
  {
    id: "basic",
    labelKey: "whiteboardEditor:shapes.groups.basic",
    shapes: [
      "rectangle",
      "ellipse",
      "diamond",
      "triangle",
      "rightTriangle",
      "parallelogram",
      "trapezoid",
      "cylinder",
      "document",
    ],
  },
  {
    id: "polygons",
    labelKey: "whiteboardEditor:shapes.groups.polygons",
    shapes: ["pentagon", "hexagon", "octagon", "star", "plus", "cross"],
  },
  {
    id: "arrows",
    labelKey: "whiteboardEditor:shapes.groups.arrows",
    shapes: [
      "arrowRight",
      "arrowLeft",
      "arrowUp",
      "arrowDown",
      "arrowDouble",
      "chevron",
    ],
  },
  {
    id: "symbols",
    labelKey: "whiteboardEditor:shapes.groups.symbols",
    shapes: ["heart", "cloud", "speech", "moon"],
  },
];

export const ALL_SHAPES: readonly ShapeChoice[] = SHAPE_GROUPS.flatMap(
  (group) => group.shapes,
);

/** Static label keys (i18n keys must not be built at runtime). */
export const SHAPE_LABEL_KEYS: Record<ShapeChoice, string> = {
  rectangle: "whiteboardEditor:tools.rectangle",
  ellipse: "whiteboardEditor:tools.ellipse",
  diamond: "whiteboardEditor:tools.diamond",
  triangle: "whiteboardEditor:shapes.names.triangle",
  rightTriangle: "whiteboardEditor:shapes.names.rightTriangle",
  pentagon: "whiteboardEditor:shapes.names.pentagon",
  hexagon: "whiteboardEditor:shapes.names.hexagon",
  octagon: "whiteboardEditor:shapes.names.octagon",
  star: "whiteboardEditor:shapes.names.star",
  parallelogram: "whiteboardEditor:shapes.names.parallelogram",
  trapezoid: "whiteboardEditor:shapes.names.trapezoid",
  plus: "whiteboardEditor:shapes.names.plus",
  cross: "whiteboardEditor:shapes.names.cross",
  heart: "whiteboardEditor:shapes.names.heart",
  cloud: "whiteboardEditor:shapes.names.cloud",
  speech: "whiteboardEditor:shapes.names.speech",
  cylinder: "whiteboardEditor:shapes.names.cylinder",
  document: "whiteboardEditor:shapes.names.document",
  arrowRight: "whiteboardEditor:shapes.names.arrowRight",
  arrowLeft: "whiteboardEditor:shapes.names.arrowLeft",
  arrowUp: "whiteboardEditor:shapes.names.arrowUp",
  arrowDown: "whiteboardEditor:shapes.names.arrowDown",
  arrowDouble: "whiteboardEditor:shapes.names.arrowDouble",
  chevron: "whiteboardEditor:shapes.names.chevron",
  moon: "whiteboardEditor:shapes.names.moon",
};

/** Case and accent blind, so "etoile" finds "Étoile". */
function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase()
    .trim();
}

/** The groups with only the shapes whose translated name matches the query. */
export function filterShapes(
  query: string,
  label: (shape: ShapeChoice) => string,
): ShapeGroup[] {
  const needle = fold(query);
  if (!needle) return [...SHAPE_GROUPS];
  const result: ShapeGroup[] = [];
  for (const group of SHAPE_GROUPS) {
    const shapes = group.shapes.filter((shape) =>
      fold(label(shape)).includes(needle),
    );
    if (shapes.length > 0) result.push({ ...group, shapes });
  }
  return result;
}

/** Size a click (without a drag) gives a new shape. */
export function defaultShapeSize(choice: ShapeChoice): {
  width: number;
  height: number;
} {
  switch (choice) {
    case "rectangle":
      return { width: 160, height: 100 };
    case "ellipse":
      return { width: 140, height: 100 };
    case "diamond":
      return { width: 140, height: 120 };
    case "arrowRight":
    case "arrowLeft":
    case "arrowDouble":
    case "chevron":
    case "parallelogram":
    case "trapezoid":
    case "document":
    case "speech":
    case "cloud":
      return { width: 160, height: 100 };
    case "arrowUp":
    case "arrowDown":
    case "cylinder":
      return { width: 100, height: 140 };
    default:
      return { width: 120, height: 120 };
  }
}

/** Element types whose outline "Change shape" can swap. */
export function isSwappableShape(type: string): boolean {
  return (
    type === "rectangle" ||
    type === "ellipse" ||
    type === "diamond" ||
    type === "shape"
  );
}

/** The library entry an element currently shows, if it is a shape. */
export function shapeChoiceOf(element: {
  type: string;
  shape?: ShapeKind;
}): ShapeChoice | null {
  if (
    element.type === "rectangle" ||
    element.type === "ellipse" ||
    element.type === "diamond"
  )
    return element.type;
  if (element.type === "shape" && element.shape) return element.shape;
  return null;
}
