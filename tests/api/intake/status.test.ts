import { describe, expect, it } from "vitest";
import {
  assertTransition,
  defaultTabStatuses,
  effectiveStatus,
  INTAKE_ACTIONS,
  INTAKE_STATUSES,
  type IntakeAction,
  type IntakeStatus,
  normalizeNote,
  tabStatuses,
  transitionFields,
  transitionTarget,
} from "../../../apps/api/src/intake/status";

// The §2.3 transition table: the target status, or the 409 message.
const TABLE: Record<IntakeStatus, Record<IntakeAction, string>> = {
  pending: {
    accept: "accepted",
    decline: "declined",
    snooze: "snoozed",
    unsnooze: "This request isn't snoozed",
    duplicate: "duplicate",
    reopen: "This request is already open",
  },
  snoozed: {
    accept: "accepted",
    decline: "declined",
    snooze: "snoozed",
    unsnooze: "pending",
    duplicate: "duplicate",
    reopen: "This request is already open",
  },
  declined: {
    accept: "Reopen this request first",
    decline: "Reopen this request first",
    snooze: "Reopen this request first",
    unsnooze: "This request isn't snoozed",
    duplicate: "Reopen this request first",
    reopen: "pending",
  },
  duplicate: {
    accept: "Reopen this request first",
    decline: "Reopen this request first",
    snooze: "Reopen this request first",
    unsnooze: "This request isn't snoozed",
    duplicate: "Reopen this request first",
    reopen: "pending",
  },
  accepted: {
    accept: "This request was already accepted",
    decline: "This request was already accepted",
    snooze: "This request was already accepted",
    unsnooze: "This request was already accepted",
    duplicate: "This request was already accepted",
    reopen: "This request was already accepted",
  },
};

describe("intake transitions", () => {
  for (const from of INTAKE_STATUSES) {
    for (const action of INTAKE_ACTIONS) {
      const expected = TABLE[from][action];
      it(`${from} × ${action} → ${expected}`, () => {
        const result = transitionTarget(from, action);
        if ((INTAKE_STATUSES as readonly string[]).includes(expected)) {
          expect(result).toEqual({ ok: true, to: expected });
          expect(assertTransition(from, action)).toBe(expected);
        } else {
          expect(result).toEqual({ ok: false, message: expected });
          expect(() => assertTransition(from, action)).toThrow(expected);
        }
      });
    }
  }
});

describe("effectiveStatus", () => {
  const until = new Date("2026-10-01T08:00:00Z");

  it("keeps a snooze until its time", () => {
    const before = new Date(until.getTime() - 1);
    expect(
      effectiveStatus({ status: "snoozed", snoozedUntil: until }, before),
    ).toBe("snoozed");
  });

  it("reads a snooze as pending at and after its time", () => {
    expect(
      effectiveStatus({ status: "snoozed", snoozedUntil: until }, until),
    ).toBe("pending");
    const after = new Date(until.getTime() + 1);
    expect(
      effectiveStatus({ status: "snoozed", snoozedUntil: until }, after),
    ).toBe("pending");
  });

  it("passes other statuses through", () => {
    for (const status of ["pending", "accepted", "declined", "duplicate"]) {
      expect(effectiveStatus({ status, snoozedUntil: null }, until)).toBe(
        status,
      );
    }
  });
});

describe("tabs", () => {
  it("maps tabs to statuses and default filters", () => {
    expect(tabStatuses("open")).toEqual(["pending", "snoozed"]);
    expect(tabStatuses("closed")).toEqual([
      "accepted",
      "declined",
      "duplicate",
    ]);
    expect(defaultTabStatuses("open")).toEqual(["pending"]);
    expect(defaultTabStatuses("closed")).toEqual([
      "accepted",
      "declined",
      "duplicate",
    ]);
  });
});

describe("transitionFields", () => {
  const until = new Date("2026-10-01T08:00:00Z");
  const cleared = {
    snoozedUntil: null,
    duplicateOfTaskId: null,
    resolutionNote: null,
  };

  it("sets only the fields of the new status", () => {
    expect(transitionFields("accept")).toEqual({
      ...cleared,
      status: "accepted",
    });
    expect(transitionFields("decline", { note: "No" })).toEqual({
      ...cleared,
      status: "declined",
      resolutionNote: "No",
    });
    expect(transitionFields("snooze", { snoozedUntil: until })).toEqual({
      ...cleared,
      status: "snoozed",
      snoozedUntil: until,
    });
    expect(
      transitionFields("duplicate", { duplicateOfTaskId: "t1", note: "Same" }),
    ).toEqual({
      status: "duplicate",
      snoozedUntil: null,
      duplicateOfTaskId: "t1",
      resolutionNote: "Same",
    });
    expect(transitionFields("unsnooze")).toEqual({
      ...cleared,
      status: "pending",
    });
    expect(transitionFields("reopen")).toEqual({
      ...cleared,
      status: "pending",
    });
  });

  it("normalizes notes", () => {
    expect(normalizeNote("  Out of scope  ")).toBe("Out of scope");
    expect(normalizeNote("   ")).toBeNull();
    expect(normalizeNote(undefined)).toBeNull();
  });
});
