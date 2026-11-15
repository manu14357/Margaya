import {
  type BoardElement,
  createElement,
  readElement,
  readElements,
  updateElement,
  writeElements,
} from "@margaya/whiteboard";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import {
  copySelection,
  duplicateSelection,
  nudge,
  runCommand,
  selectAll,
} from "./commands";
import { BoardController, type ControllerOptions } from "./controller";

const controllers: BoardController[] = [];

function setup(
  elements: BoardElement[],
  options: Partial<ControllerOptions> = {},
) {
  const doc = new Y.Doc();
  if (elements.length > 0) writeElements(doc, elements, "seed");
  const controller = new BoardController({
    doc,
    awareness: null,
    readOnly: false,
    user: { id: "me", name: "Me", color: "#2563eb" },
    whiteboardId: "board-1",
    theme: "light",
    imageUrl: (id) => `/assets/${id}`,
    isPublic: false,
    ...options,
  });
  const notice = vi.fn();
  controller.callbacks = { notice };
  controllers.push(controller);
  return { doc, controller, notice };
}

/** Applies an edit made in another client's copy of the document. */
function remoteEdit(doc: Y.Doc, id: string, patch: Record<string, unknown>) {
  const other = new Y.Doc();
  Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
  const element = readElement(other, id);
  if (!element) throw new Error("missing element");
  const before = Y.encodeStateVector(doc);
  writeElements(other, [
    updateElement(element, patch as never, { userId: "them" }),
  ]);
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(other, before), "remote-provider");
  other.destroy();
}

afterEach(() => {
  for (const controller of controllers.splice(0)) controller.dispose();
});

describe("board controller", () => {
  it("writes local edits through the document and undoes them", () => {
    const rect = createElement("rectangle", {
      x: 0,
      y: 0,
      width: 100,
      height: 50,
    });
    const { doc, controller } = setup([rect]);
    const current = controller.scene.get(rect.id) as BoardElement;
    expect(controller.patch([current], { x: 40 })).toBe(true);
    expect(readElement(doc, rect.id)?.x).toBe(40);
    expect(controller.history.canUndo).toBe(true);
    controller.undo();
    expect(readElement(doc, rect.id)?.x).toBe(0);
    controller.redo();
    expect(readElement(doc, rect.id)?.x).toBe(40);
  });

  it("never undoes a collaborator's edit", () => {
    const rect = createElement("rectangle", { x: 0, strokeColor: "#1e1e1e" });
    const { doc, controller } = setup([rect]);
    controller.patch([controller.scene.get(rect.id) as BoardElement], {
      x: 25,
    });
    remoteEdit(doc, rect.id, { strokeColor: "#dc2626" });
    expect(readElement(doc, rect.id)?.strokeColor).toBe("#dc2626");

    controller.undo();
    const after = readElement(doc, rect.id);
    // Our move is reverted, their colour stays.
    expect(after?.x).toBe(0);
    expect(after?.strokeColor).toBe("#dc2626");

    // The remote edit is not on our undo stack at all.
    expect(controller.history.canUndo).toBe(false);
    controller.undo();
    expect(readElement(doc, rect.id)?.strokeColor).toBe("#dc2626");
  });

  it("follows the document again after a dispose and reconnect (strict mode)", () => {
    const rect = createElement("rectangle", { x: 0 });
    const { doc, controller } = setup([rect]);
    controller.dispose();
    // An edit while disconnected is picked up on reconnect.
    remoteEdit(doc, rect.id, { x: 10 });
    controller.connect();
    expect(controller.scene.get(rect.id)?.x).toBe(10);

    const sticky = createElement("sticky", { x: 200 });
    writeElements(doc, [sticky], "remote-provider");
    expect(controller.scene.get(sticky.id)?.x).toBe(200);
    expect(controller.state.sceneVersion).toBe(controller.scene.version);

    const current = controller.scene.get(rect.id) as BoardElement;
    expect(controller.patch([current], { x: 40 })).toBe(true);
    expect(controller.scene.get(rect.id)?.x).toBe(40);
    expect(controller.history.canUndo).toBe(true);
  });

  it("does not record remote edits as local history", () => {
    const rect = createElement("rectangle");
    const { doc, controller } = setup([rect]);
    remoteEdit(doc, rect.id, { x: 500 });
    expect(controller.scene.get(rect.id)?.x).toBe(500);
    expect(controller.history.canUndo).toBe(false);
  });

  it("puts inserted elements on top and selects them", () => {
    const bottom = createElement("rectangle");
    const { controller } = setup([bottom]);
    const added = controller.newElement("ellipse", { x: 10, y: 10 });
    expect(controller.insert([added])).toBe(true);
    const ids = controller.scene.elements.map((element) => element.id);
    expect(ids).toEqual([bottom.id, added.id]);
    expect(controller.state.selectedIds).toEqual([added.id]);
  });

  it("stacks a batch of new elements in the order given, whatever their ids", () => {
    const { controller } = setup([]);
    // New elements share one default order key; only their ids differ.
    const batch = ["zz-first", "mm-second", "aa-third"].map((id) => ({
      ...controller.newElement("sticky", { x: 0, y: 0 }),
      id,
    }));
    expect(controller.insert(batch)).toBe(true);
    expect(controller.scene.elements.map((element) => element.id)).toEqual([
      "zz-first",
      "mm-second",
      "aa-third",
    ]);
  });

  it("keeps the stacking of pasted elements that already have order keys", () => {
    const { controller } = setup([]);
    const low = { ...createElement("rectangle"), id: "aa", order: "a5" };
    const high = { ...createElement("rectangle"), id: "bb", order: "a1" };
    // Given top first: their own keys still decide.
    expect(controller.insert([low, high])).toBe(true);
    expect(controller.scene.elements.map((element) => element.id)).toEqual([
      "bb",
      "aa",
    ]);
  });

  it("folds a whole gesture into one undo step", () => {
    const rect = createElement("rectangle", { x: 0 });
    const { doc, controller } = setup([rect]);
    const base = controller.scene.get(rect.id) as BoardElement;
    for (const x of [5, 10, 15, 20]) controller.setPreview([{ ...base, x }]);
    expect(controller.get(rect.id)?.x).toBe(20);
    controller.commitPreview();
    expect(readElement(doc, rect.id)?.x).toBe(20);
    controller.undo();
    expect(readElement(doc, rect.id)?.x).toBe(0);
    expect(controller.history.canUndo).toBe(false);
  });

  it("puts back what a cancelled gesture had already shown to others", async () => {
    vi.useFakeTimers();
    try {
      const rect = createElement("rectangle", { x: 0 });
      const { doc, controller } = setup([rect]);
      controller.setPreview([
        { ...(controller.scene.get(rect.id) as BoardElement), x: 90 },
      ]);
      await vi.advanceTimersByTimeAsync(100);
      expect(readElement(doc, rect.id)?.x).toBe(90);
      controller.cancelPreview();
      expect(readElement(doc, rect.id)?.x).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("deletes frames with their children and unbinds lines", () => {
    const frame = createElement("frame", {
      x: 0,
      y: 0,
      width: 400,
      height: 300,
    });
    const child = createElement("rectangle", {
      x: 10,
      y: 10,
      frameId: frame.id,
    });
    const target = createElement("ellipse", { x: 600, y: 0 });
    const arrow = createElement("arrow", {
      x: 100,
      y: 100,
      points: [
        [0, 0],
        [500, 0],
      ],
      endBinding: { elementId: target.id, focus: [0.5, 0.5], gap: 6 },
    });
    const { doc, controller } = setup([frame, child, target, arrow]);
    controller.remove([frame.id, target.id]);
    const live = readElements(doc).map((element) => element.id);
    expect(live).toEqual([arrow.id]);
    const line = readElement(doc, arrow.id);
    expect(line?.type === "arrow" && line.endBinding).toBeNull();
  });
});

describe("read-only boards", () => {
  it("refuse every write and say so", async () => {
    const rect = createElement("rectangle", { x: 0 });
    const { doc, controller, notice } = setup([rect], { readOnly: true });
    const before = Y.encodeStateAsUpdate(doc);
    const element = controller.scene.get(rect.id) as BoardElement;

    expect(controller.patch([element], { x: 99 })).toBe(false);
    expect(controller.insert([controller.newElement("ellipse", {})])).toBe(
      false,
    );
    expect(controller.remove([rect.id])).toBe(false);
    expect(controller.writeSettings({ gridSize: 20 })).toBe(false);
    controller.select([rect.id]);
    expect(nudge(controller, 10, 0)).toBe(false);
    expect(duplicateSelection(controller)).toBe(false);
    for (const command of [
      "delete",
      "group",
      "bringToFront",
      "flipHorizontal",
      "toggleGrid",
      "undo",
    ] as const) {
      runCommand(controller, command);
    }
    // A gesture preview is shown locally but never written.
    controller.setPreview([{ ...element, x: 50 }]);
    controller.commitPreview();

    expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
    expect(readElement(doc, rect.id)?.x).toBe(0);
    expect(notice).toHaveBeenCalledWith("readOnly");
  });

  it("still lets people select and copy", async () => {
    const rect = createElement("rectangle");
    const note = createElement("sticky", { text: "hi" });
    const { controller } = setup([rect, note], { readOnly: true });
    selectAll(controller);
    expect(controller.state.selectedIds).toHaveLength(2);
    const setData = vi.fn();
    const event = {
      clipboardData: { setData },
      preventDefault: vi.fn(),
    } as unknown as ClipboardEvent;
    expect(await copySelection(controller, event)).toBe(true);
    const [type, payload] = setData.mock.calls[0] ?? [];
    expect(type).toBe("text/plain");
    expect(JSON.parse(String(payload)).elements).toHaveLength(2);
  });

  it("switches a creation tool back to Select when the board becomes read-only", () => {
    const { controller } = setup([]);
    controller.dispatchTool({
      type: "pick",
      tool: "rectangle",
      readOnly: false,
    });
    controller.setOptions({ readOnly: true });
    expect(controller.state.tool).toBe("select");
  });
});
