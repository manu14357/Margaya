import {
  type BoardElement,
  createElement,
  writeElements,
} from "@margaya/whiteboard";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { BoardController } from "./controller";
import { clearCursorCache } from "./cursors";
import { Interaction } from "./interaction";
import { patchStyle } from "./store";

// The canvas cursor follows the tool, the pen and pans. A stand-in canvas
// records the cursor; nothing is painted.

const controllers: BoardController[] = [];
const stops: (() => void)[] = [];

function fakeCanvas() {
  return {
    style: { cursor: "" },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    getContext: () => null,
    setPointerCapture: () => {},
    hasPointerCapture: () => false,
    releasePointerCapture: () => {},
  } as unknown as HTMLCanvasElement;
}

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
  controllers.push(controller);
  const canvas = fakeCanvas();
  controller.attach(fakeCanvas(), canvas);
  const interaction = new Interaction(controller, {
    editText: vi.fn(),
    openTask: vi.fn(),
    openLink: vi.fn(),
  });
  stops.push(interaction.watchCursor());
  return { controller, interaction, canvas };
}

function pointer(x: number, y: number, extra: Record<string, unknown> = {}) {
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
    target: null,
    preventDefault: () => {},
    ...extra,
  } as unknown as PointerEvent;
}

afterEach(() => {
  for (const stop of stops.splice(0)) stop();
  for (const controller of controllers.splice(0)) controller.dispose();
  clearCursorCache();
});

describe("canvas cursor", () => {
  it("changes with the tool, without waiting for the pointer to move", () => {
    const { controller, canvas } = setup();
    expect(canvas.style.cursor).toBe("default");
    controller.dispatchTool({ type: "pick", tool: "text", readOnly: false });
    expect(canvas.style.cursor).toBe("text");
    controller.dispatchTool({
      type: "pick",
      tool: "rectangle",
      readOnly: false,
    });
    expect(canvas.style.cursor).toBe("crosshair");
    controller.dispatchTool({ type: "pick", tool: "draw", readOnly: false });
    expect(canvas.style.cursor).toContain("data:image/svg+xml");
  });

  it("follows the pen style and the colour", () => {
    const { controller, canvas } = setup();
    controller.dispatchTool({ type: "pick", tool: "draw", readOnly: false });
    const pen = canvas.style.cursor;
    controller.update((state) => ({ ...state, penStyle: "marker" }));
    const marker = canvas.style.cursor;
    expect(marker).not.toBe(pen);
    controller.update((state) => patchStyle(state, { strokeColor: "#e03131" }));
    const red = canvas.style.cursor;
    expect(red).not.toBe(marker);
    expect(decodeURIComponent(red)).toContain("#e03131");
    // The highlighter keeps its own colour.
    controller.update((state) => ({ ...state, penStyle: "highlighter" }));
    expect(decodeURIComponent(canvas.style.cursor)).not.toContain("#e03131");
    controller.update((state) =>
      patchStyle(state, { highlighterColor: "#40c057" }),
    );
    expect(decodeURIComponent(canvas.style.cursor)).toContain("#40c057");
  });

  it("grabs while panning, with the hand, Space or the middle button", () => {
    const { controller, interaction, canvas } = setup();
    controller.dispatchTool({ type: "pick", tool: "hand", readOnly: false });
    expect(canvas.style.cursor).toBe("grab");
    interaction.pointerDown(pointer(10, 10));
    expect(canvas.style.cursor).toBe("grabbing");
    interaction.pointerMove(pointer(40, 30));
    expect(canvas.style.cursor).toBe("grabbing");
    interaction.pointerUp(pointer(40, 30));
    expect(canvas.style.cursor).toBe("grab");

    // Space holds the hand and gives the pen back on release.
    controller.dispatchTool({ type: "pick", tool: "draw", readOnly: false });
    const pen = canvas.style.cursor;
    controller.dispatchTool({ type: "holdHand" });
    expect(canvas.style.cursor).toBe("grab");
    controller.dispatchTool({ type: "releaseHand" });
    expect(canvas.style.cursor).toBe(pen);

    // A middle-button pan returns to the pen, not to the arrow.
    interaction.pointerDown(pointer(10, 10, { button: 1 }));
    expect(canvas.style.cursor).toBe("grabbing");
    interaction.pointerUp(pointer(10, 10, { button: 1 }));
    expect(canvas.style.cursor).toBe(pen);
  });

  it("offers a move over unlocked elements only", () => {
    const free = createElement("rectangle", {
      id: "free",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      fillColor: "#ffffff",
    });
    const locked = createElement("rectangle", {
      id: "locked",
      x: 300,
      y: 0,
      width: 100,
      height: 100,
      fillColor: "#ffffff",
      locked: true,
    });
    const { interaction, canvas } = setup([free, locked]);
    interaction.pointerMove(pointer(50, 50, { buttons: 0 }));
    expect(canvas.style.cursor).toBe("move");
    interaction.pointerMove(pointer(350, 50, { buttons: 0 }));
    expect(canvas.style.cursor).toBe("default");
    interaction.pointerMove(pointer(600, 500, { buttons: 0 }));
    expect(canvas.style.cursor).toBe("default");
  });

  it("keeps a read-only board on the arrow", () => {
    const shape = createElement("rectangle", {
      id: "r",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      fillColor: "#ffffff",
    });
    const { controller, interaction, canvas } = setup([shape]);
    controller.setOptions({ readOnly: true });
    controller.dispatchTool({ type: "pick", tool: "draw", readOnly: true });
    interaction.refreshCursor();
    expect(canvas.style.cursor).toBe("default");
    interaction.pointerMove(pointer(50, 50, { buttons: 0 }));
    expect(canvas.style.cursor).toBe("default");
  });

  it("drops the drawing cursor when the board turns read-only", () => {
    const { controller, interaction, canvas } = setup();
    controller.dispatchTool({ type: "pick", tool: "draw", readOnly: false });
    expect(canvas.style.cursor).toContain("url(");
    controller.setOptions({ readOnly: true });
    interaction.refreshCursor();
    expect(canvas.style.cursor).toBe("default");
  });

  it("hides the canvas cursor under the eraser ring, with a small ring without it", () => {
    const { controller, interaction, canvas } = setup();
    controller.dispatchTool({ type: "pick", tool: "eraser", readOnly: false });
    expect(canvas.style.cursor).toBe("none");
    interaction.eraserRing = false;
    interaction.refreshCursor();
    expect(canvas.style.cursor).toContain("cell");
    interaction.eraserRing = true;
    interaction.refreshCursor();
    expect(canvas.style.cursor).toBe("none");
  });

  it("does not touch the canvas style when nothing changed", () => {
    const { controller, interaction, canvas } = setup();
    controller.dispatchTool({ type: "pick", tool: "draw", readOnly: false });
    const writes = vi.fn();
    const style = canvas.style as unknown as { cursor: string };
    let value = style.cursor;
    Object.defineProperty(style, "cursor", {
      get: () => value,
      set: (next: string) => {
        writes(next);
        value = next;
      },
    });
    for (let index = 0; index < 20; index++)
      interaction.pointerMove(pointer(index * 5, 40, { buttons: 0 }));
    expect(writes).not.toHaveBeenCalled();
  });
});
