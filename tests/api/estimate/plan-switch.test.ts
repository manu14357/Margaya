import { HTTPException } from "hono/http-exception";
import { describe, expect, it } from "vitest";
import { planSwitch } from "../../../apps/api/src/estimate/controllers/activate-estimate";

function point(id: string, value: string, estimateId: string) {
  const now = new Date("2026-01-01T00:00:00Z");
  return {
    id,
    estimateId,
    value,
    numericValue: Number.isNaN(Number(value)) ? null : Number(value),
    position: 1,
    createdAt: now,
    updatedAt: now,
  };
}

const current = { type: "categories" as const };
const currentPoints = [
  point("s", "S", "old"),
  point("m", "M", "old"),
  point("l", "L", "old"),
];
const target = { type: "points" as const };
const targetPoints = [point("p1", "1", "new"), point("p5", "5", "new")];

function expectBadRequest(run: () => unknown, message: string) {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(HTTPException);
    expect((error as HTTPException).status).toBe(400);
    expect((error as HTTPException).message).toBe(message);
    return;
  }
  throw new Error("expected a 400");
}

describe("planSwitch", () => {
  it("maps every current value, unmapped ones to no estimate", () => {
    const plan = planSwitch({
      mapping: [
        { fromPointId: "s", toPointId: "p1" },
        { fromPointId: "l", toPointId: "p5" },
      ],
      current,
      currentPoints,
      target,
      targetPoints,
    });
    expect(plan).toEqual([
      {
        from: { id: "s", value: "S", type: "categories" },
        to: { id: "p1", value: "1", type: "points" },
      },
      { from: { id: "m", value: "M", type: "categories" }, to: null },
      {
        from: { id: "l", value: "L", type: "categories" },
        to: { id: "p5", value: "5", type: "points" },
      },
    ]);
  });

  it("maps explicitly to null", () => {
    const plan = planSwitch({
      mapping: [{ fromPointId: "m", toPointId: null }],
      current,
      currentPoints,
      target,
      targetPoints,
    });
    expect(plan.every((entry) => entry.to === null)).toBe(true);
  });

  it("refuses a value mapped twice", () => {
    expectBadRequest(
      () =>
        planSwitch({
          mapping: [
            { fromPointId: "s", toPointId: "p1" },
            { fromPointId: "s", toPointId: "p5" },
          ],
          current,
          currentPoints,
          target,
          targetPoints,
        }),
      "Each value can be mapped only once",
    );
  });

  it("refuses sources outside the active system", () => {
    expectBadRequest(
      () =>
        planSwitch({
          mapping: [{ fromPointId: "p1", toPointId: "p5" }],
          current,
          currentPoints,
          target,
          targetPoints,
        }),
      "Mapped values must belong to the active estimate system",
    );
  });

  it("refuses targets outside the system being activated", () => {
    expectBadRequest(
      () =>
        planSwitch({
          mapping: [{ fromPointId: "s", toPointId: "m" }],
          current,
          currentPoints,
          target,
          targetPoints,
        }),
      "Values must map to the estimate system being activated, or to null",
    );
  });

  it("needs an empty mapping without an active system", () => {
    expect(
      planSwitch({
        mapping: [],
        current: null,
        currentPoints: [],
        target,
        targetPoints,
      }),
    ).toEqual([]);
    expectBadRequest(
      () =>
        planSwitch({
          mapping: [{ fromPointId: "s", toPointId: "p1" }],
          current: null,
          currentPoints: [],
          target,
          targetPoints,
        }),
      "Nothing to map",
    );
  });
});
