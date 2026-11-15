import {
  type BoardElement,
  createElement,
  type ImageElement,
  readElement,
  writeElements,
} from "@margaya/whiteboard";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { resetCrop, runCommand } from "./commands";
import { BoardController } from "./controller";
import { Interaction } from "./interaction";
import { escapeStep } from "./store";

// Crop mode driven with synthetic pointer events. The canvas is not
// attached, so client coordinates are board coordinates at zoom 1.

const controllers: BoardController[] = [];
let clock = 0;
vi.spyOn(performance, "now").mockImplementation(() => clock);

afterEach(() => {
  for (const controller of controllers.splice(0)) controller.dispose();
});

/** A 400x200 picture shown at half size: 200x100 board units at (100, 100). */
function picture(props: Partial<ImageElement> = {}): ImageElement {
  return createElement("image", {
    id: "img",
    x: 100,
    y: 100,
    width: 200,
    height: 100,
    assetId: "asset",
    ...props,
  } as never) as ImageElement;
}

function setup(
  elements: BoardElement[],
  options: { readOnly?: boolean; loaded?: boolean } = {},
) {
  const doc = new Y.Doc();
  writeElements(doc, elements, "seed");
  const controller = new BoardController({
    doc,
    awareness: null,
    readOnly: options.readOnly ?? false,
    user: { id: "me", name: "Me", color: "#2563eb" },
    whiteboardId: "b",
    theme: "light",
    imageUrl: (id) => id,
    isPublic: false,
  });
  // The picture's pixel size comes from the loaded <img>.
  const loaded = options.loaded ?? true;
  controller.images = {
    get: () =>
      loaded
        ? ({ naturalWidth: 400, naturalHeight: 200 } as HTMLImageElement)
        : null,
    load: async () => null,
    dispose: () => {},
  };
  const notice = vi.fn();
  controller.callbacks = { notice };
  controller.update((state) => ({ ...state, snapToObjects: false }));
  controllers.push(controller);
  const hooks = { editText: vi.fn(), openTask: vi.fn(), openLink: vi.fn() };
  const interaction = new Interaction(controller, hooks);
  return { doc, controller, interaction, notice, hooks };
}

type Mods = { shiftKey?: boolean; altKey?: boolean };

function event(x: number, y: number, mods: Mods = {}) {
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
  interaction.pointerDown(event(first[0], first[1], mods));
  for (const [x, y] of rest) interaction.pointerMove(event(x, y, mods));
  const last = rest[rest.length - 1] ?? first;
  interaction.pointerUp(event(last[0], last[1], mods));
}

function doubleClick(interaction: Interaction, x: number, y: number) {
  clock += 1000;
  interaction.pointerDown(event(x, y));
  interaction.pointerUp(event(x, y));
  clock += 50;
  interaction.pointerDown(event(x, y));
  interaction.pointerUp(event(x, y));
}

function stored(doc: Y.Doc) {
  return readElement(doc, "img") as ImageElement;
}

describe("crop mode", () => {
  it("starts on double-click and shows only the eight crop handles", () => {
    const { controller, interaction } = setup([picture()]);
    doubleClick(interaction, 200, 150);
    expect(controller.state.croppingId).toBe("img");
    expect(controller.state.selectedIds).toEqual(["img"]);
    const ids = interaction.handleLayout().map((handle) => handle.id);
    expect(ids).not.toContain("rotate");
    expect(ids).toHaveLength(8);
  });

  it("starts with Enter on a selected image", () => {
    const { controller } = setup([picture()]);
    controller.select(["img"]);
    runCommand(controller, "editText");
    expect(controller.state.croppingId).toBe("img");
  });

  it("crops with a side handle, in picture pixels, keeping the rest in place", () => {
    const { doc, controller, interaction } = setup([picture()]);
    controller.startCrop("img");
    // The east handle sits 4 px outside the right edge, mid-height.
    drag(interaction, [
      [304, 150],
      [280, 150],
      [254, 150],
    ]);
    expect(stored(doc)).toMatchObject({
      x: 100,
      y: 100,
      width: 150,
      height: 100,
      crop: { x: 0, y: 0, width: 300, height: 200 },
    });
    expect(controller.state.croppingId).toBe("img");
  });

  it("keeps the proportions of the crop with Shift", () => {
    const { doc, controller, interaction } = setup([picture()]);
    controller.startCrop("img");
    drag(
      interaction,
      [
        [304, 204],
        [254, 204],
      ],
      { shiftKey: true },
    );
    const image = stored(doc);
    expect(image.width).toBeCloseTo(150);
    expect(image.height).toBeCloseTo(75);
    expect(image.crop?.width).toBeCloseTo(300);
    expect(image.crop?.height).toBeCloseTo(150);
  });

  it("slides the window over the picture when dragging inside", () => {
    const { doc, controller, interaction } = setup([
      picture({ crop: { x: 0, y: 0, width: 200, height: 100 } }),
    ]);
    // Shows the top-left quarter of the picture at scale 1.
    controller.startCrop("img");
    drag(interaction, [
      [200, 150],
      [250, 170],
    ]);
    expect(stored(doc)).toMatchObject({
      x: 150,
      y: 120,
      width: 200,
      height: 100,
      crop: { x: 50, y: 20, width: 200, height: 100 },
    });
  });

  it("crops a rotated image along its own axes", () => {
    // A quarter turn: the image's east side faces down on the board.
    const { doc, controller, interaction } = setup([
      picture({ angle: Math.PI / 2 }),
    ]);
    controller.startCrop("img");
    // Centre (200, 150); the east handle is 104 units below it.
    drag(interaction, [
      [200, 254],
      [200, 204],
    ]);
    const image = stored(doc);
    expect(image.width).toBeCloseTo(150);
    expect(image.height).toBeCloseTo(100);
    expect(image.crop?.width).toBeCloseTo(300);
    // The image's west side (now on top) stayed where it was.
    expect(image.y + image.height / 2 - image.width / 2).toBeCloseTo(50);
  });

  it("ends with Enter, Escape or a click outside, keeping the crop", () => {
    const { doc, controller, interaction } = setup([picture()]);
    controller.startCrop("img");
    drag(interaction, [
      [304, 150],
      [254, 150],
    ]);
    expect(interaction.finishPending()).toBe(true);
    expect(controller.state.croppingId).toBeNull();
    expect(controller.state.selectedIds).toEqual(["img"]);

    controller.startCrop("img");
    controller.update(escapeStep);
    expect(controller.state.croppingId).toBeNull();
    expect(controller.state.selectedIds).toEqual(["img"]);

    controller.startCrop("img");
    drag(interaction, [[600, 600]]);
    expect(controller.state.croppingId).toBeNull();
    expect(stored(doc).width).toBe(150);
  });

  it("ends when another tool is picked or the image is deleted", () => {
    const { controller, interaction } = setup([picture()]);
    controller.startCrop("img");
    interaction.pickTool({ type: "pick", tool: "rectangle", readOnly: false });
    expect(controller.state.croppingId).toBeNull();

    controller.update((state) => ({ ...state, tool: "select" }));
    controller.startCrop("img");
    controller.remove(["img"]);
    expect(controller.state.croppingId).toBeNull();
  });

  it("undoes a whole crop session in one step", () => {
    const { doc, controller, interaction } = setup([picture()]);
    controller.startCrop("img");
    drag(interaction, [
      [304, 150],
      [254, 150],
    ]);
    // Now 150 wide: the west handle sits 4 px left of x = 100.
    drag(interaction, [
      [96, 150],
      [120, 150],
    ]);
    expect(stored(doc).crop?.x).toBeCloseTo(48);
    expect(controller.history.canUndo).toBe(false);
    controller.endCrop();
    expect(stored(doc).crop).not.toBeNull();
    controller.undo();
    expect(stored(doc)).toMatchObject({
      x: 100,
      y: 100,
      width: 200,
      height: 100,
      crop: null,
    });
    expect(controller.history.canUndo).toBe(false);
    controller.redo();
    expect(stored(doc).crop).not.toBeNull();
  });

  it("undo during crop mode ends it and takes the session back", () => {
    const { doc, controller, interaction } = setup([picture()]);
    controller.startCrop("img");
    drag(interaction, [
      [304, 150],
      [254, 150],
    ]);
    controller.undo();
    expect(controller.state.croppingId).toBeNull();
    expect(stored(doc).width).toBe(200);
  });

  it("resets the crop, showing the whole picture where it lay", () => {
    const { doc, controller } = setup([
      picture({ crop: { x: 100, y: 50, width: 200, height: 100 } }),
    ]);
    controller.select(["img"]);
    expect(resetCrop(controller)).toBe(true);
    expect(stored(doc)).toMatchObject({
      x: 0,
      y: 50,
      width: 400,
      height: 200,
      crop: null,
    });
  });

  it("refuses to wait for an image that has not loaded", () => {
    const { controller, notice } = setup([picture()], { loaded: false });
    expect(controller.startCrop("img")).toBe(false);
    expect(controller.state.croppingId).toBeNull();
    expect(notice).toHaveBeenCalledWith("cropUnavailable");
  });
});

describe("crop mode on a read-only board", () => {
  it("refuses to start, by any route", () => {
    const { doc, controller, interaction, notice } = setup([picture()], {
      readOnly: true,
    });
    expect(controller.startCrop("img")).toBe(false);
    expect(notice).toHaveBeenCalledWith("readOnly");
    doubleClick(interaction, 200, 150);
    expect(controller.state.croppingId).toBeNull();
    controller.select(["img"]);
    expect(resetCrop(controller)).toBe(false);
    drag(interaction, [
      [304, 150],
      [254, 150],
    ]);
    expect(stored(doc).width).toBe(200);
  });

  it("ends crop mode when the board turns read-only", () => {
    const { doc, controller, interaction } = setup([picture()]);
    controller.startCrop("img");
    controller.setOptions({ readOnly: true });
    expect(controller.state.croppingId).toBeNull();
    drag(interaction, [
      [304, 150],
      [254, 150],
    ]);
    expect(stored(doc).width).toBe(200);
  });
});
