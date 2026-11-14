import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { createElement, deleteElement, updateElement } from "../src/create.js";
import { type BoardElement, DEFAULT_BOARD_SETTINGS } from "../src/elements.js";
import { extractBoardText, taskIdsOf } from "../src/text.js";
import {
  createBoardDoc,
  decodeBoardState,
  elementsMap,
  encodeBoardState,
  observeBoard,
  observeSettings,
  readElement,
  readElements,
  readSettings,
  writeElements,
  writeSettings,
} from "../src/yjs.js";

function connect(a: Y.Doc, b: Y.Doc) {
  a.on("update", (update: Uint8Array, origin: unknown) => {
    if (origin !== "remote") Y.applyUpdate(b, update, "remote");
  });
  b.on("update", (update: Uint8Array, origin: unknown) => {
    if (origin !== "remote") Y.applyUpdate(a, update, "remote");
  });
}

function sync(a: Y.Doc, b: Y.Doc) {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)));
}

describe("board document", () => {
  it("reads elements sorted by order and hides tombstones by default", () => {
    const top = createElement("rectangle", { id: "top", order: "a2" });
    const bottom = createElement("rectangle", { id: "bottom", order: "a0" });
    const gone = deleteElement(
      createElement("rectangle", { id: "gone", order: "a1" }),
    );
    const doc = createBoardDoc([top, gone, bottom]);
    expect(readElements(doc).map((element) => element.id)).toEqual([
      "bottom",
      "top",
    ]);
    expect(
      readElements(doc, { includeDeleted: true }).map((element) => element.id),
    ).toEqual(["bottom", "gone", "top"]);
    expect(readElement(doc, "top")).toEqual(top);
    expect(readElement(doc, "nope")).toBeUndefined();
  });

  it("skips writes that are older than the stored copy", () => {
    const element = createElement("rectangle", { id: "e" });
    const newer = updateElement(element, { x: 10 });
    const doc = createBoardDoc([newer]);
    expect(writeElements(doc, [element])).toEqual([]);
    expect(readElement(doc, "e")?.x).toBe(10);
    // Same version and nonce: nothing to do.
    expect(writeElements(doc, [{ ...newer }])).toEqual([]);
    const newest = updateElement(newer, { x: 20 });
    expect(writeElements(doc, [newest])).toEqual([newest]);
    expect(readElement(doc, "e")?.x).toBe(20);
  });

  it("writes many elements in a single transaction with the given origin", () => {
    const doc = new Y.Doc();
    const origins: unknown[] = [];
    doc.on("afterTransaction", (transaction: Y.Transaction) => {
      origins.push(transaction.origin);
    });
    writeElements(
      doc,
      [createElement("rectangle"), createElement("ellipse")],
      "local",
    );
    expect(origins).toEqual(["local"]);
  });

  it("stores settings and ignores unknown keys", () => {
    const doc = new Y.Doc();
    writeSettings(doc, { gridSize: 20 });
    expect(readSettings(doc)).toEqual({
      ...DEFAULT_BOARD_SETTINGS,
      gridSize: 20,
    });
    writeSettings(doc, { background: "#000000", ...({ other: 1 } as object) });
    expect(readSettings(doc)).toEqual({
      ...DEFAULT_BOARD_SETTINGS,
      background: "#000000",
      gridSize: 20,
    });
    expect(doc.getMap("settings").has("other")).toBe(false);
  });

  it("reports changed ids per transaction and stops when unsubscribed", () => {
    const doc = new Y.Doc();
    const seen: string[][] = [];
    const stop = observeBoard(doc, (ids) => seen.push([...ids].sort()));
    writeElements(doc, [
      createElement("rectangle", { id: "a" }),
      createElement("rectangle", { id: "b" }),
    ]);
    stop();
    writeElements(doc, [createElement("rectangle", { id: "c" })]);
    expect(seen).toEqual([["a", "b"]]);

    const settings: number[] = [];
    const stopSettings = observeSettings(doc, (value) =>
      settings.push(value.gridSize),
    );
    writeSettings(doc, { gridSize: 8 });
    stopSettings();
    expect(settings).toEqual([8]);
  });

  it("round-trips through an encoded update", () => {
    const elements = [
      createElement("sticky", { id: "s", text: "hello", order: "a0" }),
      createElement("task", { id: "t", taskId: "task1", order: "a1" }),
      deleteElement(createElement("text", { id: "x", order: "a2" })),
    ];
    const update = encodeBoardState(elements, { gridSize: 10 });
    const decoded = decodeBoardState(update);
    expect(decoded.elements.map((element) => element.id)).toEqual(["s", "t"]);
    expect(decoded.settings.gridSize).toBe(10);
    expect(
      decodeBoardState(update, { includeDeleted: true }).elements,
    ).toHaveLength(3);
  });

  it("ignores stored values that are not objects", () => {
    const doc = new Y.Doc();
    (doc.getMap("elements") as Y.Map<unknown>).set("junk", 5);
    (doc.getMap("elements") as Y.Map<unknown>).set("nothing", null);
    writeElements(doc, [createElement("rectangle", { id: "ok" })]);
    expect(readElements(doc).map((element) => element.id)).toEqual(["ok"]);
  });
});

describe("collaboration", () => {
  it("two connected documents converge", () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    connect(a, b);
    const box = createElement("rectangle", { id: "box" });
    writeElements(a, [box]);
    expect(readElement(b, "box")).toEqual(box);
    writeElements(b, [updateElement(box, { x: 42 })]);
    expect(readElement(a, "box")?.x).toBe(42);
    writeElements(a, [createElement("sticky", { id: "note", text: "hi" })]);
    expect(
      readElements(b)
        .map((element) => element.id)
        .sort(),
    ).toEqual(["box", "note"]);
  });

  it("concurrent edits while offline converge to the same state", () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    const shared = createElement("rectangle", { id: "shared" });
    writeElements(a, [shared]);
    sync(a, b);
    // Both edit the same element and add their own elements offline.
    writeElements(a, [updateElement(shared, { x: 1 })]);
    writeElements(b, [
      updateElement(updateElement(shared, { y: 2 }), { y: 3 }),
    ]);
    writeElements(a, [createElement("ellipse", { id: "fromA" })]);
    writeElements(b, [createElement("diamond", { id: "fromB" })]);
    sync(a, b);
    const fromA = readElements(a, { includeDeleted: true });
    const fromB = readElements(b, { includeDeleted: true });
    expect(fromA).toEqual(fromB);
    expect(fromA.map((element) => element.id).sort()).toEqual([
      "fromA",
      "fromB",
      "shared",
    ]);
  });

  it("a late older edit cannot resurrect a deleted element", () => {
    const a = new Y.Doc();
    const b = new Y.Doc();
    connect(a, b);
    const box = createElement("rectangle", { id: "box" });
    const moved = updateElement(box, { x: 1 });
    writeElements(a, [box]);
    writeElements(a, [deleteElement(moved)]);
    // Another client still holds the older copy and edits it.
    const stale = updateElement(box, { x: 5 });
    writeElements(b, [stale]);
    expect(readElements(a)).toEqual([]);
    expect(readElements(b)).toEqual([]);
  });

  it("stores elements as plain JSON values, not nested shared types", () => {
    const doc = createBoardDoc([createElement("line", { id: "l" })]);
    const value = elementsMap(doc).get("l") as BoardElement;
    expect(value).not.toBeInstanceOf(Y.AbstractType);
    expect(JSON.parse(JSON.stringify(value))).toEqual(value);
  });
});

describe("board text", () => {
  it("joins readable text bottom to top and skips deleted elements", () => {
    const elements: BoardElement[] = [
      createElement("frame", { name: "Sprint", order: "a0" }),
      createElement("sticky", { text: "Idea", order: "a1" }),
      createElement("rectangle", { text: "  Box  ", order: "a2" }),
      createElement("arrow", { text: "flows", order: "a3" }),
      createElement("text", { text: "", order: "a4" }),
      deleteElement(createElement("text", { text: "secret", order: "a5" })),
      createElement("task", { taskId: "t1", order: "a6" }),
    ];
    expect(extractBoardText(elements)).toBe("Sprint\nIdea\nBox\nflows");
  });

  it("caps the text at 100k characters", () => {
    const big = Array.from({ length: 10 }, (_, i) =>
      createElement("text", { text: "y".repeat(20_000), order: `a${i}` }),
    );
    expect(extractBoardText(big).length).toBe(100_000);
  });

  it("lists live task ids once", () => {
    const elements = [
      createElement("task", { taskId: "t1", order: "a0" }),
      createElement("task", { taskId: "t2", order: "a1" }),
      createElement("task", { taskId: "t1", order: "a2" }),
      deleteElement(createElement("task", { taskId: "t3", order: "a3" })),
    ];
    expect(taskIdsOf(elements)).toEqual(["t1", "t2"]);
  });
});
