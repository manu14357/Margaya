import {
  type BoardElement,
  createElement,
  readElement,
  readElements,
  writeElements,
} from "@margaya/whiteboard";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { BoardController } from "./controller";
import { Interaction } from "./interaction";
import type { ToolId } from "./tools";

// Gestures driven with synthetic pointer events. The canvas is not attached,
// so client coordinates are board coordinates at zoom 1.

const controllers: BoardController[] = [];
let clock = 0;

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
  const interaction = new Interaction(controller, hooks);
  return { doc, controller, interaction, hooks };
}

type Mods = { shiftKey?: boolean; altKey?: boolean; ctrlKey?: boolean };

function event(
  x: number,
  y: number,
  mods: Mods = {},
  extra: Record<string, unknown> = {},
) {
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
    currentTarget: null,
    preventDefault: () => {},
    ...mods,
    ...extra,
  } as unknown as PointerEvent;
}

/** Press, move through the points and release. */
function drag(
  interaction: Interaction,
  points: [number, number][],
  mods: Mods = {},
) {
  const [first, ...rest] = points;
  if (!first) return;
  // Space presses out so they never read as a double click.
  clock += 1000;
  interaction.pointerDown(event(first[0], first[1], mods));
  for (const [x, y] of rest) interaction.pointerMove(event(x, y, mods));
  const last = rest[rest.length - 1] ?? first;
  interaction.pointerUp(event(last[0], last[1], mods));
}

function useTool(controller: BoardController, tool: ToolId) {
  controller.dispatchTool({
    type: "pick",
    tool,
    readOnly: controller.readOnly,
  });
}

vi.spyOn(performance, "now").mockImplementation(() => clock);

afterEach(() => {
  for (const controller of controllers.splice(0)) controller.dispose();
});

describe("canvas gestures", () => {
  it("draws a rectangle by dragging and goes back to Select", () => {
    const { doc, controller, interaction } = setup();
    useTool(controller, "rectangle");
    drag(interaction, [
      [10, 20],
      [60, 60],
      [110, 100],
    ]);
    const [rect] = readElements(doc);
    expect(rect).toMatchObject({
      type: "rectangle",
      x: 10,
      y: 20,
      width: 100,
      height: 80,
    });
    expect(controller.state.tool).toBe("select");
    expect(controller.state.selectedIds).toEqual([rect?.id]);
  });

  it("captures the pointer on the canvas, not on React's root", () => {
    const { controller, interaction } = setup();
    useTool(controller, "rectangle");
    const canvas = {
      setPointerCapture: vi.fn(),
      hasPointerCapture: vi.fn(() => true),
      releasePointerCapture: vi.fn(),
    };
    // A native event handed over by React: currentTarget is the root that
    // React listens on, target is the canvas that was pressed.
    const root = { setPointerCapture: vi.fn(), hasPointerCapture: vi.fn() };
    clock += 1000;
    interaction.pointerDown(
      event(10, 10, {}, { target: canvas, currentTarget: root }),
    );
    expect(canvas.setPointerCapture).toHaveBeenCalledWith(1);
    expect(root.setPointerCapture).not.toHaveBeenCalled();
    interaction.pointerUp(
      event(50, 50, {}, { target: canvas, currentTarget: root }),
    );
    expect(canvas.releasePointerCapture).toHaveBeenCalledWith(1);
  });

  it("creates a default-size shape on a plain click", () => {
    const { doc, controller, interaction } = setup();
    useTool(controller, "ellipse");
    drag(interaction, [[200, 200]]);
    const [ellipse] = readElements(doc);
    expect(ellipse?.width).toBeGreaterThan(50);
    expect(ellipse?.x).toBeLessThan(200);
  });

  it("keeps Shift-drawn shapes square", () => {
    const { doc, controller, interaction } = setup();
    useTool(controller, "rectangle");
    drag(
      interaction,
      [
        [0, 0],
        [120, 40],
      ],
      { shiftKey: true },
    );
    const [rect] = readElements(doc);
    expect(rect?.width).toBe(rect?.height);
  });

  it("moves the selection in one undo step", () => {
    const rect = createElement("rectangle", {
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      fillColor: "#bfdbfe",
    });
    const { doc, controller, interaction } = setup([rect]);
    drag(interaction, [
      [50, 50],
      [60, 55],
      [80, 70],
      [150, 90],
    ]);
    expect(readElement(doc, rect.id)).toMatchObject({ x: 100, y: 40 });
    controller.undo();
    expect(readElement(doc, rect.id)).toMatchObject({ x: 0, y: 0 });
    expect(controller.history.canUndo).toBe(false);
  });

  it("box-selects elements fully inside the box", () => {
    const inside = createElement("rectangle", {
      x: 10,
      y: 10,
      width: 20,
      height: 20,
    });
    const outside = createElement("rectangle", {
      x: 300,
      y: 300,
      width: 20,
      height: 20,
    });
    const { controller, interaction } = setup([inside, outside]);
    drag(interaction, [
      [-10, -10],
      [100, 100],
    ]);
    expect(controller.state.selectedIds).toEqual([inside.id]);
  });

  it("selects a whole group with one click", () => {
    const a = createElement("rectangle", {
      x: 0,
      y: 0,
      width: 40,
      height: 40,
      fillColor: "#bfdbfe",
      groupIds: ["g1"],
    });
    const b = createElement("rectangle", {
      x: 100,
      y: 0,
      width: 40,
      height: 40,
      fillColor: "#bfdbfe",
      groupIds: ["g1"],
    });
    const { controller, interaction } = setup([a, b]);
    drag(interaction, [[20, 20]]);
    expect([...controller.state.selectedIds].sort()).toEqual(
      [a.id, b.id].sort(),
    );
  });

  it("refuses to move anything on a read-only board but still selects", () => {
    const rect = createElement("rectangle", {
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      fillColor: "#bfdbfe",
    });
    const { doc, controller, interaction } = setup([rect], true);
    drag(interaction, [
      [50, 50],
      [150, 150],
    ]);
    expect(readElement(doc, rect.id)).toMatchObject({ x: 0, y: 0 });
    expect(controller.state.selectedIds).toEqual([rect.id]);
    useTool(controller, "rectangle");
    expect(controller.state.tool).toBe("select");
  });

  it("draws an arrow between two shapes and binds both ends", () => {
    const left = createElement("rectangle", {
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    });
    const right = createElement("rectangle", {
      x: 300,
      y: 0,
      width: 100,
      height: 100,
    });
    const { doc, controller, interaction } = setup([left, right]);
    useTool(controller, "arrow");
    drag(interaction, [
      [50, 50],
      [200, 50],
      [350, 50],
    ]);
    const arrow = readElements(doc).find((element) => element.type === "arrow");
    expect(arrow?.type === "arrow" && arrow.startBinding?.elementId).toBe(
      left.id,
    );
    expect(arrow?.type === "arrow" && arrow.endBinding?.elementId).toBe(
      right.id,
    );

    // Moving a bound shape drags the arrow end along.
    const before =
      arrow?.type === "arrow"
        ? (arrow.points[arrow.points.length - 1]?.[0] ?? 0)
        : 0;
    useTool(controller, "select");
    controller.select([right.id]);
    drag(interaction, [
      [350, 20],
      [450, 20],
    ]);
    const moved = readElement(doc, arrow?.id ?? "");
    const after =
      moved?.type === "arrow"
        ? (moved.points[moved.points.length - 1]?.[0] ?? 0)
        : 0;
    expect(after).toBeGreaterThan(before + 50);
  });

  it("builds a polyline from clicks and finishes on a double click", () => {
    const { doc, controller, interaction } = setup();
    useTool(controller, "line");
    drag(interaction, [[0, 0]]);
    drag(interaction, [[100, 0]]);
    drag(interaction, [[100, 100]]);
    // Two quick clicks on the same spot end the line.
    clock += 1000;
    interaction.pointerDown(event(100, 100));
    interaction.pointerUp(event(100, 100));
    clock += 50;
    interaction.pointerDown(event(100, 100));
    const line = readElements(doc).find((element) => element.type === "line");
    expect(line?.type === "line" && line.points.length).toBe(3);
  });

  it("draws with the pen and keeps pen pressure", () => {
    const { doc, controller, interaction } = setup();
    useTool(controller, "draw");
    clock += 1000;
    interaction.pointerDown(
      event(10, 10, {}, { pointerType: "pen", pressure: 0.2 }),
    );
    interaction.pointerMove(
      event(20, 15, {}, { pointerType: "pen", pressure: 0.6 }),
    );
    interaction.pointerMove(
      event(40, 30, {}, { pointerType: "pen", pressure: 0.9 }),
    );
    interaction.pointerUp(event(40, 30, {}, { pointerType: "pen" }));
    const [stroke] = readElements(doc);
    expect(stroke?.type).toBe("draw");
    if (stroke?.type !== "draw") return;
    expect(stroke.pressures).toEqual([0.2, 0.6, 0.9]);
    expect(stroke.simulatePressure).toBe(false);
    expect(stroke).toMatchObject({ x: 10, y: 10, width: 30, height: 20 });
    expect(controller.state.tool).toBe("draw");
  });

  it("erases what the eraser touches, in one undo step", () => {
    const a = createElement("rectangle", {
      x: 0,
      y: 0,
      width: 50,
      height: 50,
      fillColor: "#bfdbfe",
    });
    const b = createElement("rectangle", {
      x: 100,
      y: 0,
      width: 50,
      height: 50,
      fillColor: "#bfdbfe",
    });
    const { doc, controller, interaction } = setup([a, b]);
    useTool(controller, "eraser");
    drag(interaction, [
      [25, 25],
      [125, 25],
    ]);
    expect(readElements(doc)).toHaveLength(0);
    controller.undo();
    expect(readElements(doc)).toHaveLength(2);
  });

  it("opens the text editor on a double click on empty canvas", () => {
    const { controller, interaction, hooks } = setup();
    clock += 1000;
    interaction.pointerDown(event(300, 300));
    interaction.pointerUp(event(300, 300));
    clock += 100;
    interaction.pointerDown(event(300, 300));
    expect(hooks.editText).toHaveBeenCalledWith(expect.any(String), {
      isNew: true,
    });
    const id = hooks.editText.mock.calls[0]?.[0] as string;
    // The new text exists only as a preview until it gets content.
    expect(controller.get(id)?.type).toBe("text");
    expect(controller.scene.get(id)).toBeUndefined();
  });

  it("edits the label of a hollow shape on a double click inside it", () => {
    const hexagon = createElement("shape", {
      x: 100,
      y: 100,
      width: 160,
      height: 120,
      shape: "hexagon",
    });
    const locked = createElement("rectangle", {
      x: 400,
      y: 100,
      width: 100,
      height: 100,
      locked: true,
    });
    const { controller, interaction, hooks } = setup([hexagon, locked]);
    const doubleClick = (x: number, y: number) => {
      clock += 1000;
      interaction.pointerDown(event(x, y));
      interaction.pointerUp(event(x, y));
      clock += 100;
      interaction.pointerDown(event(x, y));
      interaction.pointerUp(event(x, y));
    };

    // The middle is far from the outline, which a single click needs.
    doubleClick(180, 160);
    expect(hooks.editText).toHaveBeenLastCalledWith(hexagon.id);
    expect(controller.state.selectedIds).toEqual([hexagon.id]);

    // A locked shape keeps its label: a loose text starts instead.
    doubleClick(450, 150);
    expect(hooks.editText).toHaveBeenLastCalledWith(expect.any(String), {
      isNew: true,
    });
    expect(hooks.editText).toHaveBeenCalledTimes(2);
  });

  it("edits a text or a shape the Text tool clicks, and adds text elsewhere", () => {
    const words = createElement("text", {
      x: 0,
      y: 0,
      width: 120,
      height: 25,
      text: "existing",
      autoSize: true,
    });
    const box = createElement("rectangle", {
      x: 300,
      y: 0,
      width: 160,
      height: 100,
    });
    const { controller, interaction, hooks } = setup([words, box]);
    const click = (x: number, y: number) => {
      clock += 1000;
      interaction.pointerDown(event(x, y));
      interaction.pointerUp(event(x, y));
    };

    useTool(controller, "text");
    click(20, 12);
    expect(hooks.editText).toHaveBeenLastCalledWith(words.id);
    expect(controller.state.selectedIds).toEqual([words.id]);

    // Inside a hollow shape: its label, not a loose text on top of it.
    useTool(controller, "text");
    click(380, 50);
    expect(hooks.editText).toHaveBeenLastCalledWith(box.id);

    useTool(controller, "text");
    click(700, 400);
    expect(hooks.editText).toHaveBeenLastCalledWith(expect.any(String), {
      isNew: true,
    });
  });

  it("opens a task on a double click on its card", () => {
    const card = createElement("task", { x: 0, y: 0, taskId: "task-7" });
    const { interaction, hooks } = setup([card]);
    clock += 1000;
    interaction.pointerDown(event(20, 20));
    interaction.pointerUp(event(20, 20));
    clock += 100;
    interaction.pointerDown(event(20, 20));
    expect(hooks.openTask).toHaveBeenCalledWith("task-7");
  });
});

describe("resizing the selection", () => {
  const filled = { fillColor: "#a5d8ff", fillStyle: "solid" } as const;

  function grouped() {
    const heart = createElement("shape", {
      shape: "heart",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      groupIds: ["g"],
      ...filled,
    });
    const dot = createElement("draw", {
      x: 40,
      y: 40,
      points: [
        [0, 0],
        [0.5, 0.5],
      ],
      strokeWidth: 2,
      groupIds: ["g"],
    });
    return [heart, dot];
  }

  it("scales a group like a picture from a corner, even on an uneven drag", () => {
    const [heart, dot] = grouped() as [BoardElement, BoardElement];
    const { doc, controller, interaction } = setup([heart, dot]);
    controller.select([heart.id, dot.id]);
    // The bottom-right handle sits 4px outside the corner; drag it far right
    // but only a little down.
    drag(interaction, [
      [104, 104],
      [200, 150],
      [304, 140],
    ]);
    const after = readElement(doc, heart.id);
    const dotAfter = readElement(doc, dot.id);
    expect(after?.width).toBeCloseTo(300);
    expect(after?.height).toBeCloseTo(300);
    expect(after?.strokeWidth).toBeCloseTo(heart.strokeWidth * 3);
    expect(dotAfter?.strokeWidth).toBeCloseTo(6);
    expect(dotAfter?.x).toBeCloseTo(120);
  });

  it("stretches a group from a side handle without thickening it", () => {
    const [heart, dot] = grouped() as [BoardElement, BoardElement];
    const { doc, controller, interaction } = setup([heart, dot]);
    controller.select([heart.id, dot.id]);
    drag(interaction, [
      [104, 50],
      [204, 50],
    ]);
    const after = readElement(doc, heart.id);
    expect(after?.width).toBeCloseTo(200);
    expect(after?.height).toBeCloseTo(100);
    expect(after?.strokeWidth).toBe(heart.strokeWidth);
    expect(readElement(doc, dot.id)?.strokeWidth).toBe(2);
  });

  it("puts the dragged edges on the grid, not the pointer beside them", () => {
    const box = createElement("rectangle", {
      x: 0,
      y: 0,
      width: 100,
      height: 60,
      ...filled,
    });
    const { doc, controller, interaction } = setup([box]);
    controller.writeSettings({ gridSize: 20 });
    controller.select([box.id]);
    drag(interaction, [
      [104, 64],
      [137, 91],
    ]);
    const after = readElement(doc, box.id);
    expect(after?.width).toBe(140);
    expect(after?.height).toBe(80);
  });

  it("snaps a dragged edge to another element and shows the guide", () => {
    const box = createElement("rectangle", {
      x: 0,
      y: 0,
      width: 100,
      height: 60,
      ...filled,
    });
    const other = createElement("rectangle", {
      x: 0,
      y: 200,
      width: 160,
      height: 40,
      ...filled,
    });
    const { doc, controller, interaction } = setup([box, other]);
    controller.resize(800, 600, 1);
    controller.update((state) => ({ ...state, snapToObjects: true }));
    controller.select([box.id]);
    clock += 1000;
    interaction.pointerDown(event(104, 64));
    interaction.pointerMove(event(130, 70));
    // 3px short of the other element's right edge.
    interaction.pointerMove(event(161, 70));
    expect(controller.overlay.guides).toContainEqual(
      expect.objectContaining({ x1: 160, x2: 160 }),
    );
    interaction.pointerUp(event(161, 70));
    expect(readElement(doc, box.id)?.width).toBe(160);
    expect(controller.overlay.guides).toEqual([]);

    // Ctrl/Cmd turns snapping off.
    controller.select([box.id]);
    drag(
      interaction,
      [
        [164, 64],
        [167, 64],
      ],
      { ctrlKey: true },
    );
    expect(readElement(doc, box.id)?.width).toBe(163);
  });
  it("keeps a line in the selection attached to a shape outside it", () => {
    const inside = createElement("rectangle", {
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      groupIds: ["g"],
      ...filled,
    });
    const outside = createElement("rectangle", {
      x: 400,
      y: 0,
      width: 100,
      height: 100,
      ...filled,
    });
    const arrow = createElement("arrow", {
      x: 106,
      y: 50,
      points: [
        [0, 0],
        [288, 0],
      ],
      groupIds: ["g"],
      startBinding: { elementId: inside.id, focus: [0.5, 0.5], gap: 6 },
      endBinding: { elementId: outside.id, focus: [0.5, 0.5], gap: 6 },
    });
    const { doc, controller, interaction } = setup([inside, outside, arrow]);
    controller.select([inside.id, arrow.id]);
    // Turn the group a quarter turn with the rotation handle above it: the
    // arrow swings round but its far end stays on the outside shape.
    drag(interaction, [
      [197, -26],
      [240, 0],
      [273, 50],
    ]);
    const after = readElement(doc, arrow.id);
    if (after?.type !== "arrow") throw new Error("arrow missing");
    expect(after.endBinding?.elementId).toBe(outside.id);
    const last = after.points[after.points.length - 1] ?? [0, 0];
    const end = { x: after.x + last[0], y: after.y + last[1] };
    // Within the binding gap of the outside shape's box.
    expect(end.x).toBeGreaterThan(390);
    expect(end.x).toBeLessThan(506);
    expect(end.y).toBeGreaterThan(-8);
    expect(end.y).toBeLessThan(108);
  });
});

describe("stylus", () => {
  const pen = (x: number, y: number, extra: Record<string, unknown> = {}) =>
    event(x, y, {}, { pointerId: 7, pointerType: "pen", ...extra });
  const finger = (
    x: number,
    y: number,
    pointerId = 20,
    extra: Record<string, unknown> = {},
  ) => event(x, y, {}, { pointerId, pointerType: "touch", ...extra });

  it("ignores a resting palm while the pen draws", () => {
    const { doc, controller, interaction } = setup();
    useTool(controller, "draw");
    clock += 1000;
    interaction.pointerDown(pen(10, 10, { pressure: 0.4 }));
    interaction.pointerDown(finger(200, 200));
    interaction.pointerMove(finger(260, 260));
    interaction.pointerMove(pen(30, 20, { pressure: 0.8 }));
    interaction.pointerUp(finger(260, 260));
    interaction.pointerUp(pen(30, 20));
    const strokes = readElements(doc);
    expect(strokes).toHaveLength(1);
    expect(strokes[0]).toMatchObject({ type: "draw", x: 10, y: 10 });
    expect(controller.state.viewport).toEqual(
      expect.objectContaining({ scrollX: 0, scrollY: 0 }),
    );
  });

  it("ignores a palm that lands while the pen hovers", () => {
    const { doc, controller, interaction } = setup();
    useTool(controller, "draw");
    clock += 1000;
    interaction.pointerMove(pen(10, 10, { buttons: 0 }));
    clock += 100;
    interaction.pointerDown(finger(200, 200));
    interaction.pointerMove(finger(260, 260));
    interaction.pointerUp(finger(260, 260));
    expect(readElements(doc)).toHaveLength(0);
  });

  it("drops what a palm started when the pen comes down", () => {
    const { doc, controller, interaction } = setup();
    useTool(controller, "draw");
    clock += 1000;
    interaction.pointerDown(finger(200, 200));
    interaction.pointerMove(finger(220, 220));
    interaction.pointerDown(pen(10, 10));
    interaction.pointerMove(finger(260, 260));
    interaction.pointerUp(finger(260, 260));
    interaction.pointerMove(pen(40, 30));
    interaction.pointerUp(pen(40, 30));
    const strokes = readElements(doc);
    expect(strokes).toHaveLength(1);
    expect(strokes[0]).toMatchObject({ x: 10, y: 10 });
  });

  it("still pinches with two fingers when no pen is near", () => {
    const { controller, interaction } = setup();
    useTool(controller, "draw");
    clock += 1000;
    interaction.pointerDown(finger(100, 100, 21));
    interaction.pointerDown(finger(200, 100, 22));
    interaction.pointerMove(finger(50, 100, 21));
    interaction.pointerMove(finger(250, 100, 22));
    expect(controller.state.viewport.zoom).toBeCloseTo(2);
  });

  it("pans with one finger and never draws in pen-only mode", () => {
    const { doc, controller, interaction } = setup();
    controller.update((state) => ({ ...state, penOnly: true }));
    useTool(controller, "draw");
    clock += 1000;
    interaction.pointerDown(finger(100, 100));
    interaction.pointerMove(finger(150, 120));
    interaction.pointerUp(finger(150, 120));
    expect(readElements(doc)).toHaveLength(0);
    expect(controller.state.viewport.scrollX).toBeCloseTo(50);
    expect(controller.state.viewport.scrollY).toBeCloseTo(20);
    // The pen still draws.
    clock += 1000;
    interaction.pointerDown(pen(10, 10));
    interaction.pointerMove(pen(40, 30));
    interaction.pointerUp(pen(40, 30));
    expect(readElements(doc)).toHaveLength(1);
  });

  it("erases with the pen's eraser end whatever the tool", () => {
    const box = createElement("rectangle", {
      x: 0,
      y: 0,
      width: 50,
      height: 50,
      fillColor: "#bfdbfe",
    });
    const { doc, controller, interaction } = setup([box]);
    useTool(controller, "draw");
    clock += 1000;
    interaction.pointerDown(pen(25, 25, { button: 5, buttons: 32 }));
    interaction.pointerMove(pen(30, 30, { button: -1, buttons: 32 }));
    interaction.pointerUp(pen(30, 30, { button: 5, buttons: 0 }));
    expect(readElements(doc)).toHaveLength(0);
    expect(controller.state.tool).toBe("draw");
  });

  it("keeps pen pressure to two decimals", () => {
    const { doc, controller, interaction } = setup();
    useTool(controller, "draw");
    clock += 1000;
    interaction.pointerDown(pen(10, 10, { pressure: 0.12345 }));
    interaction.pointerMove(pen(20, 15, { pressure: 0.6789 }));
    interaction.pointerUp(pen(20, 15));
    const [stroke] = readElements(doc);
    expect(stroke?.type === "draw" && stroke.pressures).toEqual([0.12, 0.68]);
  });
});
