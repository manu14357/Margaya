import { describe, expect, it } from "vitest";
import {
  nextOnCompletion,
  nextScheduledRun,
  occurrenceAfter,
  type RecurrencePattern,
  scheduledTarget,
  shiftInstantByDays,
  weekdayOf,
  withinLimits,
} from "../../../apps/api/src/task-recurrence/rule";

function pattern(overrides: Partial<RecurrencePattern>): RecurrencePattern {
  return {
    frequency: "daily",
    interval: 1,
    weekdays: null,
    monthDay: null,
    anchorDate: "2026-10-20",
    endDate: null,
    maxOccurrences: null,
    occurrenceCount: 1,
    ...overrides,
  };
}

describe("occurrenceAfter", () => {
  it("steps daily by the interval from the anchor", () => {
    expect(occurrenceAfter(pattern({}), "2026-10-20")).toBe("2026-10-21");
    const everyThird = pattern({ interval: 3 });
    expect(occurrenceAfter(everyThird, "2026-10-20")).toBe("2026-10-23");
    expect(occurrenceAfter(everyThird, "2026-10-24")).toBe("2026-10-26");
  });

  it("finds the next chosen weekday", () => {
    // 2026-10-20 is a Tuesday.
    expect(weekdayOf("2026-10-20")).toBe(2);
    const monWed = pattern({ frequency: "weekly", weekdays: [1, 3] });
    expect(occurrenceAfter(monWed, "2026-10-20")).toBe("2026-10-21");
    expect(occurrenceAfter(monWed, "2026-10-21")).toBe("2026-10-26");
  });

  it("defaults a weekly repeat to the anchor's weekday", () => {
    const weekly = pattern({ frequency: "weekly" });
    expect(occurrenceAfter(weekly, "2026-10-20")).toBe("2026-10-27");
  });

  it("skips off weeks for a biweekly repeat", () => {
    const biweekly = pattern({
      frequency: "weekly",
      interval: 2,
      weekdays: [2, 4],
    });
    expect(occurrenceAfter(biweekly, "2026-10-20")).toBe("2026-10-22");
    // The week of 2026-10-25 is off; the next is the week of 2026-11-01.
    expect(occurrenceAfter(biweekly, "2026-10-22")).toBe("2026-11-03");
  });

  it("clamps a monthly day to short months and keeps the chosen day", () => {
    const monthly = pattern({
      frequency: "monthly",
      monthDay: 31,
      anchorDate: "2026-01-31",
    });
    expect(occurrenceAfter(monthly, "2026-01-31")).toBe("2026-02-28");
    // After moving to the clamped date, the 31st comes back.
    expect(
      occurrenceAfter({ ...monthly, anchorDate: "2026-02-28" }, "2026-02-28"),
    ).toBe("2026-03-31");
  });

  it("uses a monthly day later in the anchor's month", () => {
    const monthly = pattern({ frequency: "monthly", monthDay: 25 });
    expect(occurrenceAfter(monthly, "2026-10-20")).toBe("2026-10-25");
    const earlier = pattern({ frequency: "monthly", monthDay: 5 });
    expect(occurrenceAfter(earlier, "2026-10-20")).toBe("2026-11-05");
  });

  it("repeats yearly and handles leap days", () => {
    const yearly = pattern({
      frequency: "yearly",
      anchorDate: "2028-02-29",
      monthDay: 29,
    });
    expect(occurrenceAfter(yearly, "2028-02-29")).toBe("2029-02-28");
    expect(
      occurrenceAfter({ ...yearly, anchorDate: "2031-02-28" }, "2031-02-28"),
    ).toBe("2032-02-29");
  });
});

describe("limits", () => {
  it("stops at the count, the first task included", () => {
    expect(
      withinLimits(pattern({ maxOccurrences: 3, occurrenceCount: 2 }), "x"),
    ).toBe(true);
    expect(
      withinLimits(pattern({ maxOccurrences: 3, occurrenceCount: 3 }), "x"),
    ).toBe(false);
  });

  it("stops after the end date (inclusive)", () => {
    const ending = pattern({ endDate: "2026-10-21" });
    expect(nextScheduledRun(ending)).toBe("2026-10-21");
    expect(nextScheduledRun({ ...ending, anchorDate: "2026-10-21" })).toBe(
      null,
    );
  });
});

describe("nextOnCompletion", () => {
  it("never creates an instance that is overdue already", () => {
    const daily = pattern({ anchorDate: "2026-10-15" });
    expect(nextOnCompletion(daily, "2026-10-20")).toBe("2026-10-21");
  });

  it("counts from the anchor when completed early", () => {
    const weekly = pattern({ frequency: "weekly", anchorDate: "2026-10-27" });
    expect(nextOnCompletion(weekly, "2026-10-20")).toBe("2026-11-03");
  });
});

describe("scheduledTarget", () => {
  it("collapses missed runs into the latest one due", () => {
    const daily = pattern({ anchorDate: "2026-10-10" });
    expect(scheduledTarget(daily, "2026-10-11", "2026-10-20")).toBe(
      "2026-10-20",
    );
    expect(scheduledTarget(daily, "2026-10-11", "2026-10-11")).toBe(
      "2026-10-11",
    );
  });

  it("never passes the end date", () => {
    const daily = pattern({ anchorDate: "2026-10-10", endDate: "2026-10-14" });
    expect(scheduledTarget(daily, "2026-10-11", "2026-10-20")).toBe(
      "2026-10-14",
    );
  });
});

describe("shiftInstantByDays", () => {
  it("keeps local midnight across a DST change", () => {
    // 2026-03-08 is the US spring-forward day.
    const due = new Date("2026-03-07T08:00:00.000Z"); // 00:00 in Los Angeles
    const shifted = shiftInstantByDays(due, 2, "America/Los_Angeles");
    expect(shifted.toISOString()).toBe("2026-03-09T07:00:00.000Z");
  });

  it("moves by whole days in UTC", () => {
    const due = new Date("2026-10-20T15:30:00.000Z");
    expect(shiftInstantByDays(due, 7, "UTC").toISOString()).toBe(
      "2026-10-27T15:30:00.000Z",
    );
  });
});
