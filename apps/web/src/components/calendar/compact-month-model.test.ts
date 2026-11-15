import { describe, expect, it } from "vitest";
import {
  effectiveSelectedDay,
  groupTasksByDay,
  parseDayKey,
  toDayKey,
} from "./compact-month-model";
import { buildMonthWeeks, buildWeekDays } from "./month-grid-model";

const task = (id: string, title: string, start: Date, end = start) => ({
  id,
  title,
  scheduleStart: start,
  scheduleEnd: end,
});

describe("groupTasksByDay", () => {
  it("lists a task on every day it spans, open work first", () => {
    const days = [new Date(2026, 10, 19), new Date(2026, 10, 20)];
    const byDay = groupTasksByDay(
      days,
      [
        task("done", "Done one", new Date(2026, 10, 19)),
        task(
          "span",
          "Spanning",
          new Date(2026, 10, 18),
          new Date(2026, 10, 20),
        ),
        task("open", "Open one", new Date(2026, 10, 19)),
      ],
      (entry) => entry.id === "done",
    );

    expect(byDay.get("2026-11-19")?.map((entry) => entry.id)).toEqual([
      "span",
      "open",
      "done",
    ]);
    expect(byDay.get("2026-11-20")?.map((entry) => entry.id)).toEqual(["span"]);
  });

  it("gives every day an entry, empty when nothing is on it", () => {
    const byDay = groupTasksByDay([new Date(2026, 10, 21)], []);
    expect(byDay.get("2026-11-21")).toEqual([]);
  });
});

describe("day keys", () => {
  it("round-trips a local day and rejects anything else", () => {
    const day = new Date(2026, 10, 20);
    expect(toDayKey(day)).toBe("2026-11-20");
    expect(parseDayKey("2026-11-20")?.getTime()).toBe(day.getTime());
    expect(parseDayKey("2026-13-40")).toBeNull();
    expect(parseDayKey("tomorrow")).toBeNull();
    expect(parseDayKey(undefined)).toBeNull();
  });
});

describe("effectiveSelectedDay", () => {
  const month = new Date(2026, 10, 1);
  const days = buildMonthWeeks(month, 1).flat();

  it("keeps a chosen day that is on screen", () => {
    const chosen = new Date(2026, 10, 20);
    expect(
      toDayKey(
        effectiveSelectedDay(chosen, days, month, new Date(2026, 10, 3)),
      ),
    ).toBe("2026-11-20");
  });

  it("falls back to today in the current month, else the 1st", () => {
    expect(
      toDayKey(effectiveSelectedDay(null, days, month, new Date(2026, 10, 15))),
    ).toBe("2026-11-15");
    expect(
      toDayKey(
        effectiveSelectedDay(
          new Date(2027, 0, 5),
          days,
          month,
          new Date(2026, 9, 2),
        ),
      ),
    ).toBe("2026-11-01");
  });
});

describe("effectiveSelectedDay in a week", () => {
  // Sunday November 29 to Saturday December 5, 2026: it spans two months.
  const week = buildWeekDays(new Date(2026, 11, 2), 0);

  it("keeps a chosen day that is on screen", () => {
    expect(
      toDayKey(
        effectiveSelectedDay(
          new Date(2026, 11, 3),
          week,
          undefined,
          new Date(2026, 11, 1),
        ),
      ),
    ).toBe("2026-12-03");
  });

  it("falls back to today when it is in the week, in either month", () => {
    expect(
      toDayKey(
        effectiveSelectedDay(null, week, undefined, new Date(2026, 10, 30)),
      ),
    ).toBe("2026-11-30");
    expect(
      toDayKey(
        effectiveSelectedDay(null, week, undefined, new Date(2026, 11, 4)),
      ),
    ).toBe("2026-12-04");
  });

  it("otherwise falls back to the week's first day, not the 1st", () => {
    expect(
      toDayKey(
        effectiveSelectedDay(
          new Date(2026, 10, 20),
          week,
          undefined,
          new Date(2026, 10, 15),
        ),
      ),
    ).toBe("2026-11-29");
  });
});
