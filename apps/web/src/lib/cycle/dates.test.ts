import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  cycleBadge,
  daysBetween,
  parseCycleDate,
  toCycleDateString,
} from "./dates";

describe("cycle dates in a negative-offset time zone", () => {
  const originalTz = process.env.TZ;

  beforeAll(() => {
    process.env.TZ = "America/Los_Angeles";
  });

  afterAll(() => {
    process.env.TZ = originalTz;
  });

  it("parses a date-only string as local midnight of that day", () => {
    const date = parseCycleDate("2026-03-01");
    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(2);
    expect(date.getDate()).toBe(1);
    expect(date.getHours()).toBe(0);
    // The trap parseCycleDate avoids: UTC midnight is the previous local day.
    expect(new Date("2026-03-01").getDate()).toBe(28);
  });

  it("round-trips picker dates through local parts", () => {
    expect(toCycleDateString(parseCycleDate("2026-12-31"))).toBe("2026-12-31");
    expect(toCycleDateString(new Date(2026, 0, 5, 23, 30))).toBe("2026-01-05");
  });
});

describe("daysBetween", () => {
  it("counts calendar days across month, year and DST boundaries", () => {
    expect(daysBetween("2026-01-30", "2026-02-02")).toBe(3);
    expect(daysBetween("2025-12-31", "2026-01-01")).toBe(1);
    expect(daysBetween("2026-03-07", "2026-03-09")).toBe(2);
    expect(daysBetween("2026-03-09", "2026-03-07")).toBe(-2);
    expect(daysBetween("2024-02-28", "2024-03-01")).toBe(2);
  });
});

describe("cycleBadge", () => {
  const today = "2026-06-10";

  it("describes drafts", () => {
    expect(
      cycleBadge({ status: "draft", startDate: null, endDate: null, today }),
    ).toEqual({ key: "cycles:badge.noDates" });
  });

  it("counts the days left of a running cycle from the server's today", () => {
    expect(
      cycleBadge({
        status: "current",
        startDate: "2026-06-01",
        endDate: "2026-06-14",
        today,
      }),
    ).toEqual({ key: "cycles:badge.daysLeft", count: 4 });
    expect(
      cycleBadge({
        status: "current",
        startDate: "2026-06-01",
        endDate: today,
        today,
      }),
    ).toEqual({ key: "cycles:badge.endsToday" });
  });

  it("counts the days until an upcoming cycle starts", () => {
    expect(
      cycleBadge({
        status: "upcoming",
        startDate: "2026-06-11",
        endDate: "2026-06-20",
        today,
      }),
    ).toEqual({ key: "cycles:badge.startsTomorrow" });
    expect(
      cycleBadge({
        status: "upcoming",
        startDate: "2026-06-15",
        endDate: "2026-06-20",
        today,
      }),
    ).toEqual({ key: "cycles:badge.startsIn", count: 5 });
  });

  it("shows when a completed cycle ended", () => {
    expect(
      cycleBadge({
        status: "completed",
        startDate: "2026-05-01",
        endDate: "2026-05-14",
        today,
      }),
    ).toEqual({ key: "cycles:badge.ended", date: "2026-05-14" });
  });
});
