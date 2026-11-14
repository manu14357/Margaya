// The board model. A board is a flat set of elements keyed by id; stacking
// order comes from each element's `order` key, never from array position, so
// two people can reorder concurrently without clobbering each other.
//
// Elements are plain JSON. Every edit replaces the whole element with a
// higher `version` (and a fresh random `nonce`), so concurrent edits to one
// element resolve to a single winner and edits to different elements never
// conflict. Deleting sets `deleted: true` (a tombstone) so a late edit from
// another client cannot bring the element back by accident.

export const ELEMENT_TYPES = [
  "rectangle",
  "ellipse",
  "diamond",
  "sticky",
  "text",
  "arrow",
  "line",
  "draw",
  "image",
  "frame",
  "task",
  "shape",
] as const;
export type ElementType = (typeof ELEMENT_TYPES)[number];

/**
 * The outlines a `shape` element can take, drawn inside its box. Rectangle,
 * ellipse and diamond keep their own element types for compatibility.
 */
export const SHAPE_KINDS = [
  "triangle",
  "rightTriangle",
  "pentagon",
  "hexagon",
  "octagon",
  "star",
  "parallelogram",
  "trapezoid",
  "plus",
  "cross",
  "heart",
  "cloud",
  "speech",
  "cylinder",
  "document",
  "arrowRight",
  "arrowLeft",
  "arrowUp",
  "arrowDown",
  "arrowDouble",
  "chevron",
  "moon",
] as const;
export type ShapeKind = (typeof SHAPE_KINDS)[number];

/** How a freehand stroke looks: a pen, a broad marker or a see-through highlighter. */
export const PEN_STYLES = ["pen", "marker", "highlighter"] as const;
export type PenStyle = (typeof PEN_STYLES)[number];

/** The canvas background pattern; "plain" is the empty default. */
export const BACKGROUND_PATTERNS = ["plain", "dots", "grid", "lines"] as const;
export type BackgroundPattern = (typeof BACKGROUND_PATTERNS)[number];

export const FILL_STYLES = ["none", "solid", "hatch", "cross"] as const;
export type FillStyle = (typeof FILL_STYLES)[number];

export const STROKE_STYLES = ["solid", "dashed", "dotted"] as const;
export type StrokeStyle = (typeof STROKE_STYLES)[number];

/** 0 = clean lines, 1 = lightly hand-drawn, 2 = sketchy. */
export const SKETCH_LEVELS = [0, 1, 2] as const;
export type SketchLevel = (typeof SKETCH_LEVELS)[number];

export const FONT_FAMILIES = ["hand", "sans", "mono"] as const;
export type FontFamily = (typeof FONT_FAMILIES)[number];

export const TEXT_ALIGNS = ["left", "center", "right"] as const;
export type TextAlign = (typeof TEXT_ALIGNS)[number];

export const VERTICAL_ALIGNS = ["top", "middle", "bottom"] as const;
export type VerticalAlign = (typeof VERTICAL_ALIGNS)[number];

export const ARROW_HEADS = ["none", "arrow", "triangle", "dot", "bar"] as const;
export type ArrowHead = (typeof ARROW_HEADS)[number];

export const LINE_ROUTINGS = ["straight", "curved", "elbow"] as const;
export type LineRouting = (typeof LINE_ROUTINGS)[number];

/** A point relative to the element's x/y. */
export type LocalPoint = readonly [x: number, y: number];

export type Binding = {
  /** The element the line end is attached to. */
  elementId: string;
  /** Where on the target, as a fraction of its box (0..1 each). */
  focus: readonly [fx: number, fy: number];
  /** Gap between the line end and the target outline, in board units. */
  gap: number;
};

type ElementBase = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Rotation in radians around the element's centre. */
  angle: number;
  strokeColor: string;
  fillColor: string;
  fillStyle: FillStyle;
  strokeWidth: number;
  strokeStyle: StrokeStyle;
  sketch: SketchLevel;
  /** 0..100 */
  opacity: number;
  /** Fractional order key (see order.ts); higher sorts on top. */
  order: string;
  /** Innermost group last. */
  groupIds: readonly string[];
  /** The frame that contains (and clips) this element. */
  frameId: string | null;
  locked: boolean;
  /** http(s) URL, or a same-board element link `#element=<id>`. */
  link: string | null;
  /** Seed for the hand-drawn look so a shape renders the same everywhere. */
  seed: number;
  version: number;
  /** Random tie-breaker for equal versions. */
  nonce: number;
  deleted: boolean;
  /** Epoch milliseconds of the last edit. */
  updatedAt: number;
  /** User id of the last editor, or null. */
  updatedBy: string | null;
};

export type TextFields = {
  text: string;
  fontSize: number;
  fontFamily: FontFamily;
  textAlign: TextAlign;
  verticalAlign: VerticalAlign;
};

export type RectangleElement = ElementBase &
  TextFields & { type: "rectangle"; cornerRadius: number };
export type EllipseElement = ElementBase & TextFields & { type: "ellipse" };
export type DiamondElement = ElementBase & TextFields & { type: "diamond" };
export type StickyElement = ElementBase & TextFields & { type: "sticky" };
export type TextElement = ElementBase &
  TextFields & {
    type: "text";
    /** Grow with the text (true) or wrap inside a fixed width. */
    autoSize: boolean;
  };

export type LinearElement = ElementBase &
  TextFields & {
    type: "arrow" | "line";
    /** At least 2 points; the first is [0, 0]. */
    points: readonly LocalPoint[];
    routing: LineRouting;
    startHead: ArrowHead;
    endHead: ArrowHead;
    startBinding: Binding | null;
    endBinding: Binding | null;
  };
export type ArrowElement = LinearElement & { type: "arrow" };
export type LineElement = LinearElement & { type: "line" };

export type DrawElement = ElementBase & {
  type: "draw";
  points: readonly LocalPoint[];
  /** One 0..1 pressure per point, or empty when the device has none. */
  pressures: readonly number[];
  /** Smooth with simulated pressure when the device reports none. */
  simulatePressure: boolean;
  /** Missing on boards saved before pen styles existed; read as "pen". */
  penStyle: PenStyle;
};

export type ImageElement = ElementBase & {
  type: "image";
  /** The board asset id (uploaded through the API), or null while uploading. */
  assetId: string | null;
  /** Crop rectangle in the image's own pixels, or null for the whole image. */
  crop: { x: number; y: number; width: number; height: number } | null;
};

export type FrameElement = ElementBase & { type: "frame"; name: string };

/** A live card of a Margaya task; the card's text comes from the task. */
export type TaskElement = ElementBase & { type: "task"; taskId: string };

/** One of the extra outlines in SHAPE_KINDS, with a text label like other shapes. */
export type ShapeElement = ElementBase &
  TextFields & { type: "shape"; shape: ShapeKind };

export type BoardElement =
  | RectangleElement
  | EllipseElement
  | DiamondElement
  | StickyElement
  | TextElement
  | ArrowElement
  | LineElement
  | DrawElement
  | ImageElement
  | FrameElement
  | TaskElement
  | ShapeElement;

export type ElementOf<T extends ElementType> = Extract<
  BoardElement,
  { type: T }
>;

export type TextualElement = Extract<BoardElement, TextFields>;

/** Board-wide settings stored next to the elements. */
export type BoardSettings = {
  /** Background colour of the canvas. */
  background: string;
  /** Snap grid size in board units, or 0 for no snapping. */
  gridSize: number;
  /** Visible background pattern; independent of snapping. */
  pattern: BackgroundPattern;
  /** Spacing of the pattern in board units. */
  patternSize: number;
};

export const DEFAULT_BOARD_SETTINGS: BoardSettings = {
  background: "#ffffff",
  gridSize: 0,
  pattern: "plain",
  patternSize: 24,
};

/** Hard limits the server enforces; the editor enforces them too. */
export const BOARD_LIMITS = {
  maxElements: 20_000,
  maxTextLength: 20_000,
  maxPoints: 5_000,
  maxIdLength: 64,
  maxGroupDepth: 32,
  maxLinkLength: 2_048,
  maxCoordinate: 10_000_000,
  maxDimension: 1_000_000,
  maxFontSize: 512,
  maxStrokeWidth: 64,
  maxColorLength: 32,
  maxNameLength: 200,
  /** Bytes of the stored Yjs state. */
  maxDocumentBytes: 32 * 1024 * 1024,
} as const;

/** Keys of the shared Yjs document (see yjs.ts). */
export const BOARD_DOC = {
  /** Y.Map<string, BoardElement> keyed by element id. */
  elements: "elements",
  /** Y.Map<string, unknown> holding BoardSettings fields. */
  settings: "settings",
} as const;
