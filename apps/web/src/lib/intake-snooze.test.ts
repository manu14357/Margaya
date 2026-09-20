import { describe, expect, it } from "vitest";
import {
  intakeSnoozeBounds,
  intakeSnoozePresetDay,
  snoozeInstant,
  startOfLocalDay,
} from "./intake-snooze";

function day(value: Date) {
  return [value.getFullYear(), value.getMonth() + 1, value.getDate()].join("-");
}

// 2026-09-30 is a Wednesday; 2026-10-04 is a Sunday.
const WEDNESDAY = new Date(2026, 8, 30, 15, 45);
const SUNDAY = new Date(2026, 9, 4, 9, 0);

describe("intakeSnoozePresetDay", () => {
  it("counts days from today", () => {
    expect(day(intakeSnoozePresetDay("tomorrow", WEDNESDAY, 0))).toBe(
      "2026-10-1",
    );
    expect(day(intakeSnoozePresetDay("in3Days", WEDNESDAY, 0))).toBe(
      "2026-10-3",
    );
    expect(day(intakeSnoozePresetDay("in2Weeks", WEDNESDAY, 0))).toBe(
      "2026-10-14",
    );
  });

  it("lands next week on the next first day of the week", () => {
    // Weeks starting Sunday, and Monday.
    expect(day(intakeSnoozePresetDay("nextWeek", WEDNESDAY, 0))).toBe(
      "2026-10-4",
    );
    expect(day(intakeSnoozePresetDay("nextWeek", WEDNESDAY, 1))).toBe(
      "2026-10-5",
    );
  });

  it("never picks today for next week", () => {
    expect(day(intakeSnoozePresetDay("nextWeek", SUNDAY, 0))).toBe(
      "2026-10-11",
    );
    expect(day(intakeSnoozePresetDay("nextWeek", SUNDAY, 1))).toBe("2026-10-5");
  });

  it("returns local midnight", () => {
    const target = intakeSnoozePresetDay("tomorrow", WEDNESDAY, 0);
    expect([target.getHours(), target.getMinutes()]).toEqual([0, 0]);
  });
});

describe("snoozeInstant", () => {
  it("sends the start of the local day as an ISO instant", () => {
    const value = new Date(2026, 9, 5, 18, 30);
    const instant = snoozeInstant(value);
    expect(instant.endsWith("Z")).toBe(true);
    expect(new Date(instant).getTime()).toBe(startOfLocalDay(value).getTime());
  });
});

describe("intakeSnoozeBounds", () => {
  it("offers tomorrow up to a year from today", () => {
    const { min, max } = intakeSnoozeBounds(WEDNESDAY);
    expect(day(min)).toBe("2026-10-1");
    expect(day(max)).toBe("2027-9-30");
  });
});
