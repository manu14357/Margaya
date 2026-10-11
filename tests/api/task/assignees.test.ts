import { HTTPException } from "hono/http-exception";
import { describe, expect, it } from "vitest";
import { userReminderType } from "../../../apps/api/src/scheduler/reminder-timing";
import {
  ADD_AND_REMOVE_CONFLICT,
  type AssigneeSlot,
  assertAssigneeLimit,
  MAX_TASK_ASSIGNEES,
  NOTHING_TO_CHANGE,
  normalizeAssigneeIds,
  patchTarget,
  planAssigneeChange,
  resolveCreateAssignees,
  resolveFullUpdateAssignees,
  resolveLegacyAssignee,
  resolvePatchAssignees,
  sameAssigneeSet,
  TOO_MANY_ASSIGNEES,
} from "../../../apps/api/src/task/assignee-rules";

function ids(count: number, prefix = "u") {
  return Array.from({ length: count }, (_, i) => `${prefix}${i}`);
}

function expectHttpError(run: () => unknown, status: number, message: string) {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(HTTPException);
    expect((error as HTTPException).status).toBe(status);
    expect((error as HTTPException).message).toBe(message);
    return;
  }
  throw new Error("expected an HTTPException");
}

function slots(...entries: Array<[string, number]>): AssigneeSlot[] {
  return entries.map(([userId, position]) => ({ userId, position }));
}

describe("normalizeAssigneeIds", () => {
  it("trims, drops blanks and keeps the first of duplicates", () => {
    expect(normalizeAssigneeIds([" b ", "a", "", "  ", "b", "a", "c"])).toEqual(
      ["b", "a", "c"],
    );
    expect(normalizeAssigneeIds(undefined)).toEqual([]);
    expect(normalizeAssigneeIds(null)).toEqual([]);
  });

  it("accepts the limit and rejects one more after de-duplicating", () => {
    expect(normalizeAssigneeIds(ids(MAX_TASK_ASSIGNEES))).toHaveLength(20);
    // 25 entries that de-duplicate to 20 are fine.
    expect(
      normalizeAssigneeIds([...ids(20), "u0", "u1", "u2", " u3", "u4 "]),
    ).toHaveLength(20);
    expectHttpError(
      () => normalizeAssigneeIds(ids(21)),
      400,
      TOO_MANY_ASSIGNEES,
    );
    expect(TOO_MANY_ASSIGNEES).toBe("A task can have at most 20 assignees");
  });
});

describe("resolveCreateAssignees", () => {
  it("prefers assigneeIds, even empty, over userId", () => {
    expect(
      resolveCreateAssignees({ assigneeIds: ["a", "b"], userId: "c" }),
    ).toEqual(["a", "b"]);
    expect(resolveCreateAssignees({ assigneeIds: [], userId: "c" })).toEqual(
      [],
    );
  });

  it("falls back to the single userId, trimmed", () => {
    expect(resolveCreateAssignees({ userId: " c " })).toEqual(["c"]);
    expect(resolveCreateAssignees({ assigneeIds: null, userId: "c" })).toEqual([
      "c",
    ]);
    expect(resolveCreateAssignees({ userId: "   " })).toEqual([]);
    expect(resolveCreateAssignees({})).toEqual([]);
  });
});

describe("resolveFullUpdateAssignees", () => {
  const current = ["a", "b"];

  it("uses assigneeIds and ignores userId", () => {
    expect(
      resolveFullUpdateAssignees({ assigneeIds: ["c"], userId: "a", current }),
    ).toEqual(["c"]);
    expect(
      resolveFullUpdateAssignees({ assigneeIds: [], userId: "a", current }),
    ).toEqual([]);
  });

  it("keeps everyone when userId echoes the first assignee", () => {
    expect(resolveFullUpdateAssignees({ userId: "a", current })).toBeNull();
    expect(resolveFullUpdateAssignees({ userId: " a ", current })).toBeNull();
  });

  it("replaces everyone with another userId (legacy reassign)", () => {
    expect(resolveFullUpdateAssignees({ userId: "b", current })).toEqual(["b"]);
    expect(resolveFullUpdateAssignees({ userId: "z", current })).toEqual(["z"]);
  });

  it("clears when userId is absent or blank", () => {
    expect(resolveFullUpdateAssignees({ current })).toEqual([]);
    expect(resolveFullUpdateAssignees({ userId: "", current })).toEqual([]);
    expect(resolveFullUpdateAssignees({ userId: "", current: [] })).toEqual([]);
  });

  it("treats the same people in another order as no change", () => {
    const target = resolveFullUpdateAssignees({
      assigneeIds: ["b", "a"],
      current,
    });
    expect(target).toEqual(["b", "a"]);
    expect(sameAssigneeSet(target ?? [], current)).toBe(true);
    expect(sameAssigneeSet(["a"], current)).toBe(false);
    expect(sameAssigneeSet(["a", "c"], current)).toBe(false);
    expect(sameAssigneeSet([], [])).toBe(true);
  });
});

describe("resolveLegacyAssignee", () => {
  it("replaces with one user or clears", () => {
    expect(resolveLegacyAssignee(" x ")).toEqual(["x"]);
    expect(resolveLegacyAssignee(null)).toEqual([]);
    expect(resolveLegacyAssignee("  ")).toEqual([]);
    expect(resolveLegacyAssignee(undefined)).toEqual([]);
  });
});

describe("resolvePatchAssignees and patchTarget", () => {
  it("normalizes both lists", () => {
    expect(resolvePatchAssignees({ add: [" c", "c"], remove: ["a "] })).toEqual(
      { add: ["c"], remove: ["a"] },
    );
    expect(resolvePatchAssignees({ remove: ["a"] })).toEqual({
      add: [],
      remove: ["a"],
    });
  });

  it("rejects an empty request and a user in both lists", () => {
    expectHttpError(() => resolvePatchAssignees({}), 400, NOTHING_TO_CHANGE);
    expectHttpError(
      () => resolvePatchAssignees({ add: [" "], remove: [] }),
      400,
      NOTHING_TO_CHANGE,
    );
    expectHttpError(
      () => resolvePatchAssignees({ add: ["a"], remove: [" a"] }),
      400,
      ADD_AND_REMOVE_CONFLICT,
    );
  });

  it("removes first, then appends in request order", () => {
    expect(
      patchTarget(["a", "b", "c"], { add: ["d", "a"], remove: ["a"] }),
    ).toEqual(["b", "c", "d", "a"]);
  });
});

describe("planAssigneeChange", () => {
  it("numbers a new list from 0 in request order", () => {
    const plan = planAssigneeChange([], ["a", "b", "c"]);
    expect(plan.insert).toEqual(slots(["a", 0], ["b", 1], ["c", 2]));
    expect(plan).toMatchObject({
      added: ["a", "b", "c"],
      removed: [],
      after: ["a", "b", "c"],
      firstBefore: null,
      firstAfter: "a",
      changed: true,
    });
  });

  it("appends after the highest position and skips people already there", () => {
    const plan = planAssigneeChange(slots(["a", 0], ["b", 1]), [
      "a",
      "b",
      "c",
      "a",
    ]);
    expect(plan.added).toEqual(["c"]);
    expect(plan.insert).toEqual(slots(["c", 2]));
    expect(plan.after).toEqual(["a", "b", "c"]);
  });

  it("promotes the next assignee when the first is removed", () => {
    const plan = planAssigneeChange(slots(["a", 0], ["b", 1], ["c", 2]), [
      "b",
      "c",
    ]);
    expect(plan).toMatchObject({
      added: [],
      removed: ["a"],
      insert: [],
      after: ["b", "c"],
      firstBefore: "a",
      firstAfter: "b",
      changed: true,
    });
  });

  it("keeps the order of people who stay, whatever the request order", () => {
    // [B1, C2, D3] set [C, E, B] -> [B1, C2, E4]
    const plan = planAssigneeChange(slots(["b", 1], ["c", 2], ["d", 3]), [
      "c",
      "e",
      "b",
    ]);
    expect(plan.removed).toEqual(["d"]);
    expect(plan.insert).toEqual(slots(["e", 4]));
    expect(plan.after).toEqual(["b", "c", "e"]);
    expect(plan.firstAfter).toBe("b");
  });

  it("replaces with one person and clears", () => {
    const current = slots(["a", 0], ["b", 1]);
    expect(planAssigneeChange(current, ["b"])).toMatchObject({
      removed: ["a"],
      added: [],
      after: ["b"],
      firstAfter: "b",
    });
    expect(planAssigneeChange(current, [])).toMatchObject({
      removed: ["a", "b"],
      after: [],
      firstAfter: null,
      changed: true,
    });
  });

  it("reports no change for the same people in another order", () => {
    const plan = planAssigneeChange(slots(["a", 0], ["b", 5]), ["b", "a"]);
    expect(plan.changed).toBe(false);
    expect(plan.after).toEqual(["a", "b"]);
    expect(plan.insert).toEqual([]);
  });
});

describe("assertAssigneeLimit", () => {
  it("refuses an addition past the limit", () => {
    const full = slots(...ids(20).map((id, i): [string, number] => [id, i]));
    expectHttpError(
      () =>
        assertAssigneeLimit(planAssigneeChange(full, [...ids(20), "extra"])),
      400,
      TOO_MANY_ASSIGNEES,
    );
    expect(() =>
      assertAssigneeLimit(planAssigneeChange(full, ids(20))),
    ).not.toThrow();
  });

  it("always allows removals, even from an oversized list", () => {
    const oversized = slots(
      ...ids(22).map((id, i): [string, number] => [id, i]),
    );
    expect(() =>
      assertAssigneeLimit(planAssigneeChange(oversized, ids(21))),
    ).not.toThrow();
  });
});

describe("userReminderType", () => {
  it("encodes the user in the reminder type", () => {
    expect(userReminderType("configured_before", "u1")).toBe(
      "configured_before:user:u1",
    );
    expect(userReminderType("overdue", "u2")).toBe("overdue:user:u2");
  });
});
