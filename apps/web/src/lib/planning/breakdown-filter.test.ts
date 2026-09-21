import { describe, expect, it } from "vitest";
import type { BoardFilters } from "@/lib/task-query/planning-filters";
import {
  groupStatusValues,
  isBreakdownFilterActive,
  nextBreakdownFilter,
} from "./breakdown-filter";

const columns = [
  { slug: "planned", group: "backlog" },
  { slug: "ideas", group: "backlog" },
  { slug: "to-do", group: "unstarted" },
  { slug: "doing", group: "started" },
  { slug: "review", group: "started" },
  { slug: "done", group: "completed", isFinal: true },
];

const empty: BoardFilters = {
  status: null,
  priority: null,
  assignee: null,
  dueDate: null,
  labels: null,
  customFields: null,
};

describe("breakdown filters", () => {
  it("maps a group to its column slugs, planned included for backlog", () => {
    expect(groupStatusValues(columns, "started")).toEqual(["doing", "review"]);
    expect(groupStatusValues(columns, "backlog")).toEqual(["ideas", "planned"]);
    expect(groupStatusValues(columns, "cancelled")).toEqual([]);
  });

  it("sets the filter, then clears it on a second click", () => {
    const values = ["doing", "review"];
    const set = nextBreakdownFilter(empty, "status", values);
    expect(set).toEqual(values);
    const filters = { ...empty, status: ["review", "doing"] };
    expect(isBreakdownFilterActive(filters, "status", values)).toBe(true);
    expect(nextBreakdownFilter(filters, "status", values)).toBeNull();
  });

  it("is not active for a partial or empty match", () => {
    const filters = { ...empty, priority: ["high", "urgent"] };
    expect(isBreakdownFilterActive(filters, "priority", ["high"])).toBe(false);
    expect(isBreakdownFilterActive(empty, "priority", [])).toBe(false);
  });
});
