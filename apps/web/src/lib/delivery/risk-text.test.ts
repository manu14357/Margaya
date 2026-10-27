import { describe, expect, it } from "vitest";
import type { RiskSignal, RiskTaskRef } from "@/types/delivery";
import { signalText, taskLabel } from "./risk-text";

const head: RiskTaskRef = {
  id: "t1",
  projectId: "p1",
  projectSlug: "web",
  number: 7,
  title: "Set up CI",
  status: "to-do",
  dueDate: null,
  assigneeIds: [],
};

const context = {
  tasks: new Map([[head.id, head]]),
  personName: (id: string) => (id === "u1" ? "Ana" : null),
  formatDay: (day: string) => `day(${day})`,
  hiddenTaskLabel: "hidden",
  someoneLabel: "someone",
};

function signal(overrides: Partial<RiskSignal>): RiskSignal {
  return {
    kind: "overdue",
    severity: "low",
    taskIds: [],
    total: 1,
    ...overrides,
  } as RiskSignal;
}

describe("signalText", () => {
  it("names the head of a blocked chain, or hides it", () => {
    expect(
      signalText(
        signal({ kind: "blocked_chain", headTaskId: "t1", total: 3 }),
        context,
      ),
    ).toEqual({
      key: "delivery:risks.kinds.blocked_chain",
      options: { count: 3, head: "WEB-7" },
    });
    expect(
      signalText(signal({ kind: "blocked_chain", headTaskId: null }), context)
        .options.head,
    ).toBe("hidden");
  });

  it("words the critical path by severity with its dates", () => {
    expect(
      signalText(
        signal({
          kind: "critical_path",
          severity: "high",
          deadline: "2026-10-25",
          finishDate: "2026-10-27",
        }),
        context,
      ),
    ).toEqual({
      key: "delivery:risks.kinds.critical_path_late",
      options: { date: "day(2026-10-27)", deadline: "day(2026-10-25)" },
    });
    expect(
      signalText(signal({ kind: "critical_path", severity: "medium" }), {
        ...context,
        criticalFinish: "2026-10-24",
      }),
    ).toMatchObject({
      key: "delivery:risks.kinds.critical_path_tight",
      options: { date: "day(2026-10-24)" },
    });
  });

  it("names the assignee of an overdue cluster", () => {
    expect(
      signalText(
        signal({ kind: "overdue_cluster", assigneeId: "u1", total: 4 }),
        context,
      ),
    ).toEqual({
      key: "delivery:risks.kinds.overdue_cluster",
      options: { count: 4, name: "Ana" },
    });
    expect(
      signalText(
        signal({ kind: "overdue_cluster", assigneeId: "gone" }),
        context,
      ).options.name,
    ).toBe("someone");
    expect(
      signalText(signal({ kind: "overdue_cluster", assigneeId: null }), context)
        .key,
    ).toBe("delivery:risks.kinds.overdue_cluster_unassigned");
  });

  it("rounds the ageing threshold to whole days, at least one", () => {
    expect(
      signalText(signal({ kind: "ageing", thresholdDays: 4.6 }), context)
        .options.days,
    ).toBe(5);
    expect(
      signalText(signal({ kind: "ageing", thresholdDays: 0.2 }), context)
        .options.days,
    ).toBe(1);
  });

  it("formats the deadline of unassigned work", () => {
    expect(
      signalText(
        signal({ kind: "unassigned_near_deadline", deadline: "2026-10-22" }),
        context,
      ).options.date,
    ).toBe("day(2026-10-22)");
  });

  it("labels tasks by their key", () => {
    expect(taskLabel(head)).toBe("WEB-7");
  });
});
