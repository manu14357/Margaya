import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  combineDateAndSlot,
  defaultSlot,
  formatSnoozeTarget,
  presetTarget,
  SNOOZE_PRESETS,
  SNOOZE_SLOTS,
  slotsAllowedFor,
} from "./snooze-presets";

const originalTz = process.env.TZ;

beforeAll(() => {
  // A fixed zone with a daylight-saving change, so local-time math is
  // checked against known instants.
  process.env.TZ = "America/New_York";
});

afterAll(() => {
  process.env.TZ = originalTz;
});

describe("snooze presets", () => {
  it("adds exact durations to now", () => {
    const now = new Date("2026-09-26T13:40:00.000Z");
    const hours = SNOOZE_PRESETS.map(
      (preset) =>
        (presetTarget(preset, now).getTime() - now.getTime()) / 3_600_000,
    );
    expect(hours).toEqual([24, 72, 120, 168, 336]);
  });

  it("lists 48 half-hour slots", () => {
    expect(SNOOZE_SLOTS).toHaveLength(48);
    expect(SNOOZE_SLOTS[0]).toBe("00:00");
    expect(SNOOZE_SLOTS[19]).toBe("09:30");
    expect(SNOOZE_SLOTS[47]).toBe("23:30");
  });
});

describe("custom snooze time", () => {
  it("reads the date and slot in the local zone, across a DST change", () => {
    // US daylight-saving time started on 2026-03-08.
    expect(
      combineDateAndSlot(new Date(2026, 2, 7), "09:00").toISOString(),
    ).toBe("2026-03-07T14:00:00.000Z");
    expect(
      combineDateAndSlot(new Date(2026, 2, 9), "09:00").toISOString(),
    ).toBe("2026-03-09T13:00:00.000Z");
  });

  it("drops slots earlier than a minute from now on today", () => {
    const now = new Date(2026, 8, 26, 15, 29, 30);
    const today = new Date(2026, 8, 26);
    const allowed = slotsAllowedFor(today, now);
    expect(allowed[0]).toBe("16:00");
    expect(allowed).not.toContain("15:30");
    expect(slotsAllowedFor(new Date(2026, 8, 27), now)).toHaveLength(48);
    expect(slotsAllowedFor(new Date(2026, 8, 25), now)).toHaveLength(0);
  });

  it("defaults to 09:00, or the next half hour later today", () => {
    const morning = new Date(2026, 8, 26, 7, 0);
    const afternoon = new Date(2026, 8, 26, 15, 10);
    const today = new Date(2026, 8, 26);
    const tomorrow = new Date(2026, 8, 27);
    expect(defaultSlot(today, morning)).toBe("09:00");
    expect(defaultSlot(tomorrow, afternoon)).toBe("09:00");
    expect(defaultSlot(today, afternoon)).toBe("15:30");
    expect(defaultSlot(today, new Date(2026, 8, 26, 23, 45))).toBeNull();
  });

  it("formats a target with weekday, date and time", () => {
    expect(formatSnoozeTarget(new Date(2026, 8, 26, 15, 40), "en-US")).toBe(
      "Sat, Sep 26, 3:40 PM",
    );
  });
});
