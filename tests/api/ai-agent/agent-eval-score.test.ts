import { describe, expect, it } from "vitest";
import {
  diffSnapshots,
  reliability,
  scoreDiff,
} from "../../api-integration/helpers/agent-eval-score";

const before = {
  task: {
    t1: { title: "A", status: "to-do", priority: "low" },
    t2: { title: "B", status: "done", priority: "low" },
  },
  cycle_task: { t1: { cycleId: "c1" } },
};

describe("agent eval scoring", () => {
  it("diffs added, removed and changed rows in a stable order", () => {
    const after = {
      task: {
        t1: { title: "A", status: "in-progress", priority: "low" },
        t3: { title: "C", status: "to-do", priority: "low" },
      },
      cycle_task: { t1: { cycleId: "c1" } },
    };
    expect(diffSnapshots(before, after)).toEqual([
      {
        table: "task",
        key: "t1",
        kind: "changed",
        before: before.task.t1,
        after: after.task.t1,
        fields: ["status"],
      },
      { table: "task", key: "t2", kind: "removed", before: before.task.t2 },
      { table: "task", key: "t3", kind: "added", after: after.task.t3 },
    ]);
    expect(diffSnapshots(before, before)).toEqual([]);
  });

  it("passes only an exact match: nothing missing, nothing extra", () => {
    const after = {
      ...before,
      task: {
        ...before.task,
        t1: { title: "A", status: "in-progress", priority: "urgent" },
      },
    };
    const diff = diffSnapshots(before, after);
    const statusOnly = scoreDiff(diff, [
      { table: "task", kind: "changed", key: "t1", fields: ["status"] },
    ]);
    expect(statusOnly.pass).toBe(false);
    expect(statusOnly.missing).toHaveLength(1);
    expect(
      scoreDiff(diff, [
        {
          table: "task",
          kind: "changed",
          key: "t1",
          fields: ["priority", "status"],
          before: { status: "to-do" },
          where: { status: "in-progress", priority: "urgent" },
        },
      ]).pass,
    ).toBe(true);
    // An unexpected change fails even when every expectation is met.
    const extra = scoreDiff(diff, []);
    expect(extra.pass).toBe(false);
    expect(extra.unexpected).toHaveLength(1);
  });

  it("measures pass@1 and pass^k", () => {
    expect(reliability([true, true, true])).toEqual({
      k: 3,
      passes: 3,
      passAt1: 1,
      passHatK: true,
    });
    expect(reliability([true, false, true])).toMatchObject({
      passes: 2,
      passHatK: false,
    });
    expect(reliability([]).passHatK).toBe(false);
  });
});
