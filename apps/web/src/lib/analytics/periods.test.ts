import { describe, expect, it } from "vitest";
import {
  clampRange,
  defaultBucket,
  effectiveBucket,
  presetRange,
  spanDays,
  weekAllowed,
} from "./periods";

describe("presetRange", () => {
  it("counts presets back from today, both ends included", () => {
    expect(presetRange("last30", "2026-03-31")).toEqual({
      from: "2026-03-02",
      to: "2026-03-31",
    });
    expect(presetRange("last90", "2026-03-31")).toEqual({
      from: "2026-01-01",
      to: "2026-03-31",
    });
    expect(presetRange("last6m", "2026-03-31")).toEqual({
      from: "2025-10-01",
      to: "2026-03-31",
    });
    expect(presetRange("last12m", "2026-02-28")).toEqual({
      from: "2025-03-01",
      to: "2026-02-28",
    });
  });

  it("gives custom the default 90 days until a range is picked", () => {
    expect(presetRange("custom", "2026-03-31")).toEqual(
      presetRange("last90", "2026-03-31"),
    );
  });

  it("spans exactly the preset's days", () => {
    expect(spanDays(presetRange("last30", "2026-03-31"))).toBe(30);
    expect(spanDays(presetRange("last90", "2026-03-31"))).toBe(90);
  });
});

describe("buckets", () => {
  it("defaults to weeks up to 90 days, months beyond", () => {
    expect(defaultBucket(presetRange("last90", "2026-03-31"))).toBe("week");
    expect(defaultBucket(presetRange("last6m", "2026-03-31"))).toBe("month");
  });

  it("disables weeks for ranges over two years", () => {
    expect(weekAllowed({ from: "2024-04-01", to: "2026-03-31" })).toBe(true);
    expect(weekAllowed({ from: "2023-03-31", to: "2026-03-31" })).toBe(false);
    expect(
      effectiveBucket({ from: "2023-03-31", to: "2026-03-31" }, "week"),
    ).toBe("month");
  });

  it("keeps a chosen bucket when it is allowed", () => {
    expect(effectiveBucket(presetRange("last6m", "2026-03-31"), "week")).toBe(
      "week",
    );
  });
});

describe("clampRange", () => {
  it("orders reversed picks", () => {
    expect(clampRange({ from: "2026-03-10", to: "2026-03-01" })).toEqual({
      from: "2026-03-01",
      to: "2026-03-10",
    });
  });

  it("keeps ranges within five years and 60 months", () => {
    const clamped = clampRange({ from: "2015-01-01", to: "2026-03-31" });
    expect(clamped.to).toBe("2026-03-31");
    expect(clamped.from).toBe("2021-04-01");
    expect(spanDays(clamped)).toBeLessThanOrEqual(1830);
  });
});
