import {
  type BoardElement,
  createElement,
  ELEMENT_TYPES,
  type ElementType,
  SHAPE_KINDS,
} from "@margaya/whiteboard";
import { describe, expect, it } from "vitest";
import {
  editingProperties,
  elementProperties,
  PANEL_PROPERTIES,
  type PanelProperty,
  panelProperties,
  selectionProperties,
  styleFieldApplies,
  toolProperties,
} from "./property-capabilities";
import { TOOL_IDS, type ToolId } from "./tools";

const sorted = (set: ReadonlySet<PanelProperty>) =>
  PANEL_PROPERTIES.filter((property) => set.has(property));

const el = (type: ElementType, props: Record<string, unknown> = {}) =>
  createElement(type, props as never) as BoardElement;

const SHAPE_STYLE: PanelProperty[] = [
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
const LINE_STYLE: PanelProperty[] = [
  "strokeColor",
  "strokeWidth",
  "strokeStyle",
  "sketch",
  "routing",
  "arrowheads",
  "opacity",
];

describe("element properties", () => {
  const expected: Record<ElementType, PanelProperty[]> = {
    rectangle: [...SHAPE_STYLE, "corners"],
    ellipse: SHAPE_STYLE,
    diamond: SHAPE_STYLE,
    shape: SHAPE_STYLE,
    sticky: ["stickyColor", "font", "fontSize", "textAlign", "opacity"],
    text: ["strokeColor", "font", "fontSize", "textAlign", "opacity"],
    arrow: LINE_STYLE,
    line: LINE_STYLE,
    draw: ["penStyle", "strokeColor", "strokeWidth", "opacity"],
    image: ["crop", "opacity"],
    frame: ["fill", "frameName", "opacity"],
    task: ["opacity"],
  };

  it.each(ELEMENT_TYPES)("%s", (type) => {
    expect(sorted(elementProperties(el(type)))).toEqual(
      sorted(new Set(expected[type])),
    );
  });

  it.each(SHAPE_KINDS)("the %s shape has the shape properties", (shape) => {
    expect(sorted(elementProperties(el("shape", { shape })))).toEqual(
      sorted(new Set(SHAPE_STYLE)),
    );
  });

  it("gives a labelled arrow or line its label font, never its alignment", () => {
    for (const type of ["arrow", "line"] as const) {
      const props = elementProperties(el(type, { text: "blocks" }));
      expect(props.has("font")).toBe(true);
      expect(props.has("fontSize")).toBe(true);
      expect(props.has("textAlign")).toBe(false);
      expect(props.has("fill")).toBe(false);
    }
  });

  it("all draw pen styles share the draw properties", () => {
    for (const penStyle of ["pen", "marker", "highlighter"] as const) {
      expect(sorted(elementProperties(el("draw", { penStyle })))).toEqual([
        "penStyle",
        "strokeColor",
        "strokeWidth",
        "opacity",
      ]);
    }
  });
});

describe("tool properties", () => {
  const expected: Record<ToolId, PanelProperty[]> = {
    select: [],
    hand: [],
    laser: [],
    eraser: [],
    image: [],
    task: [],
    rectangle: [
      "strokeColor",
      "fill",
      "fillStyle",
      "strokeWidth",
      "strokeStyle",
      "sketch",
      "corners",
      "font",
      "fontSize",
      "opacity",
    ],
    ellipse: [
      "strokeColor",
      "fill",
      "fillStyle",
      "strokeWidth",
      "strokeStyle",
      "sketch",
      "font",
      "fontSize",
      "opacity",
    ],
    diamond: [
      "strokeColor",
      "fill",
      "fillStyle",
      "strokeWidth",
      "strokeStyle",
      "sketch",
      "font",
      "fontSize",
      "opacity",
    ],
    shape: [
      "strokeColor",
      "fill",
      "fillStyle",
      "strokeWidth",
      "strokeStyle",
      "sketch",
      "font",
      "fontSize",
      "opacity",
    ],
    arrow: LINE_STYLE,
    line: [
      "strokeColor",
      "strokeWidth",
      "strokeStyle",
      "sketch",
      "routing",
      "opacity",
    ],
    draw: ["penStyle", "strokeColor", "strokeWidth", "opacity"],
    text: ["strokeColor", "font", "fontSize", "textAlign", "opacity"],
    sticky: ["stickyColor", "font", "fontSize", "opacity"],
    frame: ["opacity"],
  };

  it.each(TOOL_IDS)("%s", (tool) => {
    expect(sorted(toolProperties(tool))).toEqual(
      sorted(new Set(expected[tool])),
    );
  });

  it("never offers a tool more than its element supports", () => {
    for (const tool of TOOL_IDS) {
      if (!(ELEMENT_TYPES as readonly string[]).includes(tool)) continue;
      const own = elementProperties(el(tool as ElementType));
      for (const property of toolProperties(tool)) {
        expect(own.has(property), `${tool}: ${property}`).toBe(true);
      }
    }
  });
});

describe("selection properties", () => {
  it("is empty with nothing selected", () => {
    expect(selectionProperties([]).size).toBe(0);
  });

  it("keeps only what every element supports", () => {
    expect(sorted(selectionProperties([el("rectangle"), el("arrow")]))).toEqual(
      ["strokeColor", "strokeWidth", "strokeStyle", "sketch", "opacity"],
    );
    expect(sorted(selectionProperties([el("rectangle"), el("text")]))).toEqual([
      "strokeColor",
      "font",
      "fontSize",
      "textAlign",
      "opacity",
    ]);
    expect(sorted(selectionProperties([el("sticky"), el("ellipse")]))).toEqual([
      "font",
      "fontSize",
      "textAlign",
      "opacity",
    ]);
    expect(sorted(selectionProperties([el("arrow"), el("line")]))).toEqual(
      LINE_STYLE,
    );
    expect(sorted(selectionProperties([el("draw"), el("arrow")]))).toEqual([
      "strokeColor",
      "strokeWidth",
      "opacity",
    ]);
    expect(sorted(selectionProperties([el("frame"), el("diamond")]))).toEqual([
      "fill",
      "opacity",
    ]);
    expect(sorted(selectionProperties([el("image"), el("task")]))).toEqual([
      "opacity",
    ]);
  });

  it("offers Change shape for any mix of shapes, and corners only for rectangles", () => {
    const mixed = selectionProperties([
      el("rectangle"),
      el("ellipse"),
      el("shape", { shape: "star" }),
    ]);
    expect(mixed.has("shape")).toBe(true);
    expect(mixed.has("corners")).toBe(false);
    expect(
      selectionProperties([el("rectangle"), el("rectangle")]).has("corners"),
    ).toBe(true);
  });

  it("names a frame and crops an image one at a time", () => {
    expect(selectionProperties([el("frame")]).has("frameName")).toBe(true);
    expect(
      selectionProperties([el("frame"), el("frame")]).has("frameName"),
    ).toBe(false);
    expect(selectionProperties([el("image")]).has("crop")).toBe(true);
    expect(selectionProperties([el("image"), el("image")]).has("crop")).toBe(
      false,
    );
  });

  it("shows a label font only when every line has a label", () => {
    const labelled = el("arrow", { text: "next" });
    expect(selectionProperties([labelled]).has("font")).toBe(true);
    expect(selectionProperties([labelled, el("arrow")]).has("font")).toBe(
      false,
    );
  });

  it("uses the selection over the tool", () => {
    expect(sorted(panelProperties("arrow", [el("text")]))).toEqual([
      "strokeColor",
      "font",
      "fontSize",
      "textAlign",
      "opacity",
    ]);
    expect(panelProperties("hand", []).size).toBe(0);
    expect(sorted(panelProperties("arrow", []))).toEqual(LINE_STYLE);
  });
});

describe("groups and frames", () => {
  const grouped = (type: ElementType, props: Record<string, unknown> = {}) =>
    el(type, { ...props, groupIds: ["outer", "inner"] });

  it("keeps stroke and fill for a group whose members all have them", () => {
    const rectangles = selectionProperties([
      grouped("rectangle"),
      grouped("rectangle"),
      grouped("rectangle"),
    ]);
    expect(sorted(rectangles)).toEqual(
      sorted(new Set([...SHAPE_STYLE, "corners"])),
    );
    const shapes = selectionProperties([
      grouped("rectangle"),
      grouped("ellipse"),
      grouped("diamond"),
      grouped("shape", { shape: "hexagon" }),
    ]);
    for (const property of [
      "strokeColor",
      "fill",
      "fillStyle",
      "strokeWidth",
      "strokeStyle",
    ] as const)
      expect(shapes.has(property), property).toBe(true);
    // Labelled shapes are still shapes.
    expect(
      selectionProperties([
        grouped("rectangle", { text: "a" }),
        grouped("ellipse", { text: "b" }),
      ]).has("fill"),
    ).toBe(true);
  });

  it("keeps only what a mixed group shares", () => {
    expect(
      sorted(selectionProperties([grouped("rectangle"), grouped("sticky")])),
    ).toEqual(["font", "fontSize", "textAlign", "opacity"]);
    expect(
      sorted(selectionProperties([grouped("ellipse"), grouped("line")])),
    ).toEqual([
      "strokeColor",
      "strokeWidth",
      "strokeStyle",
      "sketch",
      "opacity",
    ]);
  });

  it("gives a frame its background and name, and frames together their background", () => {
    expect(sorted(selectionProperties([el("frame")]))).toEqual([
      "fill",
      "opacity",
      "frameName",
    ]);
    expect(sorted(selectionProperties([el("frame"), el("frame")]))).toEqual([
      "fill",
      "opacity",
    ]);
  });
});

describe("editing words", () => {
  it("offers the text style an element's words take", () => {
    expect(sorted(editingProperties(el("text")))).toEqual([
      "strokeColor",
      "font",
      "fontSize",
      "textAlign",
    ]);
    for (const type of ["rectangle", "ellipse", "diamond", "shape"] as const)
      expect(sorted(editingProperties(el(type)))).toEqual([
        "strokeColor",
        "font",
        "fontSize",
        "textAlign",
      ]);
    expect(sorted(editingProperties(el("sticky")))).toEqual([
      "font",
      "fontSize",
      "textAlign",
    ]);
  });

  it("styles a line's label before it has words, never aligning it", () => {
    for (const type of ["arrow", "line"] as const)
      expect(sorted(editingProperties(el(type)))).toEqual([
        "strokeColor",
        "font",
        "fontSize",
      ]);
  });

  it("offers nothing for a frame's name", () => {
    expect(editingProperties(el("frame")).size).toBe(0);
  });
});

describe("style fields", () => {
  it("apply only where their section does", () => {
    expect(styleFieldApplies(el("sticky"), "fillColor")).toBe(false);
    expect(styleFieldApplies(el("frame"), "fillColor")).toBe(true);
    expect(styleFieldApplies(el("frame"), "fillStyle")).toBe(false);
    expect(styleFieldApplies(el("frame"), "strokeStyle")).toBe(false);
    expect(styleFieldApplies(el("text"), "strokeWidth")).toBe(false);
    expect(styleFieldApplies(el("draw"), "sketch")).toBe(false);
    expect(styleFieldApplies(el("arrow"), "textAlign")).toBe(false);
    expect(styleFieldApplies(el("arrow"), "endHead")).toBe(true);
    expect(styleFieldApplies(el("image"), "opacity")).toBe(true);
    expect(styleFieldApplies(el("image"), "strokeColor")).toBe(false);
  });

  it("let a line take a label font before it has a label", () => {
    expect(styleFieldApplies(el("line"), "fontFamily")).toBe(true);
    expect(styleFieldApplies(el("line"), "fontSize")).toBe(true);
  });
});
