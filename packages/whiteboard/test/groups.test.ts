import { describe, expect, it } from "vitest";
import { createElement } from "../src/create.js";
import type { BoardElement } from "../src/elements.js";
import { translateElements } from "../src/geometry.js";
import {
  assignFrames,
  expandSelectionToGroups,
  frameChildren,
  groupElements,
  ungroupElements,
} from "../src/groups.js";

function apply(all: BoardElement[], changed: BoardElement[]): BoardElement[] {
  const byId = new Map(changed.map((element) => [element.id, element]));
  return all.map((element) => byId.get(element.id) ?? element);
}

const byId = (elements: BoardElement[], id: string) =>
  elements.find((element) => element.id === id) as BoardElement;

describe("groups", () => {
  const a = createElement("rectangle", { id: "a" });
  const b = createElement("rectangle", { id: "b" });
  const c = createElement("rectangle", { id: "c" });

  it("groups two or more elements under one new id", () => {
    const changed = groupElements([a, b, c], ["a", "b"], { groupId: "g1" });
    expect(changed.map((element) => element.id)).toEqual(["a", "b"]);
    for (const element of changed) expect(element.groupIds).toEqual(["g1"]);
    expect(groupElements([a, b], ["a"])).toEqual([]);
  });

  it("wraps existing groups from the outside, inside shared groups", () => {
    let all: BoardElement[] = [
      { ...a, groupIds: ["outer", "g1"] },
      { ...b, groupIds: ["outer", "g1"] },
      { ...c, groupIds: ["outer"] },
    ];
    all = apply(all, groupElements(all, ["a", "b", "c"], { groupId: "g2" }));
    expect(byId(all, "a").groupIds).toEqual(["outer", "g2", "g1"]);
    expect(byId(all, "c").groupIds).toEqual(["outer", "g2"]);
  });

  it("ungroups one level at a time", () => {
    let all: BoardElement[] = [
      { ...a, groupIds: ["g2", "g1"] },
      { ...b, groupIds: ["g2", "g1"] },
      { ...c, groupIds: ["g2"] },
    ];
    all = apply(all, ungroupElements(all, ["a", "b", "c"]));
    expect(all.map((element) => element.groupIds)).toEqual([
      ["g1"],
      ["g1"],
      [],
    ]);
    all = apply(all, ungroupElements(all, ["a", "b"]));
    expect(all.map((element) => element.groupIds)).toEqual([[], [], []]);
  });

  it("does not remove a group that is only partly selected", () => {
    const all = [
      { ...a, groupIds: ["g1"] },
      { ...b, groupIds: ["g1"] },
    ];
    expect(ungroupElements(all, ["a"])).toEqual([]);
  });

  it("expands a selection to the outermost group, or the next one while editing", () => {
    const all: BoardElement[] = [
      { ...a, groupIds: ["g2", "g1"] },
      { ...b, groupIds: ["g2", "g1"] },
      { ...c, groupIds: ["g2"] },
      createElement("rectangle", { id: "d" }),
    ];
    expect(expandSelectionToGroups(all, ["a"]).sort()).toEqual(["a", "b", "c"]);
    expect(expandSelectionToGroups(all, ["a"], "g2").sort()).toEqual([
      "a",
      "b",
    ]);
    expect(expandSelectionToGroups(all, ["a"], "g1")).toEqual(["a"]);
    expect(expandSelectionToGroups(all, ["d", "missing"])).toEqual(["d"]);
  });
});

describe("frames", () => {
  const frame = createElement("frame", {
    id: "frame",
    x: 0,
    y: 0,
    width: 400,
    height: 300,
    order: "a0",
  });
  const inside = createElement("rectangle", {
    id: "inside",
    x: 50,
    y: 50,
    width: 100,
    height: 100,
    order: "a1",
  });
  const outside = createElement("rectangle", {
    id: "outside",
    x: 600,
    y: 50,
    width: 100,
    height: 100,
    order: "a2",
  });

  it("joins a frame when moved fully inside and leaves when moved out", () => {
    let all: BoardElement[] = [frame, inside, outside];
    all = apply(all, assignFrames(all, ["inside", "outside"]));
    expect(byId(all, "inside").frameId).toBe("frame");
    expect(byId(all, "outside").frameId).toBeNull();
    expect(frameChildren(all, "frame").map((element) => element.id)).toEqual([
      "inside",
    ]);

    // Partly out: still in the frame.
    all = apply(all, translateElements([byId(all, "inside")], 300, 0));
    expect(assignFrames(all, ["inside"])).toEqual([]);
    // Fully out: leaves.
    all = apply(all, translateElements([byId(all, "inside")], 500, 0));
    all = apply(all, assignFrames(all, ["inside"]));
    expect(byId(all, "inside").frameId).toBeNull();
  });

  it("picks the top-most frame and never nests frames", () => {
    const upper = createElement("frame", {
      id: "upper",
      x: 25,
      y: 25,
      width: 200,
      height: 200,
      order: "a5",
    });
    const all: BoardElement[] = [frame, upper, inside];
    const changed = assignFrames(all, ["inside", "upper"]);
    expect(changed.map((element) => [element.id, element.frameId])).toEqual([
      ["inside", "upper"],
    ]);
  });

  it("collects elements that a moved frame now covers", () => {
    const far = createElement("frame", {
      id: "far",
      x: 500,
      y: 0,
      width: 300,
      height: 300,
    });
    const all: BoardElement[] = [far, outside];
    const [movedFrame] = translateElements([far], 50, 0);
    const changed = assignFrames([movedFrame, outside], ["far"]);
    expect(changed.map((element) => [element.id, element.frameId])).toEqual([
      ["outside", "far"],
    ]);
    expect(all).toHaveLength(2);
  });
});
