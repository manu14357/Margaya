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
import { layoutHandles } from "./handles";
import { Interaction } from "./interaction";
import type { ToolId } from "./tools";

// Gestures found broken in a hands-on pass over the board, driven with
// synthetic pointer events. The canvas is not attached, so client
// coordinates are board coordinates at zoom 1.

const controllers: BoardController[] = [];
let clock = 0;

function setup(elements: BoardElement[] = []) {
  const doc = new Y.Doc();
  if (elements.length > 0) writeElements(doc, elements, "seed");
  const controller = new BoardController({
    doc,
    awareness: null,
    readOnly: false,
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

function event(x: number, y: number) {
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
  } as unknown as PointerEvent;
}

function drag(interaction: Interaction, points: [number, number][]) {
  const [first, ...rest] = points;
  if (!first) return;
  clock += 1000;
  interaction.pointerDown(event(first[0], first[1]));
  for (const [x, y] of rest) interaction.pointerMove(event(x, y));
  const last = rest[rest.length - 1] ?? first;
  interaction.pointerUp(event(last[0], last[1]));
}

function useTool(controller: BoardController, tool: ToolId) {
  controller.dispatchTool({ type: "pick", tool, readOnly: false });
}

vi.spyOn(performance, "now").mockImplementation(() => clock);

afterEach(() => {
  for (const controller of controllers.splice(0)) controller.dispose();
});

describe("frames", () => {
  it("takes a new frame and what it adopted back in one undo", () => {
    const shape = createElement("rectangle", {
      x: 50,
      y: 50,
      width: 40,
      height: 40,
    });
    const { doc, controller, interaction } = setup([shape]);
    useTool(controller, "frame");
    drag(interaction, [
      [0, 0],
      [100, 100],
      [200, 200],
    ]);
    const frame = readElements(doc).find((element) => element.type === "frame");
    expect(readElement(doc, shape.id)?.frameId).toBe(frame?.id);

    controller.undo();
    expect(readElements(doc).map((element) => element.type)).toEqual([
      "rectangle",
    ]);
    expect(readElement(doc, shape.id)?.frameId).toBeNull();
  });

  it("puts a shape drawn inside a frame into it", () => {
    const frame = createElement("frame", {
      x: 0,
      y: 0,
      width: 400,
      height: 300,
    });
    const { doc, controller, interaction } = setup([frame]);
    useTool(controller, "rectangle");
    drag(interaction, [
      [50, 50],
      [100, 100],
      [150, 120],
    ]);
    const rect = readElements(doc).find(
      (element) => element.type === "rectangle",
    );
    expect(rect?.frameId).toBe(frame.id);
  });

  it("leaves a shape drawn outside every frame loose", () => {
    const frame = createElement("frame", {
      x: 0,
      y: 0,
      width: 100,
      height: 100,
    });
    const { doc, controller, interaction } = setup([frame]);
    useTool(controller, "rectangle");
    drag(interaction, [
      [300, 300],
      [350, 350],
      [400, 380],
    ]);
    const rect = readElements(doc).find(
      (element) => element.type === "rectangle",
    );
    expect(rect?.frameId).toBeNull();
  });
});

describe("sticky notes", () => {
  it("writes a new note only when its editor closes, so one undo removes it", () => {
    const { doc, controller, interaction, hooks } = setup();
    useTool(controller, "sticky");
    drag(interaction, [[100, 100]]);
    // Shown and being edited, but not in the document yet.
    expect(readElements(doc)).toEqual([]);
    const [id, options] = hooks.editText.mock.calls[0] ?? [];
    expect(options).toEqual({ isNew: true });
    expect(controller.get(id)).toMatchObject({ type: "sticky" });
    expect(controller.state.selectedIds).toEqual([id]);
    expect(controller.state.tool).toBe("select");
  });
});

describe("text", () => {
  it("offers side handles on a one-line text so it can be given a wrap width", () => {
    const frame = { x: 0, y: 0, width: 300, height: 25, angle: 0 };
    const plain = layoutHandles(frame, 1).map((handle) => handle.id);
    expect(plain).not.toContain("e");
    const text = layoutHandles(frame, 1, { stretchable: true }).map(
      (handle) => handle.id,
    );
    expect(text).toEqual(expect.arrayContaining(["e", "w"]));
  });

  it("wraps a text dragged narrower by its side handle and grows it to its lines", () => {
    const text = createElement("text", {
      x: 0,
      y: 0,
      width: 300,
      height: 25,
      text: "one two three four five six seven eight nine ten",
      autoSize: true,
      fontSize: 20,
    } as never);
    const { doc, controller, interaction } = setup([text]);
    controller.select([text.id]);
    // The right handle sits 4 px outside the box, halfway down.
    drag(interaction, [
      [304, 12.5],
      [250, 12.5],
      [104, 12.5],
    ]);
    const after = readElement(doc, text.id);
    // The top stays put: the text grows downwards into its new lines.
    expect(after).toMatchObject({ x: 0, y: 0, autoSize: false });
    expect(after?.width).toBeLessThan(150);
    expect(after?.height).toBeGreaterThan(25);
  });
});
