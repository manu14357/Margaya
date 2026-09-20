import { describe, expect, it } from "vitest";
import type { CycleStatus } from "@/types/cycle";
import { searchCycles, sectionCycles } from "./order";

function cycle(
  id: string,
  status: CycleStatus,
  archivedAt: string | null = null,
) {
  return { id, name: `Sprint ${id}`, status, archivedAt };
}

describe("sectionCycles", () => {
  it("splits into active, upcoming then drafts, and completed", () => {
    const sections = sectionCycles([
      cycle("1", "current"),
      cycle("2", "upcoming"),
      cycle("3", "draft"),
      cycle("4", "upcoming"),
      cycle("5", "completed"),
      cycle("6", "completed"),
    ]);
    expect(sections.active?.id).toBe("1");
    expect(sections.upcoming.map((c) => c.id)).toEqual(["2", "4", "3"]);
    expect(sections.completed.map((c) => c.id)).toEqual(["5", "6"]);
  });

  it("has no active cycle when none is running and skips archived ones", () => {
    const sections = sectionCycles([
      cycle("1", "draft"),
      cycle("2", "completed", "2026-01-01T00:00:00.000Z"),
    ]);
    expect(sections.active).toBeNull();
    expect(sections.upcoming.map((c) => c.id)).toEqual(["1"]);
    expect(sections.completed).toEqual([]);
  });
});

describe("searchCycles", () => {
  const cycles = [
    { name: "Sprint 12" },
    { name: "Design week" },
    { name: "sprint 13" },
  ];

  it("matches names case-insensitively", () => {
    expect(searchCycles(cycles, " SPRINT ").map((c) => c.name)).toEqual([
      "Sprint 12",
      "sprint 13",
    ]);
  });

  it("keeps everything for an empty query", () => {
    expect(searchCycles(cycles, "")).toHaveLength(3);
    expect(searchCycles(cycles, undefined)).toHaveLength(3);
  });
});
