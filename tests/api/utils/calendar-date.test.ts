import { describe, expect, it } from "vitest";
import {
  daySpan,
  isValidDateString,
  listDays,
  shiftDate,
  todayUtc,
  utcDateOf,
} from "../../../apps/api/src/utils/calendar-date";

describe("todayUtc", () => {
  it("uses the UTC calendar date, not the local one", () => {
    expect(todayUtc(new Date("2026-03-01T23:59:59.999Z"))).toBe("2026-03-01");
    expect(todayUtc(new Date("2026-03-02T00:01:00Z"))).toBe("2026-03-02");
    // 23:30 in UTC-5 is already the next day in UTC.
    expect(todayUtc(new Date("2026-03-01T23:30:00-05:00"))).toBe("2026-03-02");
  });

  it("formats timestamps as their UTC date", () => {
    expect(utcDateOf(new Date("2026-12-31T23:00:00-02:00"))).toBe("2027-01-01");
  });
});

describe("isValidDateString", () => {
  it.each([
    "2026-02-28",
    "2024-02-29",
    "2000-02-29",
    "2026-12-31",
    "0001-01-01",
  ])("accepts %s", (value) => {
    expect(isValidDateString(value)).toBe(true);
  });

  it.each([
    "2026-02-29",
    "1900-02-29",
    "2026-02-30",
    "2026-04-31",
    "2026-13-01",
    "2026-00-10",
    "2026-01-00",
    "0000-01-01",
    "2026-1-01",
    "26-01-01",
    "2026-01-01T00:00:00Z",
    "2026/01/01",
    "",
  ])("rejects %s", (value) => {
    expect(isValidDateString(value)).toBe(false);
  });
});

describe("day arithmetic", () => {
  it("measures spans across month, leap-day and year boundaries", () => {
    expect(daySpan("2026-06-15", "2026-06-15")).toBe(0);
    expect(daySpan("2026-01-31", "2026-02-01")).toBe(1);
    expect(daySpan("2024-02-28", "2024-03-01")).toBe(2);
    expect(daySpan("2026-12-31", "2027-01-01")).toBe(1);
    expect(daySpan("2026-01-01", "2027-01-01")).toBe(365);
  });

  it("lists every day inclusively", () => {
    expect(listDays("2026-12-30", "2027-01-02")).toEqual([
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
      "2027-01-02",
    ]);
    expect(listDays("2024-02-28", "2024-03-01")).toEqual([
      "2024-02-28",
      "2024-02-29",
      "2024-03-01",
    ]);
    expect(listDays("2026-06-15", "2026-06-15")).toEqual(["2026-06-15"]);
  });

  it("shifts dates by whole days", () => {
    expect(shiftDate("2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftDate("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftDate("2026-06-15", 0)).toBe("2026-06-15");
  });
});
