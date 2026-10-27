import { describe, expect, it } from "vitest";
import {
  computeRisks,
  type RiskInput,
  type RiskTask,
} from "../../../apps/api/src/delivery/risk-signals";

const NOW = new Date("2026-10-21T12:00:00Z");
const TODAY = "2026-10-21";
const DAY_MS = 86_400_000;

function task(id: string, overrides: Partial<RiskTask> = {}): RiskTask {
  return {
    id,
    group: "unstarted",
    dueDay: null,
    assigneeIds: ["u1"],
    startedAt: null,
    hidden: false,
    ...overrides,
  };
}

function input(
  tasks: RiskTask[],
  overrides: Partial<RiskInput> = {},
): RiskInput {
  return {
    today: TODAY,
    now: NOW,
    endDate: null,
    scopeIds: tasks.filter((t) => !t.hidden).map((t) => t.id),
    tasks: new Map(tasks.map((t) => [t.id, t])),
    blockEdges: [],
    finishEdges: [],
    cycleTime: { samples: 0, p50Days: null, p85Days: null },
    ...overrides,
  };
}

const kinds = (result: ReturnType<typeof computeRisks>) =>
  result.signals.map((signal) => signal.kind);

describe("computeRisks", () => {
  it("finds nothing in a calm scope", () => {
    const result = computeRisks(input([task("a"), task("b")]));
    expect(result.signals).toEqual([]);
    expect(result.criticalPath).toBeNull();
  });

  it("flags a blocked chain, high when its head is unassigned", () => {
    const tasks = [task("h", { assigneeIds: [] }), task("a"), task("b")];
    const result = computeRisks(
      input(tasks, {
        blockEdges: [
          { from: "h", to: "a" },
          { from: "a", to: "b" },
        ],
      }),
    );
    const chain = result.signals.find((s) => s.kind === "blocked_chain");
    expect(chain).toMatchObject({
      severity: "high",
      headTaskId: "h",
      taskIds: ["a", "b"],
      depth: 2,
    });
  });

  it("never names a hidden blocker", () => {
    const tasks = [task("secret", { hidden: true }), task("a")];
    const result = computeRisks(
      input(tasks, { blockEdges: [{ from: "secret", to: "a" }] }),
    );
    const chain = result.signals.find((s) => s.kind === "blocked_chain");
    expect(chain?.headTaskId).toBeNull();
    expect(chain?.taskIds).toEqual(["a"]);
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("flags a critical path that misses the end date", () => {
    const tasks = [task("a"), task("b"), task("c")];
    const result = computeRisks(
      input(tasks, {
        endDate: "2026-10-25",
        blockEdges: [{ from: "a", to: "b" }],
        finishEdges: [{ from: "b", to: "c" }],
        cycleTime: { samples: 12, p50Days: 2, p85Days: 4 },
      }),
    );
    expect(result.criticalPath).toMatchObject({
      taskIds: ["a", "b", "c"],
      total: 6,
      unit: "days",
      finishDate: "2026-10-26",
      slackDays: -1,
    });
    expect(result.signals[0]).toMatchObject({
      kind: "critical_path",
      severity: "high",
    });
  });

  it("counts tasks, not days, without cycle-time history", () => {
    const result = computeRisks(
      input([task("a"), task("b")], {
        endDate: "2026-10-22",
        blockEdges: [{ from: "a", to: "b" }],
      }),
    );
    expect(result.criticalPath).toMatchObject({
      unit: "tasks",
      total: 2,
      finishDate: null,
      slackDays: null,
    });
    expect(kinds(result)).not.toContain("critical_path");
  });

  it("flags ageing work past the p85 cycle time", () => {
    const tasks = [
      task("old", {
        group: "started",
        startedAt: new Date(NOW.getTime() - 20 * DAY_MS),
      }),
      task("slow", {
        group: "started",
        startedAt: new Date(NOW.getTime() - 7 * DAY_MS),
      }),
      task("fresh", {
        group: "started",
        startedAt: new Date(NOW.getTime() - 1 * DAY_MS),
      }),
    ];
    const result = computeRisks(
      input(tasks, { cycleTime: { samples: 10, p50Days: 3, p85Days: 5 } }),
    );
    expect(result.signals.find((s) => s.kind === "ageing")).toMatchObject({
      severity: "high",
      taskIds: ["old", "slow"],
      ageDays: 20,
      thresholdDays: 5,
    });
  });

  it("skips ageing with too few cycle-time samples", () => {
    const result = computeRisks(
      input(
        [
          task("old", {
            group: "started",
            startedAt: new Date(NOW.getTime() - 50 * DAY_MS),
          }),
        ],
        { cycleTime: { samples: 9, p50Days: 1, p85Days: 2 } },
      ),
    );
    expect(kinds(result)).not.toContain("ageing");
  });

  it("clusters overdue work by first assignee", () => {
    const due = (id: string, assignee: string) =>
      task(id, {
        dueDay: "2026-10-10",
        assigneeIds: assignee ? [assignee] : [],
      });
    const result = computeRisks(
      input([
        due("a1", "ana"),
        due("a2", "ana"),
        due("a3", "ana"),
        due("b1", "bo"),
        task("future", { dueDay: "2026-11-30" }),
      ]),
    );
    expect(
      result.signals.find((s) => s.kind === "overdue_cluster"),
    ).toMatchObject({ severity: "medium", assigneeId: "ana", total: 3 });
    expect(result.signals.find((s) => s.kind === "overdue")).toMatchObject({
      severity: "low",
      taskIds: ["b1"],
    });
  });

  it("flags unassigned work close to its deadline", () => {
    const result = computeRisks(
      input(
        [
          task("soon", { assigneeIds: [], dueDay: "2026-10-22" }),
          task("byEnd", { assigneeIds: [] }),
          task("later", { assigneeIds: [], dueDay: "2026-12-01" }),
          task("owned", { dueDay: "2026-10-22" }),
        ],
        { endDate: "2026-10-23" },
      ),
    );
    const signal = result.signals.find(
      (s) => s.kind === "unassigned_near_deadline",
    );
    expect(signal).toMatchObject({
      severity: "high",
      taskIds: ["soon", "byEnd", "later"],
      deadline: "2026-10-22",
    });
  });

  it("reports dependency loops from older data", () => {
    const result = computeRisks(
      input([task("a"), task("b")], {
        blockEdges: [
          { from: "a", to: "b" },
          { from: "b", to: "a" },
        ],
      }),
    );
    expect(
      result.signals.find((s) => s.kind === "dependency_loop"),
    ).toMatchObject({ taskIds: ["a", "b"] });
  });

  it("orders signals by severity, then size", () => {
    const result = computeRisks(
      input(
        [
          task("x", { dueDay: "2026-10-01" }),
          task("soon", { assigneeIds: [], dueDay: "2026-10-21" }),
        ],
        {},
      ),
    );
    expect(kinds(result)).toEqual(["unassigned_near_deadline", "overdue"]);
  });
});
