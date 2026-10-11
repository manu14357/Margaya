import { describe, expect, it } from "vitest";
import {
  deriveCycleStatus,
  rangesOverlap,
} from "../../../apps/api/src/cycle/dates";

describe("deriveCycleStatus", () => {
  const today = "2026-06-15";

  it.each([
    [{ startDate: null, endDate: null }, "draft"],
    [{ startDate: "2026-06-01", endDate: null }, "draft"],
    [{ startDate: "2026-05-01", endDate: "2026-06-14" }, "completed"],
    [{ startDate: "2026-06-16", endDate: "2026-06-30" }, "upcoming"],
    [{ startDate: "2026-06-01", endDate: "2026-06-30" }, "current"],
    [{ startDate: "2026-06-15", endDate: "2026-06-15" }, "current"],
    [{ startDate: "2026-06-15", endDate: "2026-06-20" }, "current"],
    [{ startDate: "2026-06-10", endDate: "2026-06-15" }, "current"],
  ] as const)("%j is %s", (cycle, status) => {
    expect(deriveCycleStatus(cycle, today)).toBe(status);
  });
});

describe("rangesOverlap", () => {
  const a = { startDate: "2026-06-01", endDate: "2026-06-14" };

  it("treats shared boundary days as overlap", () => {
    expect(
      rangesOverlap(a, { startDate: "2026-06-14", endDate: "2026-06-20" }),
    ).toBe(true);
    expect(
      rangesOverlap(a, { startDate: "2026-05-20", endDate: "2026-06-01" }),
    ).toBe(true);
  });

  it("detects containment both ways", () => {
    expect(
      rangesOverlap(a, { startDate: "2026-06-05", endDate: "2026-06-06" }),
    ).toBe(true);
    expect(
      rangesOverlap(a, { startDate: "2026-05-01", endDate: "2026-07-01" }),
    ).toBe(true);
  });

  it("lets adjacent and disjoint ranges pass", () => {
    expect(
      rangesOverlap(a, { startDate: "2026-06-15", endDate: "2026-06-20" }),
    ).toBe(false);
    expect(
      rangesOverlap(a, { startDate: "2026-05-01", endDate: "2026-05-31" }),
    ).toBe(false);
  });
});
