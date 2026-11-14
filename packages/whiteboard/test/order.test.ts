import { describe, expect, it } from "vitest";
import { createElement } from "../src/create.js";
import type { BoardElement } from "../src/elements.js";
import {
  bringForward,
  bringToFront,
  compareOrder,
  isValidOrder,
  orderBetween,
  ordersBetween,
  repairOrders,
  sendBackward,
  sendToBack,
  sortByOrder,
} from "../src/order.js";

function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

function stack(...ids: string[]): BoardElement[] {
  const keys = ordersBetween(null, null, ids.length);
  return ids.map((id, i) => createElement("rectangle", { id, order: keys[i] }));
}

function apply(all: BoardElement[], changed: BoardElement[]): BoardElement[] {
  const byId = new Map(all.map((element) => [element.id, element]));
  for (const element of changed) byId.set(element.id, element);
  return [...byId.values()];
}

const idsInOrder = (elements: BoardElement[]) =>
  sortByOrder(elements).map((element) => element.id);

describe("orderBetween", () => {
  it("starts in the middle and moves outwards", () => {
    const first = orderBetween(null, null);
    expect(isValidOrder(first)).toBe(true);
    const above = orderBetween(first, null);
    const below = orderBetween(null, first);
    expect(below < first && first < above).toBe(true);
  });

  it("keeps keys short when appending at either end", () => {
    let top = orderBetween(null, null);
    let bottom = top;
    for (let i = 0; i < 20_000; i++) {
      const nextTop = orderBetween(top, null);
      const nextBottom = orderBetween(null, bottom);
      expect(nextTop > top).toBe(true);
      expect(nextBottom < bottom).toBe(true);
      top = nextTop;
      bottom = nextBottom;
    }
    expect(top.length).toBeLessThanOrEqual(5);
    expect(bottom.length).toBeLessThanOrEqual(5);
  });

  it("stays sorted under random inserts", () => {
    const random = seededRandom(42);
    const keys = [orderBetween(null, null)];
    for (let i = 0; i < 3_000; i++) {
      const at = Math.floor(random() * (keys.length + 1));
      const before = at > 0 ? keys[at - 1] : null;
      const after = at < keys.length ? keys[at] : null;
      const key = orderBetween(before, after);
      expect(isValidOrder(key)).toBe(true);
      if (before !== null) expect(key > before).toBe(true);
      if (after !== null) expect(key < after).toBe(true);
      keys.splice(at, 0, key);
    }
    expect([...keys].sort(compareOrder)).toEqual(keys);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("survives repeated inserts into the same gap", () => {
    let low = orderBetween(null, null);
    const high = orderBetween(low, null);
    for (let i = 0; i < 500; i++) {
      const key = orderBetween(low, high);
      expect(key > low && key < high).toBe(true);
      low = key;
    }
  });

  it("crosses integer boundaries in both directions", () => {
    expect(orderBetween("az", null)).toBe("b00");
    expect(orderBetween(null, "b00")).toBe("az");
    expect(orderBetween(null, "a0")).toBe("Zz");
    expect(orderBetween("Zz", null)).toBe("a0");
    expect(orderBetween("Yzz", null)).toBe("Z0");
    expect(orderBetween(null, "Z0")).toBe("Yzz");
  });

  it("rejects malformed or reversed bounds", () => {
    expect(() => orderBetween("a1", "a0")).toThrow(RangeError);
    expect(() => orderBetween("a0", "a0")).toThrow(RangeError);
    expect(() => orderBetween("!!", null)).toThrow(RangeError);
    expect(() => orderBetween("a10", null)).toThrow(RangeError);
  });

  it("generates many ascending keys at once", () => {
    const keys = ordersBetween("a0", "a1", 100);
    expect(keys).toHaveLength(100);
    expect([...keys].sort(compareOrder)).toEqual(keys);
    expect(keys[0] > "a0" && keys[99] < "a1").toBe(true);
    expect(ordersBetween(null, null, 0)).toEqual([]);
    expect(ordersBetween(null, "a0", 5).every((key) => key < "a0")).toBe(true);
  });
});

describe("isValidOrder", () => {
  it("accepts integer keys and keys with a fraction", () => {
    expect(isValidOrder("a0")).toBe(true);
    expect(isValidOrder("a0V")).toBe(true);
    expect(isValidOrder("Zz")).toBe(true);
  });

  it("rejects bad heads, short integers and trailing zeros", () => {
    expect(isValidOrder("")).toBe(false);
    expect(isValidOrder("a")).toBe(false);
    expect(isValidOrder("b0")).toBe(false);
    expect(isValidOrder("0a")).toBe(false);
    expect(isValidOrder("a0V0")).toBe(false);
    expect(isValidOrder("a0-")).toBe(false);
    expect(isValidOrder(12)).toBe(false);
  });
});

describe("repairOrders", () => {
  it("returns nothing when keys are already fine", () => {
    expect(repairOrders(stack("a", "b", "c"))).toEqual([]);
  });

  it("separates duplicates from concurrent inserts and keeps visual order", () => {
    const base = stack("a", "z");
    const between = orderBetween(base[0].order, base[1].order);
    // Two clients insert at the same spot and pick the same key.
    const left = createElement("rectangle", { id: "m1", order: between });
    const right = createElement("rectangle", { id: "m2", order: between });
    const all = [...base, left, right];
    const before = idsInOrder(all);
    const changed = repairOrders(all);
    expect(changed.map((element) => element.id)).toEqual(["m2"]);
    expect(changed[0].version).toBe(right.version + 1);
    const repaired = apply(all, changed);
    expect(idsInOrder(repaired)).toEqual(before);
    const keys = sortByOrder(repaired).map((element) => element.order);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("replaces malformed keys", () => {
    const all = [
      createElement("rectangle", { id: "a", order: "a0" }),
      createElement("rectangle", { id: "b", order: "a0V0" }),
      createElement("rectangle", { id: "c", order: "a1" }),
      createElement("rectangle", { id: "d", order: "a1" }),
    ];
    const changed = repairOrders(all);
    const repaired = apply(all, changed);
    const sorted = sortByOrder(repaired);
    expect(sorted.map((element) => element.id)).toEqual(["a", "b", "c", "d"]);
    for (const element of sorted)
      expect(isValidOrder(element.order)).toBe(true);
    for (let i = 1; i < sorted.length; i++) {
      expect(sorted[i].order > sorted[i - 1].order).toBe(true);
    }
  });

  it("repairs randomly generated collisions", () => {
    const random = seededRandom(7);
    const all: BoardElement[] = [];
    const pool = ordersBetween(null, null, 10);
    for (let i = 0; i < 200; i++) {
      all.push(
        createElement("rectangle", {
          id: `e${i}`,
          order: pool[Math.floor(random() * pool.length)],
        }),
      );
    }
    const before = idsInOrder(all);
    const repaired = apply(all, repairOrders(all));
    expect(idsInOrder(repaired)).toEqual(before);
    expect(new Set(repaired.map((element) => element.order)).size).toBe(200);
    expect(repairOrders(repaired)).toEqual([]);
  });
});

describe("layer moves", () => {
  it("brings a single element forward by one step", () => {
    const all = stack("a", "b", "c", "d");
    const changed = bringForward(all, ["b"]);
    expect(changed.map((element) => element.id)).toEqual(["b"]);
    expect(idsInOrder(apply(all, changed))).toEqual(["a", "c", "b", "d"]);
  });

  it("moves a selected block forward and backward together", () => {
    const all = stack("a", "b", "c", "d", "e");
    expect(idsInOrder(apply(all, bringForward(all, ["b", "c"])))).toEqual([
      "a",
      "d",
      "b",
      "c",
      "e",
    ]);
    expect(idsInOrder(apply(all, sendBackward(all, ["c", "d"])))).toEqual([
      "a",
      "c",
      "d",
      "b",
      "e",
    ]);
  });

  it("brings to front and sends to back", () => {
    const all = stack("a", "b", "c", "d");
    expect(idsInOrder(apply(all, bringToFront(all, ["a", "c"])))).toEqual([
      "b",
      "d",
      "a",
      "c",
    ]);
    expect(idsInOrder(apply(all, sendToBack(all, ["d", "b"])))).toEqual([
      "b",
      "d",
      "a",
      "c",
    ]);
  });

  it("changes nothing when the element is already in place", () => {
    const all = stack("a", "b", "c");
    expect(bringToFront(all, ["c"])).toEqual([]);
    expect(sendToBack(all, ["a"])).toEqual([]);
    expect(bringForward(all, ["c"])).toEqual([]);
    expect(sendBackward(all, ["a"])).toEqual([]);
    expect(bringForward(all, ["missing"])).toEqual([]);
  });

  it("re-keys the stack when existing keys collide", () => {
    const all = [
      createElement("rectangle", { id: "a", order: "a0" }),
      createElement("rectangle", { id: "b", order: "a0" }),
      createElement("rectangle", { id: "c", order: "a1" }),
    ];
    const result = apply(all, bringToFront(all, ["a"]));
    expect(idsInOrder(result)).toEqual(["b", "c", "a"]);
    expect(new Set(result.map((element) => element.order)).size).toBe(3);
  });
});
