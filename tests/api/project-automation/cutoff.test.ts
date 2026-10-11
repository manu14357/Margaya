import { describe, expect, it } from "vitest";
import {
  automationCutoff,
  upcomingDateGrace,
} from "../../../apps/api/src/project-automation/cutoff";

const utc = (iso: string) => new Date(iso);

describe("automationCutoff", () => {
  it("clamps the day to the end of a shorter month", () => {
    expect(
      automationCutoff(utc("2026-05-31T10:20:30.400Z"), 3).toISOString(),
    ).toBe("2026-02-28T10:20:30.400Z");
  });

  it("lands on February 29 in a leap year", () => {
    expect(automationCutoff(utc("2028-03-31T00:00:00Z"), 1).toISOString()).toBe(
      "2028-02-29T00:00:00.000Z",
    );
  });

  it("goes back whole years across January", () => {
    expect(
      automationCutoff(utc("2026-01-15T08:00:00Z"), 12).toISOString(),
    ).toBe("2025-01-15T08:00:00.000Z");
    expect(automationCutoff(utc("2026-02-10T08:00:00Z"), 3).toISOString()).toBe(
      "2025-11-10T08:00:00.000Z",
    );
  });

  it("keeps the time of day and works in UTC whatever the local zone", () => {
    // 23:30 UTC on the 31st is already the 1st in zones east of UTC; the
    // cutoff still counts from the UTC date.
    expect(automationCutoff(utc("2026-07-31T23:30:00Z"), 1).toISOString()).toBe(
      "2026-06-30T23:30:00.000Z",
    );
  });

  it("gives upcoming dates one day of grace", () => {
    expect(upcomingDateGrace(utc("2026-03-02T12:00:00Z")).toISOString()).toBe(
      "2026-03-01T12:00:00.000Z",
    );
  });
});
