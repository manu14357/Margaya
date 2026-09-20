import { describe, expect, it } from "vitest";
import { findOverlappingCycle } from "./overlap";

const cycles = [
  { id: "a", name: "Sprint A", startDate: "2026-03-01", endDate: "2026-03-14" },
  { id: "d", name: "Draft", startDate: null, endDate: null },
];

function overlap(
  startDate: string | null,
  endDate: string | null,
  exclude?: string,
) {
  return (
    findOverlappingCycle({ startDate, endDate }, cycles, exclude)?.name ?? null
  );
}

describe("findOverlappingCycle", () => {
  it("treats a shared boundary day as an overlap", () => {
    expect(overlap("2026-03-14", "2026-03-20")).toBe("Sprint A");
    expect(overlap("2026-02-20", "2026-03-01")).toBe("Sprint A");
  });

  it("detects containment both ways", () => {
    expect(overlap("2026-03-05", "2026-03-06")).toBe("Sprint A");
    expect(overlap("2026-02-01", "2026-04-01")).toBe("Sprint A");
  });

  it("accepts the day after the end and the day before the start", () => {
    expect(overlap("2026-03-15", "2026-03-28")).toBeNull();
    expect(overlap("2026-02-01", "2026-02-28")).toBeNull();
  });

  it("ignores drafts, undated ranges and the edited cycle", () => {
    expect(overlap(null, null)).toBeNull();
    expect(overlap("2026-03-01", "2026-03-14", "a")).toBeNull();
  });
});
