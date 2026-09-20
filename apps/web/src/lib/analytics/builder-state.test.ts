import { afterEach, describe, expect, it } from "vitest";
import {
  type BuilderAvailability,
  builderStorageKey,
  defaultBuilderState,
  loadBuilderState,
  normalizeBuilderState,
  saveBuilderState,
  withXAxis,
} from "./builder-state";

const everything: BuilderAvailability = {
  dimensions: ["group", "priority", "assignee", "label", "cycle", "createdAt"],
  pointsAvailable: true,
};

afterEach(() => window.localStorage.clear());

describe("normalizeBuilderState", () => {
  it("defaults to priority, tasks, no segment and monthly buckets", () => {
    expect(normalizeBuilderState(null, everything)).toEqual({
      xAxis: "priority",
      metric: "taskCount",
      segment: null,
      dateBucket: "month",
      includeNone: true,
      sortByValue: false,
      showSubTasks: true,
    });
  });

  it("keeps valid stored values", () => {
    const stored = {
      xAxis: "assignee",
      metric: "estimatePoints",
      segment: "group",
      dateBucket: "week",
      includeNone: false,
      sortByValue: false,
      showSubTasks: false,
    };
    expect(normalizeBuilderState(stored, everything)).toEqual(stored);
  });

  it("drops unknown values", () => {
    const state = normalizeBuilderState(
      {
        xAxis: "colour",
        metric: "hours",
        segment: 7,
        dateBucket: "day",
        includeNone: "yes",
      },
      everything,
    );
    expect(state).toEqual(defaultBuilderState("priority"));
  });

  it("falls back when a dimension or points are no longer available", () => {
    const state = normalizeBuilderState(
      { xAxis: "cycle", metric: "estimatePoints", segment: "cycle" },
      { dimensions: ["group", "priority"], pointsAvailable: false },
    );
    expect(state.xAxis).toBe("priority");
    expect(state.metric).toBe("taskCount");
    expect(state.segment).toBeNull();
  });

  it("never segments by the x-axis or by a date", () => {
    expect(
      normalizeBuilderState({ xAxis: "label", segment: "label" }, everything)
        .segment,
    ).toBeNull();
    expect(
      normalizeBuilderState(
        { xAxis: "label", segment: "createdAt" },
        everything,
      ).segment,
    ).toBeNull();
  });

  it("gives nominal dimensions a value sort by default", () => {
    expect(
      normalizeBuilderState({ xAxis: "assignee" }, everything).sortByValue,
    ).toBe(true);
    expect(
      normalizeBuilderState({ xAxis: "group" }, everything).sortByValue,
    ).toBe(false);
  });
});

describe("withXAxis", () => {
  it("clears a segment equal to the new x-axis and resets the sort", () => {
    const next = withXAxis(
      { ...defaultBuilderState("group"), segment: "label" },
      "label",
    );
    expect(next.segment).toBeNull();
    expect(next.sortByValue).toBe(true);
  });
});

describe("storage", () => {
  it("round-trips per scope and ignores corrupt values", () => {
    saveBuilderState("all", defaultBuilderState("label"));
    expect(loadBuilderState("all")).toEqual(defaultBuilderState("label"));
    window.localStorage.setItem(builderStorageKey("p1"), "{not json");
    expect(loadBuilderState("p1")).toBeNull();
    expect(normalizeBuilderState(loadBuilderState("p1"), everything)).toEqual(
      defaultBuilderState(),
    );
  });
});
