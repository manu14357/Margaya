import { describe, expect, it } from "vitest";
import {
  MAX_SNOOZE_MS,
  MIN_SNOOZE_MS,
  parseSnoozeUntil,
  SNOOZE_MESSAGES,
} from "../../../apps/api/src/intake/status";

const now = new Date("2026-09-26T10:00:00.000Z");

function iso(offsetMs: number) {
  return new Date(now.getTime() + offsetMs).toISOString();
}

describe("parseSnoozeUntil", () => {
  it("accepts date-times with Z or an offset", () => {
    expect(parseSnoozeUntil("2026-09-27T00:00:00Z", now).toISOString()).toBe(
      "2026-09-27T00:00:00.000Z",
    );
    expect(
      parseSnoozeUntil("2026-09-27T00:00:00+05:30", now).toISOString(),
    ).toBe("2026-09-26T18:30:00.000Z");
    expect(parseSnoozeUntil("2026-09-27T00:00:00.123-04:00", now)).toEqual(
      new Date("2026-09-27T04:00:00.123Z"),
    );
  });

  it("rejects local times, dates and garbage", () => {
    for (const value of [
      "2026-09-27T00:00:00",
      "2026-09-27",
      "tomorrow",
      "",
      "2026-13-40T00:00:00Z",
    ]) {
      expect(() => parseSnoozeUntil(value, now), value).toThrow(
        SNOOZE_MESSAGES.invalid,
      );
    }
  });

  it("needs more than a minute from now", () => {
    expect(() => parseSnoozeUntil(iso(-60_000), now)).toThrow(
      SNOOZE_MESSAGES.past,
    );
    expect(() => parseSnoozeUntil(iso(30_000), now)).toThrow(
      SNOOZE_MESSAGES.past,
    );
    expect(() => parseSnoozeUntil(iso(MIN_SNOOZE_MS), now)).toThrow(
      SNOOZE_MESSAGES.past,
    );
    expect(parseSnoozeUntil(iso(MIN_SNOOZE_MS + 1), now).getTime()).toBe(
      now.getTime() + MIN_SNOOZE_MS + 1,
    );
  });

  it("allows at most 366 days", () => {
    expect(parseSnoozeUntil(iso(MAX_SNOOZE_MS), now).getTime()).toBe(
      now.getTime() + MAX_SNOOZE_MS,
    );
    expect(() => parseSnoozeUntil(iso(MAX_SNOOZE_MS + 1), now)).toThrow(
      SNOOZE_MESSAGES.tooFar,
    );
  });
});
