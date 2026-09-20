import { describe, expect, it } from "vitest";
import {
  type CycleFormValues,
  createCyclePayload,
  updateCyclePayload,
  validateCycleForm,
} from "./form";

const base: CycleFormValues = {
  name: "Sprint 1",
  description: "",
  startDate: null,
  endDate: null,
  ownerId: "u1",
};

function keys(values: Partial<CycleFormValues>, options = {}) {
  return validateCycleForm({ ...base, ...values }, options).map((e) => e.key);
}

describe("validateCycleForm", () => {
  it("requires a name of at most 255 characters", () => {
    expect(keys({ name: "   " })).toEqual(["cycles:form.errors.nameRequired"]);
    expect(keys({ name: "x".repeat(256) })).toEqual([
      "cycles:form.errors.nameTooLong",
    ]);
    expect(keys({ name: "x".repeat(255) })).toEqual([]);
  });

  it("wants both dates or neither", () => {
    expect(keys({ startDate: "2026-03-01" })).toEqual([
      "cycles:form.errors.bothDates",
    ]);
    expect(keys({ endDate: "2026-03-01" })).toEqual([
      "cycles:form.errors.bothDates",
    ]);
    expect(keys({})).toEqual([]);
  });

  it("checks order and span", () => {
    expect(keys({ startDate: "2026-03-02", endDate: "2026-03-01" })).toEqual([
      "cycles:form.errors.endBeforeStart",
    ]);
    expect(keys({ startDate: "2026-01-01", endDate: "2027-01-02" })).toEqual([
      "cycles:form.errors.tooLong",
    ]);
    expect(keys({ startDate: "2026-01-01", endDate: "2027-01-01" })).toEqual(
      [],
    );
  });

  it("names the overlapping cycle and skips the edited one", () => {
    const otherCycles = [
      {
        id: "c1",
        name: "Sprint A",
        startDate: "2026-03-01",
        endDate: "2026-03-14",
      },
    ];
    const errors = validateCycleForm(
      { ...base, startDate: "2026-03-14", endDate: "2026-03-20" },
      { otherCycles },
    );
    expect(errors).toEqual([
      { field: "dates", key: "cycles:form.errors.overlap", name: "Sprint A" },
    ]);
    expect(
      validateCycleForm(
        { ...base, startDate: "2026-03-14", endDate: "2026-03-20" },
        { otherCycles, cycleId: "c1" },
      ),
    ).toEqual([]);
  });

  it("keeps a running cycle's end on or after today", () => {
    expect(
      keys(
        { startDate: "2026-03-01", endDate: "2026-03-09" },
        { isRunning: true, today: "2026-03-10" },
      ),
    ).toEqual(["cycles:form.errors.endInPast"]);
  });
});

describe("cycle payloads", () => {
  it("sends every field on create", () => {
    expect(
      createCyclePayload({
        ...base,
        name: " Sprint 2 ",
        startDate: "2026-03-01",
        endDate: "2026-03-14",
      }),
    ).toEqual({
      name: "Sprint 2",
      description: "",
      startDate: "2026-03-01",
      endDate: "2026-03-14",
      ownerId: "u1",
    });
  });

  it("sends only changes on update, with both dates together", () => {
    const original = {
      ...base,
      startDate: "2026-03-01",
      endDate: "2026-03-14",
    };
    expect(
      updateCyclePayload({ ...original, endDate: "2026-03-20" }, original),
    ).toEqual({
      startDate: "2026-03-01",
      endDate: "2026-03-20",
    });
    expect(
      updateCyclePayload({ ...original, ownerId: null }, original),
    ).toEqual({
      ownerId: null,
    });
    expect(updateCyclePayload(original, original)).toEqual({});
  });
});
