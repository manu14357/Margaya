import { describe, expect, it } from "vitest";
import {
  MAX_LOGGED_SECONDS,
  parseDurationInput,
  splitDuration,
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
