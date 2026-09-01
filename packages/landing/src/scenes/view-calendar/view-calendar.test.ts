import { describe, expect, it } from "vitest";
import messages from "../../../../../i18n/en-US.json";
import { finalStateOf } from "../../demo";
import { viewTasks } from "../views-shared/data";
import { calendarViewReducer, packWeek, WEEK_START } from "./state";
import { createCalendarViewScene } from "./view-calendar-scene";

const demo = messages.landing.demo;

describe("calendar view scene", () => {
  it("keeps a task's length when it is rescheduled", () => {
    const state = calendarViewReducer(
      { tasks: viewTasks(demo), mode: "month" },
      { type: "reschedule", id: "latency", day: 20 },
    );
    expect(state.tasks.find((task) => task.id === "latency")).toMatchObject({
      start: 20,
      end: 23,
    });
  });

  it("packs overlapping bars into separate lanes", () => {
    const { segments, hidden } = packWeek(viewTasks(demo), WEEK_START, 3);
    const lanes = Object.fromEntries(
      segments.map((segment) => [segment.task.id, segment.lane]),
    );
    expect(lanes.tokens).not.toBe(lanes.latency);
    expect(new Set(segments.map((segment) => segment.lane)).size).toBe(3);
    expect(hidden.every((count) => count === 0)).toBe(true);
  });

  it("counts bars past the last lane per day", () => {
    const { hidden } = packWeek(viewTasks(demo), WEEK_START, 1);
    expect(hidden.some((count) => count > 0)).toBe(true);
  });

  it("marks bars that cross a week edge", () => {
    const [segment] = packWeek(
      [{ ...viewTasks(demo)[0], start: 10, end: 13 }] as ReturnType<
        typeof viewTasks
      >,
      WEEK_START,
      3,
    ).segments;
    expect(segment).toMatchObject({
      from: 0,
      to: 1,
      continuesBefore: true,
      continuesAfter: false,
    });
  });

  it("ends in the week view with the task moved to October 16", () => {
    const final = finalStateOf(createCalendarViewScene(demo));
    expect(final.mode).toBe("week");
    expect(final.tasks.find((task) => task.id === "a11y")).toMatchObject({
      start: 16,
      end: 16,
    });
  });
});
