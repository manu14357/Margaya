import { describe, expect, it } from "vitest";
import {
  convertLegacyBoardFilters,
  convertLegacyLabels,
  convertLegacySort,
  legacyFiltersNeedLabels,
} from "./legacy-board-filters";

const labels = [
  { id: "ws-bug", name: "Bug", taskId: null },
  { id: "copy-bug", name: "Bug", taskId: "task-1" },
  { id: "copy-orphan", name: "Orphan", taskId: "task-2" },
];

describe("legacy board filters", () => {
  it("converts every legacy key into one root and-group", () => {
    const tree = convertLegacyBoardFilters(
      {
        status: ["to-do", "done"],
        priority: ["high"],
        assignee: ["user-1", "none"],
        dueDate: ["dueThisWeek", "noDueDate", "bogus"],
        labels: ["copy-bug"],
        customFields: { f1: ["a", "b"], f2: [] },
        cycle: ["c1", "none"],
        module: ["m1"],
        estimate: ["p1"],
      },
      labels,
    );
    expect(tree).toEqual({
      op: "and",
      children: [
        { key: "status", operator: "in", values: ["to-do", "done"] },
        { key: "priority", operator: "in", values: ["high"] },
        { key: "assignee", operator: "in", values: ["user-1", "none"] },
        { key: "dueDate", operator: "in", values: ["thisWeek", "none"] },
        { key: "label", operator: "in", values: ["ws-bug"] },
        {
          key: "customField",
          operator: "in",
          values: ["a", "b"],
          fieldId: "f1",
        },
        { key: "cycle", operator: "in", values: ["c1", "none"] },
        { key: "module", operator: "in", values: ["m1"] },
        { key: "estimate", operator: "in", values: ["p1"] },
      ],
    });
  });

  it("maps label row ids to the workspace label or a name literal", () => {
    expect(convertLegacyLabels(["copy-bug", "ws-bug"], labels)).toEqual([
      "ws-bug",
    ]);
    expect(convertLegacyLabels(["copy-orphan", "gone"], labels)).toEqual([
      "name:Orphan",
    ]);
  });

  it("drops corrupt storage", () => {
    expect(convertLegacyBoardFilters(null)).toBe(null);
    expect(convertLegacyBoardFilters("nope")).toBe(null);
    expect(convertLegacyBoardFilters(["status"])).toBe(null);
    expect(
      convertLegacyBoardFilters({ status: "done", priority: [1, 2] }),
    ).toBe(null);
  });

  it("says when label rows must load first", () => {
    expect(legacyFiltersNeedLabels({ labels: ["x"] })).toBe(true);
    expect(legacyFiltersNeedLabels({ labels: [] })).toBe(false);
    expect(legacyFiltersNeedLabels(null)).toBe(false);
  });

  it("converts the stored sort, position becoming manual", () => {
    expect(convertLegacySort({ field: "position", direction: "desc" })).toEqual(
      {
        field: "manual",
        direction: "asc",
      },
    );
    expect(convertLegacySort({ field: "priority", direction: "desc" })).toEqual(
      {
        field: "priority",
        direction: "desc",
      },
    );
    expect(convertLegacySort({ field: "bogus", direction: "asc" })).toBe(null);
    expect(convertLegacySort(undefined)).toBe(null);
  });
});
