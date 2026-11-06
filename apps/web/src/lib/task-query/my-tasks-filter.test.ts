import { describe, expect, it } from "vitest";
import type { FilterCondition, FilterNode } from "./model";
import { isMyTasksFilter, toggleMyTasksFilter } from "./my-tasks-filter";

const mine: FilterCondition = {
  key: "assignee",
  operator: "in",
  values: ["me"],
};
const priority: FilterCondition = {
  key: "priority",
  operator: "in",
  values: ["high"],
};

describe("my tasks filter", () => {
  it("turns on from no filters and off back to none", () => {
    const on = toggleMyTasksFilter(null);
    expect(isMyTasksFilter(on)).toBe(true);
    expect(toggleMyTasksFilter(on)).toBeNull();
  });

  it("keeps the other filters both ways", () => {
    const filters: FilterNode = { op: "and", children: [priority] };
    const on = toggleMyTasksFilter(filters);
    expect(on).toEqual({ op: "and", children: [priority, mine] });
    expect(toggleMyTasksFilter(on)).toEqual(filters);
  });

  it("replaces another assignee filter rather than adding to it", () => {
    const filters: FilterNode = {
      op: "and",
      children: [{ key: "assignee", operator: "in", values: ["someone"] }],
    };
    expect(isMyTasksFilter(filters)).toBe(false);
    expect(toggleMyTasksFilter(filters)).toEqual({
      op: "and",
      children: [mine],
    });
  });

  it("does not count me plus others as my tasks", () => {
    const filters: FilterNode = {
      op: "and",
      children: [
        { key: "assignee", operator: "in", values: ["me", "someone"] },
      ],
    };
    expect(isMyTasksFilter(filters)).toBe(false);
  });
});
