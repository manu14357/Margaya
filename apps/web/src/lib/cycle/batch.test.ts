import { describe, expect, it } from "vitest";
import {
  changedTaskIds,
  chunkIds,
  groupTaskIdsByCycle,
  mergeTaskChanges,
} from "./batch";

describe("cycle batching", () => {
  it("splits unique ids into batches of 200", () => {
    const ids = Array.from({ length: 450 }, (_, index) => `t${index}`);
    const chunks = chunkIds([...ids, "t0"]);
    expect(chunks.map((chunk) => chunk.length)).toEqual([200, 200, 50]);
    expect(chunkIds([])).toEqual([]);
  });

  it("groups selected tasks by their current cycle", () => {
    const cycles: Record<string, string | null> = {
      a: "c1",
      b: "c2",
      c: "c1",
      d: null,
    };
    const groups = groupTaskIdsByCycle(
      ["a", "b", "c", "d", "a"],
      (id) => cycles[id],
    );
    expect([...groups.entries()]).toEqual([
      ["c1", ["a", "c"]],
      ["c2", ["b"]],
    ]);
  });

  it("merges batch results and lists changed tasks", () => {
    const merged = mergeTaskChanges([
      { added: ["a"], moved: [], removed: [], unchanged: ["x"], ignored: [] },
      {
        added: [],
        moved: [{ taskId: "b", fromCycleId: "c2" }],
        removed: ["c"],
        unchanged: [],
        ignored: ["y"],
      },
    ]);
    expect(changedTaskIds(merged)).toEqual(["a", "b", "c"]);
    expect(merged.ignored).toEqual(["y"]);
  });
});
