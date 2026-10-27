import { afterEach, describe, expect, it } from "vitest";
import {
  CYCLE_FILTER_STORAGE_PREFIX,
  filterCycleRows,
  loadCycleFilter,
  saveCycleFilter,
} from "./cycle-filter";

afterEach(() => window.localStorage.clear());

const rows = [
  { id: "a", status: "current" as const },
  { id: "b", status: "upcoming" as const },
  { id: "c", status: "current" as const },
  { id: "d", status: "completed" as const },
];

describe("filterCycleRows", () => {
  it("keeps only current cycles when running", () => {
    expect(filterCycleRows(rows, "running").map((row) => row.id)).toEqual([
      "a",
      "c",
    ]);
  });

  it("keeps every cycle otherwise", () => {
    expect(filterCycleRows(rows, "all")).toHaveLength(4);
  });
});

describe("cycle filter storage", () => {
  it("remembers the choice per scope", () => {
    saveCycleFilter("p1,p2", "running");
    expect(loadCycleFilter("p1,p2")).toBe("running");
    expect(loadCycleFilter("all")).toBe("all");
  });

  it("falls back to all for unknown values", () => {
    window.localStorage.setItem(`${CYCLE_FILTER_STORAGE_PREFIX}all`, "nope");
    expect(loadCycleFilter("all")).toBe("all");
  });
});
