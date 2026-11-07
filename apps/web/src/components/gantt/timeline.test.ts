import { addDays, differenceInCalendarDays, parseISO } from "date-fns";
import { describe, expect, it } from "vitest";
import {
  buildGanttTimeline,
  centredDayScrollLeft,
  GANTT_WINDOW_DAYS,
  ganttZoomScale,
  parseTaskDate,
  showsDayNumber,
  taskScheduleSpan,
} from "./timeline";

const span = (start: string, end = start) => ({
  scheduleStart: parseISO(start),
  scheduleEnd: parseISO(end),
});

describe("taskScheduleSpan", () => {
  const dates = (startDate: string | null, dueDate: string | null) => ({
    startDate,
    dueDate,
  });

  it("spans a task's dates, in order, from whichever are set", () => {
    expect(taskScheduleSpan(dates("2026-10-01", "2026-10-05"))).toEqual(
      span("2026-10-01", "2026-10-05"),
    );
    expect(taskScheduleSpan(dates("2026-10-05", "2026-10-01"))).toEqual(
      span("2026-10-01", "2026-10-05"),
    );
    expect(taskScheduleSpan(dates(null, "2026-10-05"))).toEqual(
      span("2026-10-05"),
    );
    expect(taskScheduleSpan(dates("2026-10-05", null))).toEqual(
      span("2026-10-05"),
    );
    expect(taskScheduleSpan(dates(null, null))).toBeNull();
  });

  it("puts a milestone on one day: its due date, else its start date", () => {
    expect(
      taskScheduleSpan({
        ...dates("2026-10-01", "2026-10-05"),
        isMilestone: true,
      }),
    ).toEqual(span("2026-10-05"));
    expect(
      taskScheduleSpan({ ...dates("2026-10-01", null), isMilestone: true }),
    ).toEqual(span("2026-10-01"));
  });
});

describe("bounded Gantt timeline", () => {
  it("bounds allocation even for one task spanning years 0001 through 9999", () => {
    const timeline = buildGanttTimeline(
      [span("0001-01-01", "9999-12-31")],
      1,
      2.75,
      null,
      parseISO("2026-09-19"),
    );
    expect(timeline?.days).toHaveLength(GANTT_WINDOW_DAYS);
    expect(timeline?.rangeStart.getFullYear()).toBe(2026);
    expect(timeline?.timelineMinWidthRem).toBe(GANTT_WINDOW_DAYS * 2.75);
  });
  it("bounds separate distant tasks and supports jumping directly to either endpoint", () => {
    const tasks = [span("0001-01-01"), span("9999-12-31")];
    for (const date of ["0001-01-01", "9999-12-31"]) {
      const timeline = buildGanttTimeline(tasks, 1, 3, parseISO(date));
      expect(timeline?.days.length).toBeLessThanOrEqual(GANTT_WINDOW_DAYS);
      expect(
        timeline?.days.every((day) => Number.isFinite(day.getTime())),
      ).toBe(true);
      expect(parseISO(date).getTime()).toBeGreaterThanOrEqual(
        timeline?.rangeStart.getTime() ?? 0,
      );
      expect(parseISO(date).getTime()).toBeLessThanOrEqual(
        timeline?.rangeEnd.getTime() ?? 0,
      );
    }
  });
  it("retains week padding for a small normal schedule", () => {
    const timeline = buildGanttTimeline(
      [span("2026-09-14", "2026-09-18")],
      1,
      3,
    );
    expect(timeline?.rangeStart).toEqual(parseISO("2026-09-07"));
    expect(timeline?.rangeEnd).toEqual(parseISO("2026-10-18"));
    expect(timeline?.hasPrevious).toBe(false);
    expect(timeline?.hasNext).toBe(false);
  });
  it("pages a long project without gaps and stops at the final window", () => {
    const tasks = [span("2026-01-01", "2027-12-31")];
    let timeline = buildGanttTimeline(tasks, 0, 3, parseISO("2026-01-01"));
    for (let page = 0; page < 12 && timeline?.hasNext; page++) {
      const previous = timeline;
      timeline = buildGanttTimeline(
        tasks,
        0,
        3,
        addDays(previous.rangeStart, GANTT_WINDOW_DAYS),
      );
      expect(
        differenceInCalendarDays(
          timeline?.rangeStart ?? new Date(),
          previous.rangeEnd,
        ),
      ).toBeLessThanOrEqual(1);
      expect(timeline?.days.length).toBeLessThanOrEqual(GANTT_WINDOW_DAYS);
    }
    expect(timeline?.hasNext).toBe(false);
    expect(timeline?.rangeStart).toEqual(timeline?.maximumStart);
  });
  it.each([null, "invalid", "+275760-09-13", "-000001-01-01"])(
    "ignores unsupported legacy dates safely (%s)",
    (value) => {
      expect(parseTaskDate(value)).toBeNull();
    },
  );
});

describe("Gantt zoom scale", () => {
  it("keeps the original scale as Month and widens or narrows the others", () => {
    expect(ganttZoomScale("month", false)).toEqual({
      dayColumnWidthRem: 2.75,
      windowDays: GANTT_WINDOW_DAYS,
      labelEveryDay: true,
    });
    expect(ganttZoomScale("month", true).dayColumnWidthRem).toBe(3.125);
    const week = ganttZoomScale("week", false);
    const quarter = ganttZoomScale("quarter", false);
    expect(week.dayColumnWidthRem).toBeGreaterThan(2.75);
    expect(week.windowDays).toBeLessThan(GANTT_WINDOW_DAYS);
    expect(quarter.dayColumnWidthRem).toBeLessThan(2.75);
    expect(quarter.windowDays).toBeGreaterThan(GANTT_WINDOW_DAYS);
    expect(quarter.labelEveryDay).toBe(false);
  });

  it("sizes the window and the grid from the zoom", () => {
    const tasks = [span("2026-01-01", "2026-12-31")];
    const today = parseISO("2026-06-15");
    for (const zoom of ["week", "month", "quarter"] as const) {
      const scale = ganttZoomScale(zoom, false);
      const timeline = buildGanttTimeline(
        tasks,
        1,
        scale.dayColumnWidthRem,
        null,
        today,
        scale.windowDays,
      );
      expect(timeline?.days).toHaveLength(scale.windowDays);
      expect(timeline?.windowDays).toBe(scale.windowDays);
      expect(timeline?.timelineMinWidthRem).toBe(
        scale.windowDays * scale.dayColumnWidthRem,
      );
      expect(
        timeline?.days.some((day) => day.getTime() === today.getTime()),
      ).toBe(true);
    }
  });

  it("labels only week starts when days are too narrow", () => {
    // Monday 2026-10-12 and Wednesday 2026-10-14.
    const monday = parseISO("2026-10-12");
    const wednesday = parseISO("2026-10-14");
    expect(showsDayNumber(wednesday, 3, true, 1)).toBe(true);
    expect(showsDayNumber(wednesday, 3, false, 1)).toBe(false);
    expect(showsDayNumber(monday, 1, false, 1)).toBe(true);
    expect(showsDayNumber(monday, 1, false, 0)).toBe(false);
    expect(showsDayNumber(wednesday, 0, false, 1)).toBe(true);
  });
});

describe("centredDayScrollLeft", () => {
  // A 1000px chart beside a 320px task list, with 44px day columns: 15 whole
  // columns fit.
  const view = { columnPx: 44, viewportPx: 1000, railPx: 320, dayCount: 91 };

  it("centres the day and starts on a whole column", () => {
    const left = centredDayScrollLeft({ ...view, dayIndex: 16 });
    expect(left).toBe(9 * 44);
    expect(left % 44).toBe(0);
  });

  it("never scrolls before the first day", () => {
    expect(centredDayScrollLeft({ ...view, dayIndex: 3 })).toBe(0);
  });

  it("stops at the last whole column the chart can scroll to", () => {
    // 320 + 91 * 44 - 1000 = 3324px of scroll; 75 whole columns of it.
    expect(centredDayScrollLeft({ ...view, dayIndex: 90 })).toBe(75 * 44);
  });

  it("works without the task list and on narrow columns", () => {
    expect(
      centredDayScrollLeft({
        columnPx: 16,
        viewportPx: 360,
        railPx: 0,
        dayCount: 182,
        dayIndex: 100,
      }),
    ).toBe(89 * 16);
  });

  it("does not scroll before the columns are measured", () => {
    expect(centredDayScrollLeft({ ...view, columnPx: 0, dayIndex: 16 })).toBe(
      0,
    );
  });
});
