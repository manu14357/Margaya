import { describe, expect, it } from "vitest";
import { type CascadeTask, planDateCascade } from "./date-cascade";
import type { DependencyRelation, DependencyType } from "./dependency-lines";

const day = (date: number) => new Date(2026, 9, date);
const task = (start: number, end: number, locked = false): CascadeTask => ({
  span: { scheduleStart: day(start), scheduleEnd: day(end) },
  locked,
});
const link = (
  sourceTaskId: string,
  targetTaskId: string,
  relationType: DependencyType = "blocks",
): DependencyRelation => ({
  id: `${sourceTaskId}-${targetTaskId}`,
  sourceTaskId,
  targetTaskId,
  relationType,
});
const tasks = (entries: Record<string, CascadeTask>) =>
  new Map(Object.entries(entries));
const summary = (moves: ReturnType<typeof planDateCascade>) =>
  Object.fromEntries(
    moves.map((move) => [
      move.taskId,
      [
        move.days,
        move.span.scheduleStart.getDate(),
        move.span.scheduleEnd.getDate(),
      ],
    ]),
  );

describe("planDateCascade", () => {
  it("moves nothing when every link still holds", () => {
    expect(
      planDateCascade(
        "a",
        [link("a", "b")],
        tasks({ a: task(1, 5), b: task(5, 8) }),
      ),
    ).toEqual([]);
  });

  it("pushes a dependent just far enough, keeping its length", () => {
    const moves = planDateCascade(
      "a",
      [link("a", "b")],
      tasks({ a: task(1, 10), b: task(5, 8) }),
    );
    expect(summary(moves)).toEqual({ b: [5, 10, 13] });
  });

  it("follows the chain, and a chain that still fits stops", () => {
    const moves = planDateCascade(
      "a",
      [link("a", "b"), link("b", "c"), link("c", "d")],
      tasks({
        a: task(1, 10),
        b: task(5, 8),
        c: task(9, 10),
        d: task(20, 21),
      }),
    );
    expect(summary(moves)).toEqual({ b: [5, 10, 13], c: [4, 13, 14] });
  });

  it("uses the furthest push when two tasks hold one back", () => {
    const moves = planDateCascade(
      "a",
      [link("a", "b"), link("a", "c"), link("b", "d"), link("c", "d")],
      tasks({
        a: task(1, 3),
        b: task(2, 4),
        c: task(2, 9),
        d: task(5, 6),
      }),
    );
    expect(summary(moves)).toEqual({
      b: [1, 3, 5],
      c: [1, 3, 10],
      d: [5, 10, 11],
    });
  });

  it("reads each relation's own edges", () => {
    expect(
      summary(
        planDateCascade(
          "a",
          [link("a", "b", "start_before")],
          tasks({ a: task(5, 6), b: task(2, 20) }),
        ),
      ),
    ).toEqual({ b: [3, 5, 23] });
    expect(
      summary(
        planDateCascade(
          "a",
          [link("a", "b", "finish_before")],
          tasks({ a: task(1, 10), b: task(2, 4) }),
        ),
      ),
    ).toEqual({ b: [6, 8, 10] });
  });

  it("never moves the root, a closed task or a task without dates", () => {
    const moves = planDateCascade(
      "a",
      [link("a", "closed"), link("closed", "after"), link("a", "undated")],
      tasks({ a: task(1, 10), closed: task(2, 3, true), after: task(4, 5) }),
    );
    expect(moves).toEqual([]);
    expect(
      planDateCascade(
        "a",
        [link("a", "b"), link("b", "a", "start_before")],
        tasks({ a: task(1, 10), b: task(2, 3) }),
      ).map((move) => move.taskId),
    ).toEqual(["b"]);
  });

  it("gives no plan for a loop that would push tasks forever", () => {
    expect(
      planDateCascade(
        "root",
        [
          link("root", "b"),
          link("b", "c"),
          link("c", "b", "start_before"),
          link("b", "c", "finish_before"),
        ],
        tasks({ root: task(1, 10), b: task(2, 12), c: task(3, 14) }),
      ),
    ).toEqual([]);
  });
});
