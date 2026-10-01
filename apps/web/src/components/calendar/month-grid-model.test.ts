import { addDays } from "date-fns";
import { describe, expect, it } from "vitest";
import {
  buildMonthWeeks,
  buildWeekDays,
  DAYS_PER_WEEK,
  packWeekLanes,
  toVisibleColumns,
  visibleDayIndexes,
  type WeekStartsOn,
} from "./month-grid-model";

/** Local-time dates keep the assertions independent of the runner timezone. */
function day(year: number, monthIndex: number, dayOfMonth: number) {
  return new Date(year, monthIndex, dayOfMonth);
}

function scheduled(id: string, start: Date, end: Date) {
  return { id, scheduleStart: start, scheduleEnd: end };
}

// Saturday 2026-08-01 through Monday 2026-08-31.
const AUGUST_2026 = day(2026, 7, 1);

describe("buildMonthWeeks", () => {
  it("returns whole weeks that start on the preferred weekday", () => {
    for (const weekStartsOn of [0, 1, 6] as WeekStartsOn[]) {
      const weeks = buildMonthWeeks(AUGUST_2026, weekStartsOn);

      expect(weeks.length).toBeGreaterThanOrEqual(5);
      for (const week of weeks) {
        expect(week).toHaveLength(DAYS_PER_WEEK);
        expect(week[0].getDay()).toBe(weekStartsOn);
      }
    }
  });

  it("covers every day of the visible month", () => {
    const days = buildMonthWeeks(AUGUST_2026, 1).flat();
    const august = days.filter(
      (entry) => entry.getMonth() === 7 && entry.getFullYear() === 2026,
    );

    expect(august).toHaveLength(31);
  });

  it("pads the grid with neighbouring-month days", () => {
    const days = buildMonthWeeks(AUGUST_2026, 1).flat();

    expect(days.some((entry) => entry.getMonth() === 6)).toBe(true);
    expect(days.some((entry) => entry.getMonth() === 8)).toBe(true);
  });
});

describe("packWeekLanes", () => {
  // Sunday 2026-08-02 through Saturday 2026-08-08.
  const week = Array.from({ length: DAYS_PER_WEEK }, (_, index) =>
    day(2026, 7, 2 + index),
  );

  it("maps a task to inclusive-start, exclusive-end grid lines", () => {
    const task = scheduled("a", day(2026, 7, 2), day(2026, 7, 3));
    const { segments } = packWeekLanes(week, [task], 3);

    expect(segments).toHaveLength(1);
    expect(segments[0].columnStart).toBe(1);
    expect(segments[0].columnEnd).toBe(3);
    expect(segments[0].lane).toBe(0);
    expect(segments[0].continuesBefore).toBe(false);
    expect(segments[0].continuesAfter).toBe(false);
  });

  it("gives a single-day task a one-column span", () => {
    const task = scheduled("a", day(2026, 7, 4), day(2026, 7, 4));
    const { segments } = packWeekLanes(week, [task], 3);

    expect(segments[0].columnStart).toBe(3);
    expect(segments[0].columnEnd).toBe(4);
  });

  it("reuses a lane for tasks that do not overlap", () => {
    const tasks = [
      scheduled("a", day(2026, 7, 2), day(2026, 7, 3)),
      scheduled("b", day(2026, 7, 5), day(2026, 7, 6)),
    ];
    const { segments } = packWeekLanes(week, tasks, 3);

    expect(segments.map((segment) => segment.lane)).toEqual([0, 0]);
  });

  it("stacks overlapping tasks into separate lanes", () => {
    const tasks = [
      scheduled("a", day(2026, 7, 2), day(2026, 7, 5)),
      scheduled("b", day(2026, 7, 3), day(2026, 7, 6)),
      scheduled("c", day(2026, 7, 4), day(2026, 7, 7)),
    ];
    const { segments } = packWeekLanes(week, tasks, 5);
    const lanesById = new Map(
      segments.map((segment) => [segment.task.id, segment.lane]),
    );

    expect(lanesById.get("a")).toBe(0);
    expect(lanesById.get("b")).toBe(1);
    expect(lanesById.get("c")).toBe(2);
  });

  it("clips a task that starts before the week and flags the continuation", () => {
    const task = scheduled("a", day(2026, 6, 31), day(2026, 7, 4));
    const { segments } = packWeekLanes(week, [task], 3);

    expect(segments[0].columnStart).toBe(1);
    expect(segments[0].columnEnd).toBe(4);
    expect(segments[0].continuesBefore).toBe(true);
    expect(segments[0].continuesAfter).toBe(false);
  });

  it("clips a task that runs past the week and flags the continuation", () => {
    const task = scheduled("a", day(2026, 7, 6), day(2026, 7, 12));
    const { segments } = packWeekLanes(week, [task], 3);

    expect(segments[0].columnStart).toBe(5);
    expect(segments[0].columnEnd).toBe(8);
    expect(segments[0].continuesBefore).toBe(false);
    expect(segments[0].continuesAfter).toBe(true);
  });

  it("flags both sides for a task spanning the whole week", () => {
    const task = scheduled("a", day(2026, 7, 1), day(2026, 7, 20));
    const { segments } = packWeekLanes(week, [task], 3);

    expect(segments[0].columnStart).toBe(1);
    expect(segments[0].columnEnd).toBe(8);
    expect(segments[0].continuesBefore).toBe(true);
    expect(segments[0].continuesAfter).toBe(true);
  });

  it("excludes tasks that do not touch the week", () => {
    const tasks = [
      scheduled("before", day(2026, 6, 20), day(2026, 6, 25)),
      scheduled("after", day(2026, 7, 15), day(2026, 7, 18)),
    ];
    const { segments, hiddenCountByDay } = packWeekLanes(week, tasks, 3);

    expect(segments).toEqual([]);
    expect(hiddenCountByDay).toEqual(new Array(DAYS_PER_WEEK).fill(0));
  });

  it("counts overflow per day once the lane budget is spent", () => {
    const tasks = [
      scheduled("a", day(2026, 7, 2), day(2026, 7, 3)),
      scheduled("c", day(2026, 7, 3), day(2026, 7, 5)),
    ];
    const { segments, hiddenCountByDay } = packWeekLanes(week, tasks, 1);

    expect(segments.map((segment) => segment.task.id)).toEqual(["a"]);
    expect(hiddenCountByDay).toEqual([0, 1, 1, 1, 0, 0, 0]);
  });

  it("is deterministic for tasks sharing a start column and span", () => {
    const tasks = [
      scheduled("b", day(2026, 7, 2), day(2026, 7, 3)),
      scheduled("a", day(2026, 7, 2), day(2026, 7, 3)),
    ];
    const { segments } = packWeekLanes(week, tasks, 3);

    expect(segments.map((segment) => segment.task.id)).toEqual(["a", "b"]);
  });

  it("returns an empty layout for an empty week", () => {
    const { segments, hiddenCountByDay } = packWeekLanes(
      [],
      [scheduled("a", day(2026, 7, 2), day(2026, 7, 3))],
      3,
    );

    expect(segments).toEqual([]);
    expect(hiddenCountByDay).toEqual(new Array(DAYS_PER_WEEK).fill(0));
  });

  it("does not clip a task that starts exactly on the first day of the week", () => {
    // Regression: a bar starting on the week's own first column must keep its
    // left cap, otherwise it reads as continuing from the previous week.
    for (const weekStartsOn of [0, 1, 6] as WeekStartsOn[]) {
      const weeks = buildMonthWeeks(AUGUST_2026, weekStartsOn);
      const targetWeek = weeks.find((candidate) =>
        candidate.some((entry) => entry.getDate() === 10),
      );
      if (!targetWeek) throw new Error("expected a week containing Aug 10");

      const firstDay = targetWeek[0];
      const task = scheduled("p2-3", firstDay, addDays(firstDay, 4));
      const { segments } = packWeekLanes(targetWeek, [task], 3);

      expect(segments[0].continuesBefore).toBe(false);
      expect(segments[0].columnStart).toBe(1);
    }
  });

  it("keeps continuesBefore true only when the task really starts earlier", () => {
    const startsOnWeekStart = packWeekLanes(
      week,
      [scheduled("a", week[0], day(2026, 7, 6))],
      3,
    );
    const startsBeforeWeek = packWeekLanes(
      week,
      [scheduled("b", day(2026, 7, 1), day(2026, 7, 6))],
      3,
    );

    expect(startsOnWeekStart.segments[0].continuesBefore).toBe(false);
    expect(startsBeforeWeek.segments[0].continuesBefore).toBe(true);
  });
});

describe("packWeekLanes tasksByDay", () => {
  const week = Array.from({ length: DAYS_PER_WEEK }, (_, index) =>
    day(2026, 7, 2 + index),
  );

  it("lists every task overlapping each day, hidden ones included", () => {
    const tasks = [
      scheduled("a", day(2026, 7, 2), day(2026, 7, 3)),
      scheduled("b", day(2026, 7, 3), day(2026, 7, 4)),
      scheduled("c", day(2026, 7, 3), day(2026, 7, 3)),
    ];
    const { tasksByDay, hiddenCountByDay } = packWeekLanes(week, tasks, 1);

    expect(tasksByDay[0].map((entry) => entry.id)).toEqual(["a"]);
    expect(tasksByDay[1].map((entry) => entry.id)).toEqual(["a", "b", "c"]);
    expect(tasksByDay[2].map((entry) => entry.id)).toEqual(["b"]);
    expect(tasksByDay[3]).toEqual([]);
    // Two of the three tasks on Aug 3 did not fit the single lane.
    expect(hiddenCountByDay[1]).toBe(2);
  });

  it("includes days covered by a task clipped at the week edges", () => {
    const { tasksByDay } = packWeekLanes(
      week,
      [scheduled("wide", day(2026, 6, 28), day(2026, 7, 20))],
      3,
    );

    for (const dayTasks of tasksByDay) {
      expect(dayTasks.map((entry) => entry.id)).toEqual(["wide"]);
    }
  });

  it("is empty for a week with no overlapping tasks", () => {
    const { tasksByDay } = packWeekLanes(
      week,
      [scheduled("far", day(2026, 8, 10), day(2026, 8, 12))],
      3,
    );

    expect(tasksByDay.every((entry) => entry.length === 0)).toBe(true);
  });
});

describe("buildWeekDays", () => {
  it("returns the seven days around the anchor from the preferred weekday", () => {
    // Wednesday 2026-10-14.
    const anchor = day(2026, 9, 14);
    for (const weekStartsOn of [0, 1, 6] as WeekStartsOn[]) {
      const week = buildWeekDays(anchor, weekStartsOn);
      expect(week).toHaveLength(DAYS_PER_WEEK);
      expect(week[0].getDay()).toBe(weekStartsOn);
      expect(week.some((entry) => entry.getTime() === anchor.getTime())).toBe(
        true,
      );
    }
    expect(buildWeekDays(anchor, 1)[0]).toEqual(day(2026, 9, 12));
    expect(buildWeekDays(anchor, 0)[0]).toEqual(day(2026, 9, 11));
    expect(buildWeekDays(anchor, 6)[0]).toEqual(day(2026, 9, 10));
  });
});

describe("visibleDayIndexes", () => {
  it("drops Saturday and Sunday wherever the week starts", () => {
    const anchor = day(2026, 9, 14);
    expect(visibleDayIndexes(buildWeekDays(anchor, 1), false)).toEqual([
      0, 1, 2, 3, 4,
    ]);
    expect(visibleDayIndexes(buildWeekDays(anchor, 0), false)).toEqual([
      1, 2, 3, 4, 5,
    ]);
    expect(visibleDayIndexes(buildWeekDays(anchor, 6), false)).toEqual([
      2, 3, 4, 5, 6,
    ]);
    expect(visibleDayIndexes(buildWeekDays(anchor, 1), true)).toHaveLength(7);
  });
});

describe("toVisibleColumns", () => {
  // Week starting Sunday: Sun(0) Mon(1) … Fri(5) Sat(6).
  const weekdays = [1, 2, 3, 4, 5];
  const segment = (first: number, last: number) => ({
    columnStart: first + 1,
    columnEnd: last + 2,
    continuesBefore: false,
    continuesAfter: false,
  });

  it("shifts a weekday bar onto the remaining columns", () => {
    expect(toVisibleColumns(segment(2, 4), weekdays)).toEqual({
      columnStart: 2,
      columnEnd: 5,
      continuesBefore: false,
      continuesAfter: false,
    });
  });

  it("trims hidden days and drops the cap on that side", () => {
    expect(toVisibleColumns(segment(0, 6), weekdays)).toEqual({
      columnStart: 1,
      columnEnd: 6,
      continuesBefore: true,
      continuesAfter: true,
    });
  });

  it("has no columns for a weekend-only bar", () => {
    expect(toVisibleColumns(segment(6, 6), weekdays)).toBeNull();
  });
});
