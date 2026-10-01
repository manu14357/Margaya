import { addDays, differenceInCalendarDays, parseISO } from "date-fns";
import { describe, expect, it } from "vitest";
import {
  buildGanttTimeline,
  GANTT_WINDOW_DAYS,
  ganttZoomScale,
  parseTaskDate,
  showsDayNumber,
} from "./timeline";

const span = (start: string, end = start) => ({
  scheduleStart: parseISO(start),
  scheduleEnd: parseISO(end),
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
