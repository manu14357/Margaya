import { describe, expect, it } from "vitest";
import {
  barHorizontalBox,
  buildDependencyLines,
  connectorMidpoint,
  connectorPoints,
  type DependencyRelation,
  dependencyPath,
  isDependencyConflict,
  roundedConnectorPath,
} from "./dependency-lines";

const day = (month: number, date: number) => new Date(2026, month - 1, date);
const span = (start: Date, end: Date) => ({
  scheduleStart: start,
  scheduleEnd: end,
});

describe("isDependencyConflict", () => {
  it("flags a blocker that ends after its dependent starts", () => {
    const blocker = span(day(10, 1), day(10, 5));
    expect(
      isDependencyConflict("blocks", blocker, span(day(10, 4), day(10, 8))),
    ).toBe(true);
    expect(
      isDependencyConflict("blocks", blocker, span(day(10, 5), day(10, 8))),
    ).toBe(false);
    expect(
      isDependencyConflict("blocks", blocker, span(day(10, 6), day(10, 8))),
    ).toBe(false);
  });

  it("compares starts for start_before and ends for finish_before", () => {
    const early = span(day(10, 1), day(10, 10));
    const late = span(day(10, 3), day(10, 5));
    expect(isDependencyConflict("start_before", early, late)).toBe(false);
    expect(isDependencyConflict("start_before", late, early)).toBe(true);
    expect(isDependencyConflict("finish_before", late, early)).toBe(false);
    expect(isDependencyConflict("finish_before", early, late)).toBe(true);
  });

  it("ignores the time of day of the stored dates", () => {
    const blocker = span(day(10, 1), new Date(2026, 9, 5, 23, 59));
    const dependent = span(new Date(2026, 9, 5, 0, 0), day(10, 9));
    expect(isDependencyConflict("blocks", blocker, dependent)).toBe(false);
  });
});

describe("dependencyPath", () => {
  const source = { left: 0, right: 100, centerY: 20 };

  it("runs straight across when the dependent starts after the blocker", () => {
    expect(
      dependencyPath(source, { left: 200, right: 260, centerY: 60 }, "blocks"),
    ).toBe("M 100 20 H 108 V 60 H 200");
  });

  it("detours between the rows when the dependent starts earlier", () => {
    expect(
      dependencyPath(source, { left: 40, right: 260, centerY: 60 }, "blocks"),
    ).toBe("M 100 20 H 108 V 40 H 32 V 60 H 40");
  });

  it("joins starts on the left and ends on the right", () => {
    const target = { left: 50, right: 300, centerY: 60 };
    expect(dependencyPath(source, target, "start_before")).toBe(
      "M 0 20 H -8 V 60 H 50",
    );
    expect(dependencyPath(source, target, "finish_before")).toBe(
      "M 100 20 H 308 V 60 H 300",
    );
  });
});

describe("buildDependencyLines", () => {
  const relations: DependencyRelation[] = [
    { id: "r1", sourceTaskId: "a", targetTaskId: "b", relationType: "blocks" },
    {
      id: "r2",
      sourceTaskId: "a",
      targetTaskId: "off",
      relationType: "blocks",
    },
    {
      id: "r3",
      sourceTaskId: "b",
      targetTaskId: "a",
      relationType: "finish_before",
    },
  ];
  const bars = new Map([
    [
      "a",
      {
        span: span(day(10, 1), day(10, 5)),
        box: { left: 0, right: 100, centerY: 20 },
      },
    ],
    [
      "b",
      {
        span: span(day(10, 3), day(10, 9)),
        box: { left: 60, right: 200, centerY: 60 },
      },
    ],
  ]);

  it("draws only relations between bars on screen and marks conflicts", () => {
    const lines = buildDependencyLines(relations, bars);
    expect(lines.map((line) => line.id)).toEqual(["r1", "r3"]);
    expect(lines[0]).toMatchObject({ conflict: true, targetTaskId: "b" });
    expect(lines[1]).toMatchObject({ conflict: true, targetTaskId: "a" });
  });
});

describe("barHorizontalBox", () => {
  const rangeStart = day(10, 1);

  it("places a bar by day columns, inset by its margin", () => {
    expect(
      barHorizontalBox(span(day(10, 3), day(10, 4)), rangeStart, 30, 40),
    ).toEqual({ left: 84, right: 156 });
  });

  it("clips a bar to the window and drops one outside it", () => {
    expect(
      barHorizontalBox(span(day(9, 20), day(10, 1)), rangeStart, 30, 40),
    ).toEqual({ left: 4, right: 36 });
    expect(
      barHorizontalBox(span(day(9, 1), day(9, 30)), rangeStart, 30, 40),
    ).toBeNull();
    expect(
      barHorizontalBox(span(day(11, 1), day(11, 2)), rangeStart, 30, 40),
    ).toBeNull();
  });
});

describe("rounded connectors", () => {
  it("reads the corners of an orthogonal connector", () => {
    expect(connectorPoints("M 100 20 H 108 V 60 H 200")).toEqual([
      { x: 100, y: 20 },
      { x: 108, y: 20 },
      { x: 108, y: 60 },
      { x: 200, y: 60 },
    ]);
  });

  it("rounds each corner without eating short runs", () => {
    const points = connectorPoints("M 100 20 H 108 V 60 H 200");
    expect(roundedConnectorPath(points, 6)).toBe(
      "M 100 20 L 104 20 Q 108 20 108 24 L 108 54 Q 108 60 114 60 L 200 60",
    );
  });

  it("finds the halfway point along the connector", () => {
    expect(connectorMidpoint(connectorPoints("M 0 0 H 10 V 20 H 30"))).toEqual({
      x: 10,
      y: 15,
    });
  });
});
