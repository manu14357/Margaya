import { describe, expect, it } from "vitest";
import { findRootCondition } from "./filter-tree";
import { labelValues } from "./labels";
import {
  applyBoardFilter,
  boardFiltersFromTree,
  toggleLabelFilter,
} from "./planning-filters";

describe("planning breakdown filters", () => {
  it("reads and writes the breakdown subjects on the tree", () => {
    let root = applyBoardFilter(null, "status", ["to-do", "planned"]);
    root = applyBoardFilter(root, "assignee", ["u1"]);
    root = toggleLabelFilter(root, "l-bug");
    const filters = boardFiltersFromTree(root);
    expect(filters.status).toEqual(["to-do", "planned"]);
    expect(filters.assignee).toEqual(["u1"]);
    expect(filters.labels).toEqual(["l-bug"]);
    expect(filters.priority).toBe(null);

    root = applyBoardFilter(root, "status", null);
    expect(findRootCondition(root, "status")).toBeUndefined();
    // Other keys are not breakdown subjects.
    expect(applyBoardFilter(root, "dueDate", ["dueThisWeek"])).toBe(root);
  });

  it("offers one label value per name", () => {
    expect(
      labelValues([
        { id: "copy", name: "Bug", color: "red", taskId: "t1" },
        { id: "ws", name: "Bug", color: "red", taskId: null },
        { id: "only-copy", name: "api", color: "blue", taskId: "t2" },
      ]),
    ).toEqual([
      { value: "name:api", name: "api", color: "blue" },
      { value: "ws", name: "Bug", color: "red" },
    ]);
  });
});
