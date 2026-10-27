import { describe, expect, it } from "vitest";
import {
  blockedChains,
  longestPath,
  topoOrder,
} from "../../../apps/api/src/delivery/risk-graph";

const e = (from: string, to: string) => ({ from, to });

describe("topoOrder", () => {
  it("orders a DAG with stable tie-breaks", () => {
    const { order, loopNodeIds } = topoOrder(
      ["c", "a", "b", "d"],
      [e("a", "c"), e("b", "c"), e("c", "d")],
    );
    expect(order).toEqual(["a", "b", "c", "d"]);
    expect(loopNodeIds).toEqual([]);
  });

  it("reports loop nodes and what hangs behind them", () => {
    const { order, loopNodeIds } = topoOrder(
      ["a", "b", "c", "x"],
      [e("a", "b"), e("b", "a"), e("b", "c")],
    );
    expect(order).toEqual(["x"]);
    expect(loopNodeIds).toEqual(["a", "b", "c"]);
  });

  it("ignores self edges, duplicates and unknown nodes", () => {
    const { order } = topoOrder(
      ["a", "b"],
      [e("a", "a"), e("a", "b"), e("a", "b"), e("z", "a")],
    );
    expect(order).toEqual(["a", "b"]);
  });
});

describe("longestPath", () => {
  it("follows the heaviest chain", () => {
    const edges = [e("a", "b"), e("b", "d"), e("a", "c"), e("c", "d")];
    const weights: Record<string, number> = { a: 1, b: 5, c: 2, d: 1 };
    const { order } = topoOrder(["a", "b", "c", "d"], edges);
    expect(longestPath(order, edges, (id) => weights[id] ?? 0)).toEqual({
      taskIds: ["a", "b", "d"],
      total: 7,
    });
  });

  it("breaks ties by task id", () => {
    const edges = [e("a", "c"), e("b", "c")];
    const { order } = topoOrder(["a", "b", "c"], edges);
    expect(longestPath(order, edges, () => 1).taskIds).toEqual(["a", "c"]);
  });

  it("is empty without nodes", () => {
    expect(longestPath([], [], () => 1)).toEqual({ taskIds: [], total: 0 });
  });
});

describe("blockedChains", () => {
  it("collects what each root blocker holds up, with depth", () => {
    const chains = blockedChains(
      ["h", "a", "b", "c", "x", "y"],
      [e("h", "a"), e("a", "b"), e("h", "c"), e("x", "y")],
    );
    expect(chains).toEqual([
      { headId: "h", blockedIds: ["a", "c", "b"], depth: 2 },
      { headId: "x", blockedIds: ["y"], depth: 1 },
    ]);
  });

  it("survives loops below a root", () => {
    const chains = blockedChains(
      ["r", "a", "b"],
      [e("r", "a"), e("a", "b"), e("b", "a")],
    );
    expect(chains).toHaveLength(1);
    expect(chains[0]?.headId).toBe("r");
    expect(new Set(chains[0]?.blockedIds)).toEqual(new Set(["a", "b"]));
  });
});
