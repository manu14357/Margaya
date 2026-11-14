import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { createElement } from "../../../apps/api/src/whiteboard/board";
import {
  boardUpdateShapeError,
  elementRepairs,
  settingsRepairs,
} from "../../../apps/api/src/whiteboard/collab/validate";

function updateOf(change: (doc: Y.Doc) => void): Uint8Array {
  const doc = new Y.Doc();
  change(doc);
  return Y.encodeStateAsUpdate(doc);
}

describe("board update structure", () => {
  it("accepts plain element values in the elements map", () => {
    const element = createElement("rectangle", { x: 1, y: 2 });
    const update = updateOf((doc) =>
      doc.getMap("elements").set(element.id, element),
    );
    expect(boardUpdateShapeError(update)).toBeNull();
  });

  it("accepts overwrites and deletions of existing keys", () => {
    const element = createElement("sticky", { text: "a" });
    const doc = new Y.Doc();
    doc.getMap("elements").set(element.id, element);
    const before = Y.encodeStateVector(doc);
    doc.getMap("elements").set(element.id, { ...element, version: 2 });
    doc.getMap("elements").delete(element.id);
    expect(
      boardUpdateShapeError(Y.encodeStateAsUpdate(doc, before)),
    ).toBeNull();
  });

  it("refuses nested shared types, text and other root types", () => {
    expect(
      boardUpdateShapeError(
        updateOf((doc) => doc.getMap("elements").set("x", new Y.Map())),
      ),
    ).toMatch(/plain values/);
    expect(
      boardUpdateShapeError(
        updateOf((doc) => doc.getText("elements").insert(0, "hi")),
      ),
    ).not.toBeNull();
    expect(
      boardUpdateShapeError(
        updateOf((doc) => doc.getMap("secrets").set("a", 1)),
      ),
    ).toMatch(/unknown root/);
    expect(
      boardUpdateShapeError(
        updateOf((doc) => doc.getArray("settings").push([1])),
      ),
    ).toMatch(/list content/);
  });
});

describe("element repairs", () => {
  function mapWith(values: Record<string, unknown>) {
    const doc = new Y.Doc();
    const map = doc.getMap<unknown>("elements");
    for (const [key, value] of Object.entries(values)) map.set(key, value);
    return map;
  }

  it("keeps valid elements untouched", () => {
    const element = createElement("ellipse", { x: 5 });
    const map = mapWith({ [element.id]: element });
    expect(elementRepairs(map, [element.id], new Set())).toEqual({
      remove: [],
      replace: [],
    });
  });

  it("removes unrecoverable values and ids that don't match their key", () => {
    const element = createElement("text", { text: "hi" });
    const map = mapWith({
      junk: "not an element",
      moved: element,
      script: { id: "script", type: "iframe", src: "javascript:alert(1)" },
    });
    const repair = elementRepairs(
      map,
      ["junk", "moved", "script"],
      new Set(["junk", "moved", "script"]),
    );
    expect(repair.remove.sort()).toEqual(["junk", "moved", "script"]);
    expect(repair.replace).toEqual([]);
  });

  it("replaces repairable elements with their clean form, one version up", () => {
    const element = createElement("rectangle", { x: 1 });
    const dirty = {
      ...element,
      strokeColor: "url(javascript:alert(1))",
      link: "javascript:alert(1)",
      extra: "dropped",
    };
    const map = mapWith({ [element.id]: dirty });
    const repair = elementRepairs(map, [element.id], new Set());
    expect(repair.remove).toEqual([]);
    expect(repair.replace).toHaveLength(1);
    const [fixed] = repair.replace;
    expect(fixed?.id).toBe(element.id);
    expect(fixed?.version).toBe(element.version + 1);
    expect(fixed).not.toHaveProperty("extra");
    expect(fixed?.link).toBeNull();
    expect(fixed?.strokeColor).not.toContain("javascript");
  });
});

describe("settings repairs", () => {
  it("drops unknown keys and fixes invalid values", () => {
    const doc = new Y.Doc();
    const map = doc.getMap<unknown>("settings");
    map.set("background", "#ffffff");
    map.set("gridSize", 20);
    expect(settingsRepairs(map)).toEqual({ remove: [], set: {} });
    map.set("evil", "<script>");
    map.set("background", "expression(alert(1))");
    const repair = settingsRepairs(map);
    expect(repair.remove).toEqual(["evil"]);
    expect(repair.set.background).toMatch(/^#|^transparent|^rgb/);
  });
});
