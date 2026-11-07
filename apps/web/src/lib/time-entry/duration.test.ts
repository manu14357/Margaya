import { describe, expect, it } from "vitest";
import {
  formatElapsed,
  fromDateTimeInput,
  MAX_LOGGED_SECONDS,
  parseDurationInput,
  splitDuration,
  toDateTimeInput,
  totalLoggedSeconds,
} from "./duration";

describe("parseDurationInput", () => {
  it.each([
    ["1h 30m", 5400],
    ["1h30m", 5400],
    ["2h", 7200],
    ["45m", 2700],
    ["1.5h", 5400],
    ["1,5h", 5400],
    ["1:30", 5400],
    ["90", 5400],
    [" 15 ", 900],
  ])("reads %s", (input, seconds) => {
    expect(parseDurationInput(input)).toBe(seconds);
  });

  it.each(["", "abc", "0", "0m", "1:75", "h", "25h"])("rejects %s", (input) => {
    expect(parseDurationInput(input)).toBeNull();
  });

  it("accepts a full day at most", () => {
    expect(parseDurationInput("24h")).toBe(MAX_LOGGED_SECONDS);
  });
});

describe("splitDuration and totalLoggedSeconds", () => {
  it("splits seconds into hours and minutes", () => {
    expect(splitDuration(5460)).toEqual({ hours: 1, minutes: 31 });
    expect(splitDuration(59)).toEqual({ hours: 0, minutes: 0 });
  });

  it("adds finished entries and skips a running one", () => {
    expect(
      totalLoggedSeconds([
        { duration: 600 },
        { duration: null },
        { duration: 1200 },
      ]),
    ).toBe(1800);
  });
});

describe("formatElapsed", () => {
  it("reads as H:MM:SS", () => {
    expect(formatElapsed(0)).toBe("0:00:00");
    expect(formatElapsed(249.9)).toBe("0:04:09");
    expect(formatElapsed(45_000)).toBe("12:30:00");
    expect(formatElapsed(360_000)).toBe("100:00:00");
  });

  it("holds at zero when the start is ahead of this device's clock", () => {
    expect(formatElapsed(-30)).toBe("0:00:00");
  });
});

describe("datetime-local values", () => {
  it("round-trip to the same minute", () => {
    const value = toDateTimeInput("2026-09-01T09:05:42.000Z");
    expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(fromDateTimeInput(value)).toBe("2026-09-01T09:05:00.000Z");
  });

  it("read an empty or broken value as null", () => {
    expect(fromDateTimeInput("")).toBeNull();
    expect(fromDateTimeInput("not a date")).toBeNull();
  });
});
