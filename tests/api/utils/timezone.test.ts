import { describe, expect, it, vi } from "vitest";

vi.mock("../../../apps/api/src/database", () => ({
  default: {},
  schema: {},
}));

import {
  isValidTimezone,
  localDateString,
  normalizeTimezone,
  resolveTimezone,
  startOfLocalDayUtc,
  startOfNextLocalDayUtc,
  todayInTimezone,
} from "../../../apps/api/src/utils/timezone";

describe("isValidTimezone", () => {
  it("accepts named IANA zones and UTC", () => {
    for (const tz of [
      "UTC",
      "Europe/Berlin",
      "America/New_York",
      "Asia/Kolkata",
    ]) {
      expect(isValidTimezone(tz)).toBe(true);
    }
  });

  it("rejects unknown names, raw offsets and empty values", () => {
    for (const tz of ["", "Mars/Olympus", "+05:30", "-08:00", "x".repeat(65)]) {
      expect(isValidTimezone(tz)).toBe(false);
    }
  });

  it("normalises spelling and falls back to UTC", () => {
    expect(normalizeTimezone("utc")).toBe("UTC");
    expect(normalizeTimezone("europe/berlin")).toBe("Europe/Berlin");
    expect(resolveTimezone(null)).toBe("UTC");
    expect(resolveTimezone("Nope/Nowhere")).toBe("UTC");
    expect(resolveTimezone("Asia/Tokyo")).toBe("Asia/Tokyo");
  });
});

describe("localDateString", () => {
  const instant = new Date("2026-03-10T23:30:00Z");

  it("matches the UTC calendar date in UTC", () => {
    expect(localDateString(instant, "UTC")).toBe("2026-03-10");
    expect(todayInTimezone("UTC", instant)).toBe("2026-03-10");
  });

  it("rolls forward east of UTC and stays put west of it", () => {
    expect(localDateString(instant, "Asia/Tokyo")).toBe("2026-03-11");
    expect(localDateString(instant, "America/Los_Angeles")).toBe("2026-03-10");
    expect(
      localDateString(new Date("2026-03-11T02:00:00Z"), "America/Los_Angeles"),
    ).toBe("2026-03-10");
  });

  it("handles half-hour zones and pads early years", () => {
    expect(
      localDateString(new Date("2026-01-01T18:29:00Z"), "Asia/Kolkata"),
    ).toBe("2026-01-01");
    expect(
      localDateString(new Date("2026-01-01T18:30:00Z"), "Asia/Kolkata"),
    ).toBe("2026-01-02");
    const early = new Date(0);
    early.setUTCFullYear(5, 0, 2);
    expect(localDateString(early, "UTC")).toBe("0005-01-02");
  });
});

describe("startOfLocalDayUtc", () => {
  it("is plain midnight in UTC", () => {
    expect(startOfLocalDayUtc("2026-06-01", "UTC").toISOString()).toBe(
      "2026-06-01T00:00:00.000Z",
    );
  });

  it("uses the offset in force on that day", () => {
    expect(
      startOfLocalDayUtc("2026-01-15", "Europe/Berlin").toISOString(),
    ).toBe("2026-01-14T23:00:00.000Z");
    expect(
      startOfLocalDayUtc("2026-07-15", "Europe/Berlin").toISOString(),
    ).toBe("2026-07-14T22:00:00.000Z");
    expect(startOfLocalDayUtc("2026-07-15", "Asia/Kolkata").toISOString()).toBe(
      "2026-07-14T18:30:00.000Z",
    );
  });

  it("handles the spring-forward and fall-back days", () => {
    // US DST: 2026-03-08 springs forward, 2026-11-01 falls back.
    expect(
      startOfLocalDayUtc("2026-03-08", "America/New_York").toISOString(),
    ).toBe("2026-03-08T05:00:00.000Z");
    expect(
      startOfLocalDayUtc("2026-03-09", "America/New_York").toISOString(),
    ).toBe("2026-03-09T04:00:00.000Z");
    expect(
      startOfLocalDayUtc("2026-11-01", "America/New_York").toISOString(),
    ).toBe("2026-11-01T04:00:00.000Z");
    expect(
      startOfLocalDayUtc("2026-11-02", "America/New_York").toISOString(),
    ).toBe("2026-11-02T05:00:00.000Z");
  });

  it("starts at the first instant of the day when DST skips midnight", () => {
    // Chile sprang forward at local midnight on 2022-09-11 (00:00 → 01:00).
    const start = startOfLocalDayUtc("2022-09-11", "America/Santiago");
    expect(start.toISOString()).toBe("2022-09-11T04:00:00.000Z");
    expect(localDateString(start, "America/Santiago")).toBe("2022-09-11");
    expect(
      localDateString(new Date(start.getTime() - 1000), "America/Santiago"),
    ).toBe("2022-09-10");
  });

  it("picks local midnight on a day that repeats an hour before midnight", () => {
    // Chile fell back at local midnight on 2022-04-03 (00:00 → 23:00).
    const start = startOfLocalDayUtc("2022-04-03", "America/Santiago");
    expect(localDateString(start, "America/Santiago")).toBe("2022-04-03");
    expect(
      localDateString(new Date(start.getTime() - 1000), "America/Santiago"),
    ).toBe("2022-04-02");
  });

  it("measures 23- and 25-hour days through the next-day helper", () => {
    const hours = (date: string, tz: string) =>
      (startOfNextLocalDayUtc(date, tz).getTime() -
        startOfLocalDayUtc(date, tz).getTime()) /
      3_600_000;
    expect(hours("2026-03-08", "America/New_York")).toBe(23);
    expect(hours("2026-11-01", "America/New_York")).toBe(25);
    expect(hours("2026-06-01", "UTC")).toBe(24);
  });

  it("rejects malformed dates", () => {
    expect(() => startOfLocalDayUtc("2026-6-1", "UTC")).toThrow();
  });
});
