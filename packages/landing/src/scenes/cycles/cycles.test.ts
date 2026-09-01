import { describe, expect, it } from "vitest";
import messages from "../../../../../i18n/en-US.json";
import { finalStateOf } from "../../demo";
import { COMPLETED_TASK_ID, createCyclesScene } from "./cycles-scene";
import {
  burnSeries,
  CYCLE_DAYS,
  cycleCounts,
  cyclesReducer,
  pointTotals,
} from "./state";

const scene = createCyclesScene(messages.landing.demo);

describe("cycles scene", () => {
  it("starts mid-way with the chart hidden", () => {
    const counts = cycleCounts(scene.initialState.tasks);
    expect(counts).toMatchObject({ done: 6, scope: 11, remaining: 5 });
    expect(counts.percent).toBe(55);
    expect(scene.initialState.drawn).toBe(false);
    expect(burnSeries(scene.initialState.tasks).length).toBeLessThan(
      CYCLE_DAYS,
    );
  });

  it("toggles the status popover and closes it on a pick", () => {
    const open = cyclesReducer(scene.initialState, {
      type: "openStatus",
      id: "search",
    });
    expect(open.menuFor).toBe("search");
    expect(
      cyclesReducer(open, { type: "openStatus", id: "search" }).menuFor,
    ).toBeNull();
    const done = cyclesReducer(open, {
      type: "setStatus",
      id: "search",
      status: "done",
    });
    expect(done.menuFor).toBeNull();
    expect(done.tasks.find((task) => task.id === "search")?.status).toBe(
      "done",
    );
  });

  it("ends drawn, with the task done and the line one lower", () => {
    const final = finalStateOf(scene);
    expect(final.drawn).toBe(true);
    expect(final.menuFor).toBeNull();
    expect(
      final.tasks.find((task) => task.id === COMPLETED_TASK_ID)?.status,
    ).toBe("done");
    const counts = cycleCounts(final.tasks);
    expect(counts.percent).toBe(64);
    expect(burnSeries(final.tasks).at(-1)).toBe(4);
    expect(pointTotals(final.tasks)).toEqual({ completed: 18, total: 30 });
  });
});
