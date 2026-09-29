import { describe, expect, it } from "vitest";
import type { ProjectWithTasks } from "@/types/project";
import { searchPlan, settleOverrides, splitPlan } from "./cycle-plan-model";

type TaskInit = {
  id: string;
  number: number;
  priority?: string | null;
  cycleId?: string | null;
  archivedAt?: string | null;
};

function task({
  id,
  number,
  priority = null,
  cycleId = null,
  archivedAt,
}: TaskInit) {
  return {
    id,
    number,
    title: `Task ${id}`,
    priority,
    cycleId,
    archivedAt: archivedAt ?? null,
    status: "to-do",
  };
}

function board(
  columns: { slug: string; group: string; tasks: ReturnType<typeof task>[] }[],
  planned: ReturnType<typeof task>[] = [],
) {
  return {
    id: "p1",
    slug: "WEB",
    plannedTasks: planned,
    columns: columns.map((column, position) => ({
      id: column.slug,
      slug: column.slug,
      name: column.slug,
      icon: null,
      group: column.group,
      isFinal: column.group === "completed",
      position,
      tasks: column.tasks,
    })),
  } as unknown as ProjectWithTasks;
}

const project = board(
  [
    {
      slug: "to-do",
      group: "unstarted",
      tasks: [
        task({ id: "low", number: 1, priority: "low" }),
        task({ id: "urgent", number: 2, priority: "urgent" }),
        task({ id: "mine", number: 3, cycleId: "c1" }),
        task({ id: "other", number: 4, cycleId: "c2" }),
        task({ id: "gone", number: 5, archivedAt: "2026-01-01" }),
      ],
    },
    {
      slug: "done",
      group: "completed",
      tasks: [
        task({ id: "finished", number: 6 }),
        task({ id: "shipped", number: 7, cycleId: "c1", priority: "high" }),
      ],
    },
  ],
  [task({ id: "idea", number: 8, priority: "medium" })],
);

const ids = (entries: { task: { id: string } }[]) =>
  entries.map((entry) => entry.task.id);

describe("splitPlan", () => {
  it("offers open, unplanned tasks by priority and lists the cycle's own", () => {
    const { backlog, cycle } = splitPlan(project, "c1", new Map());
    expect(ids(backlog)).toEqual(["urgent", "idea", "low"]);
    expect(ids(cycle)).toEqual(["shipped", "mine"]);
    expect(backlog[0]?.key).toBe("WEB-2");
  });

  it("applies pending moves both ways", () => {
    const { backlog, cycle } = splitPlan(
      project,
      "c1",
      new Map([
        ["low", true],
        ["shipped", false],
      ]),
    );
    expect(ids(cycle)).toEqual(["low", "mine"]);
    expect(ids(backlog)).toEqual(["urgent", "shipped", "idea"]);
  });
});

describe("settleOverrides", () => {
  it("drops the moves the board already shows", () => {
    const next = settleOverrides(
      project,
      "c1",
      new Map([
        ["mine", true],
        ["low", true],
      ]),
    );
    expect([...next.keys()]).toEqual(["low"]);
  });
});

describe("searchPlan", () => {
  it("matches the key or the title", () => {
    const { backlog } = splitPlan(project, "c1", new Map());
    expect(ids(searchPlan(backlog, "web-8"))).toEqual(["idea"]);
    expect(ids(searchPlan(backlog, "task low"))).toEqual(["low"]);
  });
});
