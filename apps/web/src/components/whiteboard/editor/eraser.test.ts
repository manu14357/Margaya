import {
  type BoardElement,
  createElement,
  type DrawElement,
  readElements,
  writeElements,
} from "@margaya/whiteboard";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { BoardController } from "./controller";
import { Interaction } from "./interaction";
import { LOCAL_ORIGIN } from "./scene";
import { ERASER_SIZE, loadPrefs } from "./store";

// The eraser driven with synthetic pointer events. The canvas is not
// attached, so client coordinates are board coordinates at zoom 1.

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
  controllers.push(controller);
  const interaction = new Interaction(controller, {
    editText: vi.fn(),
    openTask: vi.fn(),
    openLink: vi.fn(),
  });
  controller.dispatchTool({ type: "pick", tool: "eraser", readOnly: false });
  return { doc, controller, interaction };
}

function event(x: number, y: number, extra: Record<string, unknown> = {}) {
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
    ...extra,
  } as unknown as PointerEvent;
}

function drag(
  interaction: Interaction,
  points: [number, number][],
  extra: Record<string, unknown> = {},
) {
  const [first, ...rest] = points;
  if (!first) return;
  clock += 1000;
  interaction.pointerDown(event(first[0], first[1], extra));
  for (const [x, y] of rest) interaction.pointerMove(event(x, y, extra));
  const last = rest[rest.length - 1] ?? first;
  interaction.pointerUp(event(last[0], last[1], extra));
}

/** A horizontal pen stroke from (0, 100) to (200, 100), a point every 10. */
function stroke(props: Partial<DrawElement> = {}): DrawElement {
  return createElement("draw", {
    x: 0,
    y: 100,
    points: Array.from({ length: 21 }, (_, i) => [i * 10, 0] as const),
    pressures: Array.from({ length: 21 }, (_, i) => i / 20),
    simulatePressure: false,
    strokeColor: "#e03131",
    strokeWidth: 2,
    opacity: 80,
    penStyle: "marker",
    ...props,
  });
}

const strokes = (doc: Y.Doc) =>
  readElements(doc).filter(
    (element): element is DrawElement => element.type === "draw",
  );

/** Board x of a stroke's first and last points. */
const span = (element: DrawElement) => [
  element.x + (element.points[0]?.[0] ?? 0),
  element.x + (element.points.at(-1)?.[0] ?? 0),
];

vi.spyOn(performance, "now").mockImplementation(() => clock);

afterEach(() => {
  for (const controller of controllers.splice(0)) controller.dispose();
  window.localStorage.clear();
});

describe("eraser", () => {
  it("cuts a stroke in two where it is dragged across", () => {
    const original = stroke();
    const { doc, interaction } = setup([original]);
    drag(interaction, [
      [100, 60],
      [100, 140],
    ]);
    const pieces = strokes(doc).sort((a, b) => a.x - b.x);
    expect(pieces).toHaveLength(2);
    const [left, right] = pieces as [DrawElement, DrawElement];
    expect(left.id).toBe(original.id);
    expect(span(left)[1]).toBeLessThan(100);
    expect(span(right)[0]).toBeGreaterThan(100);
    expect(span(left)[0]).toBeCloseTo(0);
    expect(span(right)[1]).toBeCloseTo(200);
    for (const piece of pieces) {
      expect(piece).toMatchObject({
        strokeColor: "#e03131",
        strokeWidth: 2,
        opacity: 80,
        penStyle: "marker",
        simulatePressure: false,
      });
      expect(piece.pressures).toHaveLength(piece.points.length);
    }
  });

  it("sweeps between far-apart pointer samples, so a fast drag leaves no gap", () => {
    const { doc, interaction } = setup([stroke()]);
    // One sample above the stroke, the next far below it.
    drag(interaction, [
      [50, 0],
      [50, 400],
    ]);
    expect(strokes(doc)).toHaveLength(2);
  });

  it("trims an end without splitting, and erases a stroke covered end to end", () => {
    const { doc, interaction } = setup([stroke()]);
    drag(interaction, [
      [195, 100],
      [205, 100],
    ]);
    const [trimmed] = strokes(doc);
    expect(strokes(doc)).toHaveLength(1);
    expect(span(trimmed as DrawElement)[1]).toBeLessThan(190);
    drag(interaction, [
      [-20, 100],
      [220, 100],
    ]);
    expect(strokes(doc)).toHaveLength(0);
  });

  it("shows the cut while dragging and writes nothing until release", () => {
    const original = stroke();
    const { doc, controller, interaction } = setup([original]);
    clock += 1000;
    interaction.pointerDown(event(100, 60));
    interaction.pointerMove(event(100, 140));
    // The board still holds the whole stroke; the preview holds two pieces.
    expect(strokes(doc)).toHaveLength(1);
    expect(
      controller.elements().filter((element) => element.type === "draw"),
    ).toHaveLength(2);
    interaction.pointerUp(event(100, 140));
    expect(strokes(doc)).toHaveLength(2);
  });

  it("commits a whole drag as one undo step and one document write", () => {
    const original = stroke();
    const { doc, controller, interaction } = setup([original]);
    const writes = vi.fn();
    doc.on("afterTransaction", (transaction: Y.Transaction) => {
      if (transaction.origin === LOCAL_ORIGIN) writes();
    });
    // Two cuts in one drag: three pieces.
    drag(interaction, [
      [50, 60],
      [50, 140],
      [150, 140],
      [150, 60],
    ]);
    expect(strokes(doc)).toHaveLength(3);
    expect(writes).toHaveBeenCalledTimes(1);
    controller.undo();
    const restored = strokes(doc);
    expect(restored).toHaveLength(1);
    expect(restored[0]?.points).toEqual(original.points);
    expect(restored[0]?.pressures).toEqual(original.pressures);
    controller.redo();
    expect(strokes(doc)).toHaveLength(3);
  });

  it("erases strokes whole in the whole-objects mode", () => {
    const { doc, controller, interaction } = setup([stroke()]);
    controller.update((state) => ({ ...state, eraserMode: "whole" }));
    drag(interaction, [
      [100, 60],
      [100, 140],
    ]);
    expect(strokes(doc)).toHaveLength(0);
  });

  it("erases shapes, notes and lines whole in the parts mode", () => {
    const box = createElement("rectangle", {
      x: 300,
      y: 0,
      width: 50,
      height: 50,
      fillColor: "#bfdbfe",
    });
    const line = createElement("line", {
      x: 400,
      y: 0,
      points: [
        [0, 0],
        [0, 200],
      ],
    });
    const { doc, interaction } = setup([box, line]);
    drag(interaction, [
      [325, 25],
      [500, 100],
    ]);
    expect(readElements(doc)).toHaveLength(0);
  });

  it("never erases a locked stroke", () => {
    const { doc, interaction } = setup([stroke({ locked: true })]);
    drag(interaction, [
      [100, 60],
      [100, 140],
    ]);
    expect(strokes(doc)).toHaveLength(1);
    expect(strokes(doc)[0]?.points).toHaveLength(21);
  });

  it("cuts a wider gap with a bigger eraser, the same on screen at any zoom", () => {
    const gap = (size: number, zoom: number) => {
      const { doc, controller, interaction } = setup([stroke()]);
      controller.update((state) => ({
        ...state,
        eraserSize: size,
        viewport: { scrollX: 0, scrollY: 0, zoom },
      }));
      // Screen x = board x * zoom.
      drag(interaction, [
        [100 * zoom, 60 * zoom],
        [100 * zoom, 140 * zoom],
      ]);
      const [left, right] = strokes(doc).sort((a, b) => a.x - b.x) as [
        DrawElement,
        DrawElement,
      ];
      return (span(right)[0] ?? 0) - (span(left)[1] ?? 0);
    };
    const small = gap(8, 1);
    const large = gap(48, 1);
    expect(large - small).toBeCloseTo(40);
    // At zoom 2 the same screen size covers half as much board.
    expect(gap(48, 2) - gap(8, 2)).toBeCloseTo(20);
  });

  it("remembers the eraser size and mode on this device", () => {
    const { controller } = setup();
    controller.update((state) => ({
      ...state,
      eraserSize: 40,
      eraserMode: "whole",
    }));
    expect(loadPrefs()).toMatchObject({ eraserSize: 40, eraserMode: "whole" });
    window.localStorage.setItem(
      "margaya-whiteboard-editor",
      JSON.stringify({ eraserSize: 500, eraserMode: "everything" }),
    );
    const prefs = loadPrefs();
    expect(prefs.eraserSize).toBe(ERASER_SIZE.max);
    expect(prefs.eraserMode).toBeUndefined();
  });

  it("cuts with the pen's eraser end, whatever the tool", () => {
    const { doc, controller, interaction } = setup([stroke()]);
    controller.dispatchTool({ type: "pick", tool: "draw", readOnly: false });
    clock += 1000;
    const pen = { pointerId: 7, pointerType: "pen" };
    interaction.pointerDown(event(100, 60, { ...pen, button: 5, buttons: 32 }));
    interaction.pointerMove(
      event(100, 140, { ...pen, button: -1, buttons: 32 }),
    );
    interaction.pointerUp(event(100, 140, { ...pen, button: 5, buttons: 0 }));
    expect(strokes(doc)).toHaveLength(2);
    expect(controller.state.tool).toBe("draw");
  });

  it("takes a grouped stroke whole with its group when a shape of it is hit", () => {
    const box = createElement("rectangle", {
      x: 300,
      y: 100,
      width: 50,
      height: 50,
      fillColor: "#bfdbfe",
      groupIds: ["g"],
    });
    const { doc, interaction } = setup([stroke({ groupIds: ["g"] }), box]);
    // Cut the stroke first, then touch the shape in the same drag.
    drag(interaction, [
      [100, 60],
      [100, 140],
      [325, 125],
    ]);
    expect(readElements(doc)).toHaveLength(0);
  });

  it("shows the ring while the eraser hovers and hides it when the pointer leaves", () => {
    const { controller, interaction } = setup();
    interaction.pointerMove(event(40, 40, { buttons: 0 }));
    expect(interaction.showsRing()).toBe(true);
    expect(interaction.ringAt).toEqual({ x: 40, y: 40 });
    interaction.pointerLeave();
    expect(interaction.showsRing()).toBe(false);
    controller.dispatchTool({ type: "pick", tool: "select", readOnly: false });
    interaction.pointerMove(event(40, 40, { buttons: 0 }));
    expect(interaction.showsRing()).toBe(false);
  });
});
