import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  createElement,
  deleteElement,
  isNewer,
  updateElement,
} from "../src/create.js";
import type { BoardElement } from "../src/elements.js";
import { BoardHistory, HISTORY_LIMIT } from "../src/history.js";
import { readElement, writeElements } from "../src/yjs.js";

class Store {
  map = new Map<string, BoardElement>();
  write(elements: BoardElement[]) {
    for (const element of elements) this.map.set(element.id, element);
  }
  get = (id: string) => this.map.get(id);
}

describe("BoardHistory", () => {
  it("undoes and redoes a move", () => {
    const store = new Store();
    const history = new BoardHistory();
    const box = createElement("rectangle", { id: "box", x: 0 });
    store.write([box]);
    const moved = updateElement(box, { x: 100 });
    store.write([moved]);
    history.record([box], [moved]);
    expect(history.canUndo).toBe(true);

    const undone = history.undo(store.get);
    expect(undone).toHaveLength(1);
    expect(undone[0].x).toBe(0);
    expect(isNewer(undone[0], moved)).toBe(true);
    store.write(undone);
    expect(history.canRedo).toBe(true);

    store.write(history.redo(store.get));
    expect(store.get("box")?.x).toBe(100);
    expect(history.canRedo).toBe(false);
  });

  it("keeps a collaborator's edits to other fields", () => {
    const store = new Store();
    const history = new BoardHistory();
    const box = createElement("rectangle", {
      id: "box",
      x: 0,
      strokeColor: "#000000",
    });
    store.write([box]);
    const moved = updateElement(box, { x: 50 });
    store.write([moved]);
    history.record([box], [moved]);
    // Someone else recolours and relabels the same element.
    const theirs = updateElement(moved, {
      strokeColor: "#ff0000",
      text: "theirs",
    });
    store.write([theirs]);

    const [undone] = history.undo(store.get);
    expect(undone.x).toBe(0);
    expect(undone.strokeColor).toBe("#ff0000");
    if (undone.type !== "rectangle") throw new Error("expected rectangle");
    expect(undone.text).toBe("theirs");
    expect(undone.version).toBe(theirs.version + 1);
  });

  it("works against a shared document with a remote edit in between", () => {
    const local = new Y.Doc();
    const remote = new Y.Doc();
    local.on("update", (update: Uint8Array) => Y.applyUpdate(remote, update));
    remote.on("update", (update: Uint8Array) => Y.applyUpdate(local, update));
    const history = new BoardHistory({ userId: "me" });
    const note = createElement("sticky", { id: "note", text: "draft", y: 0 });
    writeElements(local, [note]);
    const edited = updateElement(note, { text: "final" });
    writeElements(local, [edited]);
    history.record([note], [edited]);
    const current = readElement(remote, "note") as BoardElement;
    writeElements(remote, [updateElement(current, { y: 300 })]);

    writeElements(
      local,
      history.undo((id) => readElement(local, id)),
    );
    const after = readElement(remote, "note");
    if (after?.type !== "sticky") throw new Error("expected sticky");
    expect(after.text).toBe("draft");
    expect(after.y).toBe(300);
    expect(after.updatedBy).toBe("me");
  });

  it("undoes creation and deletion", () => {
    const store = new Store();
    const history = new BoardHistory();
    const box = createElement("ellipse", { id: "box" });
    store.write([box]);
    history.record([], [box]);
    const [removed] = history.undo(store.get);
    expect(removed.deleted).toBe(true);
    store.write([removed]);
    const [back] = history.redo(store.get);
    expect(back.deleted).toBe(false);
    store.write([back]);

    const gone = deleteElement(back);
    store.write([gone]);
    history.record([back], [gone]);
    const [restored] = history.undo(store.get);
    expect(restored.deleted).toBe(false);
  });

  it("recreates an element on redo when it vanished from the document", () => {
    const history = new BoardHistory();
    const box = createElement("rectangle", { id: "box", x: 7 });
    history.record([], [box]);
    history.undo(() => undefined);
    const [again] = history.redo(() => undefined);
    expect(again.id).toBe("box");
    expect(again.x).toBe(7);
    expect(again.deleted).toBe(false);
  });

  it("skips elements already in the wanted state", () => {
    const store = new Store();
    const history = new BoardHistory();
    const box = createElement("rectangle", { id: "box", x: 0 });
    const moved = updateElement(box, { x: 10 });
    history.record([box], [moved]);
    store.write([updateElement(moved, { x: 0 })]);
    expect(history.undo(store.get)).toEqual([]);
  });

  it("folds a batch into one step and ignores no-op records", () => {
    const store = new Store();
    const history = new BoardHistory();
    const box = createElement("rectangle", { id: "box", x: 0 });
    store.write([box]);
    history.record([box], [box]);
    expect(history.canUndo).toBe(false);

    history.beginBatch();
    let current: BoardElement = box;
    for (let x = 1; x <= 20; x++) {
      const next = updateElement(current, { x });
      history.record([current], [next]);
      current = next;
    }
    const added = createElement("text", { id: "label" });
    history.record([], [added]);
    expect(history.canUndo).toBe(false);
    history.commitBatch();
    store.write([current, added]);

    const undone = history.undo(store.get);
    expect(undone.find((element) => element.id === "box")?.x).toBe(0);
    expect(undone.find((element) => element.id === "label")?.deleted).toBe(
      true,
    );
    expect(history.canUndo).toBe(false);
  });

  it("clears the redo stack on a new change, caps steps and clears", () => {
    const history = new BoardHistory();
    const box = createElement("rectangle", { id: "box", x: 0 });
    let current = box;
    for (let i = 0; i < HISTORY_LIMIT + 50; i++) {
      const next = updateElement(current, { x: i + 1 });
      history.record([current], [next]);
      current = next;
    }
    let steps = 0;
    while (history.canUndo) {
      history.undo(() => current);
      steps++;
    }
    expect(steps).toBe(HISTORY_LIMIT);
    expect(history.canRedo).toBe(true);
    history.record([current], [updateElement(current, { y: 9 })]);
    expect(history.canRedo).toBe(false);
    history.clear();
    expect(history.canUndo).toBe(false);
  });
});
