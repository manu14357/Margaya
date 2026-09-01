import { describe, expect, it } from "vitest";
import messages from "../../../../../i18n/en-US.json";
import { finalStateOf } from "../../demo";
import {
  barBox,
  dependencyPath,
  ganttViewReducer,
  isConflict,
  RELATION,
} from "./state";
import { createGanttViewScene } from "./view-gantt-scene";

const demo = messages.landing.demo;
const scene = createGanttViewScene(demo);
const find = (tasks: typeof scene.initialState.tasks, id: string) => {
  const task = tasks.find((candidate) => candidate.id === id);
  if (!task) throw new Error(`no ${id}`);
  return task;
};

describe("gantt view scene", () => {
  it("starts zoomed to weeks, with no line and no conflict", () => {
    const { tasks, zoom, linked } = scene.initialState;
    expect(zoom).toBe("week");
    expect(linked).toBe(false);
    expect(
      isConflict(find(tasks, RELATION.source), find(tasks, RELATION.target)),
    ).toBe(false);
  });

  it("never resizes a bar to end before it starts", () => {
    const state = ganttViewReducer(scene.initialState, {
      type: "resize",
      id: "tokens",
      end: 2,
    });
    const tokens = find(state.tasks, "tokens");
    expect(tokens.end).toBe(tokens.start);
  });

  it("draws a straight connector when there is room, a detour otherwise", () => {
    const straight = dependencyPath(
      { right: 100, centerY: 26 },
      { left: 200, centerY: 78 },
    );
    expect(straight).toBe("M 100 26 H 108 V 78 H 200");
    const detour = dependencyPath(
      { right: 100, centerY: 26 },
      { left: 104, centerY: 78 },
    );
    expect(detour).toBe("M 100 26 H 108 V 52 H 96 V 78 H 104");
  });

  it("insets bars 4px inside their day columns", () => {
    expect(barBox(find(scene.initialState.tasks, "tokens"), 44)).toEqual({
      left: 4,
      right: 128,
    });
  });

  it("ends zoomed to months, linked, with the stretched bar in conflict", () => {
    const final = finalStateOf(scene);
    expect(final.zoom).toBe("month");
    expect(final.linked).toBe(true);
    const source = find(final.tasks, RELATION.source);
    expect(source.end).toBe(16);
    expect(isConflict(source, find(final.tasks, RELATION.target))).toBe(true);
  });
});
