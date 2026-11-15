import {
  type BoardElement,
  createElement,
  readElement,
  readElements,
  readSettings,
  SHAPE_KINDS,
  writeElements,
  writeSettings,
} from "@margaya/whiteboard";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { addShape, changeShape, setBackground, withShape } from "./commands";
import { BoardController } from "./controller";
import { exportPattern } from "./export";
import { Interaction } from "./interaction";
import { ALL_SHAPES, filterShapes, SHAPE_LABEL_KEYS } from "./shapes";
import { resolveKey } from "./shortcuts";
import { INITIAL_EDITOR_STATE, loadPrefs, pickShape, savePrefs } from "./store";

// Shapes, pen styles and the board background, driven through the
// controller with synthetic pointer events (client = board units at zoom 1).

const controllers: BoardController[] = [];
let clock = 0;
vi.spyOn(performance, "now").mockImplementation(() => clock);

afterEach(() => {
  for (const controller of controllers.splice(0)) controller.dispose();
  window.localStorage.clear();
});

function setup(elements: BoardElement[] = [], readOnly = false) {
  const doc = new Y.Doc();
  if (elements.length > 0) writeElements(doc, elements, "seed");
  const controller = new BoardController({
    doc,
    awareness: null,
    readOnly,
    user: { id: "me", name: "Me", color: "#2563eb" },
    whiteboardId: "b",
    theme: "light",
    imageUrl: (id) => id,
    isPublic: false,
  });
  controller.callbacks = { notice: vi.fn() };
  controller.update((state) => ({ ...state, snapToObjects: false }));
  controllers.push(controller);
  const hooks = { editText: vi.fn(), openTask: vi.fn(), openLink: vi.fn() };
  return { doc, controller, interaction: new Interaction(controller, hooks) };
}

type Mods = { shiftKey?: boolean; altKey?: boolean };

function pointer(x: number, y: number, mods: Mods = {}) {
  return {
    pointerId: 1,
    pointerType: "mouse",
    button: 0,
    buttons: 1,
    clientX: x,
    clientY: y,
    pressure: 0.5,
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    preventDefault: () => {},
    ...mods,
  } as unknown as PointerEvent;
}

function drag(
  interaction: Interaction,
  points: [number, number][],
  mods: Mods = {},
) {
  const [first, ...rest] = points;
  if (!first) return;
  clock += 1000;
  interaction.pointerDown(pointer(first[0], first[1], mods));
  for (const [x, y] of rest) interaction.pointerMove(pointer(x, y, mods));
  const last = rest[rest.length - 1] ?? first;
  interaction.pointerUp(pointer(last[0], last[1], mods));
}

describe("shape library", () => {
  const label = (shape: (typeof ALL_SHAPES)[number]) =>
    ({ star: "Étoile", heart: "Cœur" })[shape as string] ?? shape;

  it("offers the classic shapes and every library kind once", () => {
    expect(ALL_SHAPES).toHaveLength(SHAPE_KINDS.length + 3);
    expect(new Set(ALL_SHAPES).size).toBe(ALL_SHAPES.length);
    for (const kind of SHAPE_KINDS) expect(ALL_SHAPES).toContain(kind);
    for (const shape of ALL_SHAPES)
      expect(SHAPE_LABEL_KEYS[shape]).toBeTruthy();
  });

  it("filters by the translated name, ignoring case and accents", () => {
    const stars = filterShapes("ETOILE", label);
    expect(stars).toHaveLength(1);
    expect(stars[0]?.id).toBe("polygons");
    expect(stars[0]?.shapes).toEqual(["star"]);
    const arrows = filterShapes("arrow", label).flatMap((g) => g.shapes);
    expect(arrows).toContain("arrowLeft");
    expect(arrows).not.toContain("star");
    expect(filterShapes("nothing like it", label)).toEqual([]);
    expect(filterShapes("  ", label).flatMap((g) => g.shapes)).toEqual(
      ALL_SHAPES,
    );
  });

  it("picks a shape: its tool turns on and the choice is remembered", () => {
    const opened = { ...INITIAL_EDITOR_STATE, dialog: "shapes" as const };
    const hexagon = pickShape(opened, "hexagon", false);
    expect(hexagon).toMatchObject({
      tool: "shape",
      shapeKind: "hexagon",
      dialog: null,
    });
    const diamond = pickShape(hexagon, "diamond", false);
    expect(diamond).toMatchObject({ tool: "diamond", shapeKind: "diamond" });
    expect(pickShape(opened, "hexagon", true)).toBe(opened);
  });

  it("remembers the last shape and pen style per browser", () => {
    savePrefs({
      ...INITIAL_EDITOR_STATE,
      shapeKind: "cloud",
      penStyle: "highlighter",
    });
    expect(loadPrefs()).toMatchObject({
      shapeKind: "cloud",
      penStyle: "highlighter",
    });
    window.localStorage.setItem(
      "margaya-whiteboard-editor",
      JSON.stringify({ shapeKind: "blob", penStyle: "crayon" }),
    );
    expect(loadPrefs()).not.toHaveProperty("shapeKind");
    expect(loadPrefs()).not.toHaveProperty("penStyle");
  });

  it("opens the picker with Shift+S and keeps S for stickies", () => {
    expect(
      resolveKey({ key: "S", code: "KeyS", shiftKey: true }, false),
    ).toEqual({ kind: "command", command: "shapePicker" });
    expect(resolveKey({ key: "s", code: "KeyS" }, false)).toEqual({
      kind: "tool",
      tool: "sticky",
    });
  });
});

describe("drawing shapes", () => {
  it("draws the picked kind by dragging", () => {
    const { doc, controller, interaction } = setup();
    controller.update((state) => pickShape(state, "star", false));
    drag(interaction, [
      [10, 20],
      [110, 80],
    ]);
    const [star] = readElements(doc);
    expect(star).toMatchObject({
      type: "shape",
      shape: "star",
      x: 10,
      y: 20,
      width: 100,
      height: 60,
    });
    expect(controller.state.tool).toBe("select");
  });

  it("keeps proportions with Shift and grows from the centre with Alt", () => {
    const { doc, controller, interaction } = setup();
    controller.update((state) => pickShape(state, "hexagon", false));
    drag(
      interaction,
      [
        [100, 100],
        [140, 120],
      ],
      { shiftKey: true, altKey: true },
    );
    const [hexagon] = readElements(doc);
    expect(hexagon).toMatchObject({
      type: "shape",
      x: 60,
      y: 60,
      width: 80,
      height: 80,
    });
  });

  it("a classic pick keeps its own element type", () => {
    const { doc, controller, interaction } = setup();
    controller.update((state) => pickShape(state, "ellipse", false));
    drag(interaction, [[200, 200]]);
    expect(readElements(doc)[0]?.type).toBe("ellipse");
  });

  it("adds a shape from the menu where it was opened", () => {
    const { doc, controller } = setup();
    expect(addShape(controller, "cloud", { x: 0, y: 0 })).toBe(true);
    const [cloud] = readElements(doc);
    expect(cloud).toMatchObject({ type: "shape", shape: "cloud" });
    expect((cloud?.x ?? 0) + (cloud?.width ?? 0) / 2).toBeCloseTo(0, 0);
    expect(controller.state.shapeKind).toBe("cloud");
  });
});

describe("change shape", () => {
  function boardWithArrow() {
    const box = createElement("rectangle", {
      x: 0,
      y: 0,
      width: 120,
      height: 80,
      text: "Plan",
      strokeColor: "#dc2626",
      fillColor: "#bfdbfe",
      cornerRadius: 24,
    });
    const arrow = createElement("arrow", {
      x: 300,
      y: 40,
      points: [
        [0, 0],
        [-170, 0],
      ],
      endBinding: { elementId: box.id, focus: [0.5, 0.5], gap: 6 },
    });
    return { box, arrow, ...setup([box, arrow]) };
  }

  it("swaps the outline and keeps text, colours, size and bindings", () => {
    const { box, arrow, doc, controller } = boardWithArrow();
    controller.select([box.id]);
    expect(changeShape(controller, "hexagon")).toBe(true);
    const changed = readElement(doc, box.id);
    expect(changed).toMatchObject({
      id: box.id,
      type: "shape",
      shape: "hexagon",
      text: "Plan",
      strokeColor: "#dc2626",
      fillColor: "#bfdbfe",
      width: 120,
      height: 80,
    });
    expect(changed).not.toHaveProperty("cornerRadius");
    expect(changed?.version).toBeGreaterThan(box.version);
    const line = readElement(doc, arrow.id);
    expect(line?.type === "arrow" && line.endBinding?.elementId).toBe(box.id);
  });

  it("goes back to a rectangle with corners", () => {
    const { box, doc, controller } = boardWithArrow();
    controller.select([box.id]);
    changeShape(controller, "star");
    changeShape(controller, "rectangle");
    const back = readElement(doc, box.id);
    expect(back).toMatchObject({ type: "rectangle", text: "Plan" });
    expect(back).not.toHaveProperty("shape");
    expect(back?.type === "rectangle" && back.cornerRadius).toBeGreaterThan(0);
  });

  it("leaves other elements and locked shapes alone", () => {
    const locked = createElement("ellipse", { locked: true });
    const note = createElement("sticky", { text: "Keep" });
    const { doc, controller } = setup([locked, note]);
    controller.select([locked.id, note.id]);
    expect(changeShape(controller, "heart")).toBe(false);
    expect(readElement(doc, locked.id)?.type).toBe("ellipse");
    expect(readElement(doc, note.id)?.type).toBe("sticky");
  });

  it("builds the swapped element without losing the label fields", () => {
    const shape = createElement("shape", { shape: "cloud", text: "Idea" });
    const ellipse = withShape(shape, "ellipse", { userId: "me" });
    expect(ellipse).toMatchObject({ type: "ellipse", text: "Idea" });
    expect(ellipse).not.toHaveProperty("shape");
    expect(ellipse.updatedBy).toBe("me");
  });
});

describe("pen styles", () => {
  it("gives new strokes the chosen style", () => {
    const { doc, controller, interaction } = setup();
    controller.update((state) => ({ ...state, penStyle: "marker" }));
    controller.dispatchTool({ type: "pick", tool: "draw", readOnly: false });
    drag(interaction, [
      [0, 0],
      [20, 10],
      [40, 30],
    ]);
    const [stroke] = readElements(doc);
    expect(stroke?.type === "draw" && stroke.penStyle).toBe("marker");
  });

  it("a highlighter starts yellow and wide", () => {
    const { controller } = setup();
    controller.update((state) => ({ ...state, penStyle: "highlighter" }));
    const stroke = controller.newElement("draw", {});
    expect(stroke).toMatchObject({
      penStyle: "highlighter",
      strokeColor: controller.state.style.highlighterColor,
      strokeWidth: controller.state.style.highlighterWidth,
    });
    expect(stroke.strokeWidth).toBeGreaterThan(
      controller.state.style.strokeWidth,
    );
    expect(controller.state.style.highlighterColor).toBe("#facc15");
  });
});

describe("board background", () => {
  it("writes the pattern to the shared settings", () => {
    const { doc, controller } = setup();
    expect(
      setBackground(controller, { pattern: "dots", patternSize: 40 }),
    ).toBe(true);
    expect(readSettings(doc)).toMatchObject({
      pattern: "dots",
      patternSize: 40,
    });
    // Snapping stays its own setting.
    expect(readSettings(doc).gridSize).toBe(0);
  });

  it("is refused on a read-only board", () => {
    const { doc, controller } = setup([], true);
    expect(setBackground(controller, { pattern: "grid" })).toBe(false);
    expect(readSettings(doc).pattern).toBe("plain");
    expect(controller.callbacks.notice).toHaveBeenCalledWith("readOnly");
  });
});

describe("export pattern option", () => {
  it("includes the pattern in PNG and leaves it out of SVG by default", () => {
    const { doc, controller } = setup();
    writeSettings(doc, { pattern: "grid", patternSize: 16 });
    expect(exportPattern(controller, {}, "png")).toEqual({
      pattern: "grid",
      patternSize: 16,
    });
    expect(exportPattern(controller, {}, "svg").pattern).toBe("plain");
    expect(exportPattern(controller, { pattern: true }, "svg").pattern).toBe(
      "grid",
    );
    expect(exportPattern(controller, { pattern: false }, "png").pattern).toBe(
      "plain",
    );
    // A transparent export has no backdrop to draw a pattern on.
    expect(
      exportPattern(controller, { pattern: true, background: false }, "png")
        .pattern,
    ).toBe("plain");
  });
});
