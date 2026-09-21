import { afterEach, describe, expect, it } from "vitest";
import {
  dayIndexAtPointer,
  rescheduleTaskDates,
  scheduleFromDay,
  shiftTaskDates,
  toTaskDateValue,
} from "./schedule-dates";
import { parseTaskDate } from "./task-schedule";

function localDay(value: string | null) {
  const parsed = parseTaskDate(value);
  if (!parsed) return null;
  return [
    parsed.getFullYear(),
    parsed.getMonth() + 1,
    parsed.getDate(),
    parsed.getHours(),
  ];
}

describe("shiftTaskDates", () => {
  it("moves a due-only task and leaves the missing start alone", () => {
    const next = shiftTaskDates(
      { startDate: null, dueDate: toTaskDateValue(new Date(2026, 9, 14)) },
      3,
    );
    expect(next.startDate).toBeNull();
    expect(localDay(next.dueDate)).toEqual([2026, 10, 17, 0]);
  });

  it("moves both dates and keeps the span", () => {
    const next = shiftTaskDates(
      {
        startDate: toTaskDateValue(new Date(2026, 9, 12)),
        dueDate: toTaskDateValue(new Date(2026, 9, 16)),
      },
      -5,
    );
    expect(localDay(next.startDate)).toEqual([2026, 10, 7, 0]);
    expect(localDay(next.dueDate)).toEqual([2026, 10, 11, 0]);
  });

  it("reads plain date strings as local days", () => {
    const next = shiftTaskDates(
      { startDate: "2026-02-27", dueDate: "2026-03-01" },
      1,
    );
    expect(localDay(next.startDate)).toEqual([2026, 2, 28, 0]);
    expect(localDay(next.dueDate)).toEqual([2026, 3, 2, 0]);
  });
});

describe("rescheduleTaskDates", () => {
  it("puts a one-day task's due date on the drop day", () => {
    const due = new Date(2026, 9, 14);
    const next = rescheduleTaskDates(
      { startDate: null, dueDate: toTaskDateValue(due) },
      due,
      new Date(2026, 9, 20),
    );
    expect(localDay(next.dueDate)).toEqual([2026, 10, 20, 0]);
  });

  it("keeps the grabbed day of a multi-day task under the pointer", () => {
    const next = rescheduleTaskDates(
      {
        startDate: toTaskDateValue(new Date(2026, 9, 12)),
        dueDate: toTaskDateValue(new Date(2026, 9, 15)),
      },
      new Date(2026, 9, 13),
      new Date(2026, 9, 14),
    );
    expect(localDay(next.startDate)).toEqual([2026, 10, 13, 0]);
    expect(localDay(next.dueDate)).toEqual([2026, 10, 16, 0]);
  });
});

describe("timezones", () => {
  const originalTz = process.env.TZ;
  afterEach(() => {
    process.env.TZ = originalTz;
  });

  it.each(["Pacific/Kiritimati", "America/Los_Angeles", "Asia/Kolkata", "UTC"])(
    "keeps whole local days across a daylight-saving change in %s",
    (zone) => {
      process.env.TZ = zone;
      // Spans the US (March 8) and EU (March 29) clock changes.
      const next = shiftTaskDates(
        {
          startDate: toTaskDateValue(new Date(2026, 2, 1)),
          dueDate: toTaskDateValue(new Date(2026, 2, 4)),
        },
        30,
      );
      expect(localDay(next.startDate)).toEqual([2026, 3, 31, 0]);
      expect(localDay(next.dueDate)).toEqual([2026, 4, 3, 0]);
    },
  );
});

describe("scheduleFromDay", () => {
  it("gives an undated task a one-week span by default", () => {
    const dates = scheduleFromDay(new Date(2026, 9, 14, 15, 30));
    expect(localDay(dates.startDate)).toEqual([2026, 10, 14, 0]);
    expect(localDay(dates.dueDate)).toEqual([2026, 10, 20, 0]);
  });

  it("never makes a span shorter than one day", () => {
    const dates = scheduleFromDay(new Date(2026, 9, 14), 0);
    expect(dates.startDate).toBe(dates.dueDate);
  });
});

describe("dayIndexAtPointer", () => {
  it("maps a pointer to its column and clamps to the strip", () => {
    expect(dayIndexAtPointer(105, 100, 700, 7)).toBe(0);
    expect(dayIndexAtPointer(399, 100, 700, 7)).toBe(2);
    expect(dayIndexAtPointer(50, 100, 700, 7)).toBe(0);
    expect(dayIndexAtPointer(2000, 100, 700, 7)).toBe(6);
    expect(dayIndexAtPointer(10, 0, 0, 7)).toBe(0);
  });
});
