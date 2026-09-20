import { describe, expect, it } from "vitest";
import type { ProjectWithTasks } from "@/types/project";
import type Task from "@/types/task";
import {
  cycleTasksOf,
  highPriorityCycleTasks,
  PLANNED_COLUMN_ID,
  scopeProjectToCycle,
} from "./scope";

function task(id: string, cycleId: string | null, status = "to-do"): Task {
  return {
    id,
    title: id,
    number: 1,
    description: null,
    status,
    priority: "no-priority",
    startDate: null,
    dueDate: null,
    position: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    userId: null,
    assigneeId: null,
    assigneeName: null,
    projectId: "p1",
    cycleId,
  };
}

function project(plannedTasks: Task[]): ProjectWithTasks {
  return {
    id: "p1",
    name: "Project",
    slug: "PRJ",
    icon: null,
    description: null,
    isPublic: false,
    workspaceId: "w1",
    columns: [
      {
        id: "to-do",
        slug: "to-do",
        name: "To Do",
        icon: null,
        group: "unstarted",
        isFinal: false,
        tasks: [task("a", "c1"), task("b", "c2"), task("c", null)],
      },
      {
        id: "done",
        slug: "done",
        name: "Done",
        icon: null,
        group: "completed",
        isFinal: true,
        tasks: [task("d", "c1", "done")],
      },
    ],
    archivedTasks: [task("e", "c1", "archived")],
    plannedTasks,
  };
}

describe("scopeProjectToCycle", () => {
  it("keeps only the cycle's tasks in every column", () => {
    const scoped = scopeProjectToCycle(project([]), "c1", "Backlog");
    expect(scoped.columns.map((column) => column.id)).toEqual([
      "to-do",
      "done",
    ]);
    expect(scoped.columns[0].tasks.map((t) => t.id)).toEqual(["a"]);
    expect(scoped.columns[1].tasks.map((t) => t.id)).toEqual(["d"]);
    expect(cycleTasksOf(scoped).map((t) => t.id)).toEqual(["a", "d"]);
  });

  it("adds a backlog column only when the cycle has planned tasks", () => {
    const withPlanned = scopeProjectToCycle(
      project([task("p", "c1", "planned"), task("q", "c2", "planned")]),
      "c1",
      "Backlog",
    );
    expect(withPlanned.columns[0]).toMatchObject({
      id: PLANNED_COLUMN_ID,
      slug: PLANNED_COLUMN_ID,
      name: "Backlog",
      group: "backlog",
      isFinal: false,
    });
    expect(withPlanned.columns[0].tasks.map((t) => t.id)).toEqual(["p"]);

    const withoutPlanned = scopeProjectToCycle(
      project([task("q", "c2", "planned")]),
      "c1",
      "Backlog",
    );
    expect(withoutPlanned.columns.map((column) => column.id)).toEqual([
      "to-do",
      "done",
    ]);
  });

  it("is stable when applied to an already scoped board", () => {
    const once = scopeProjectToCycle(
      project([task("p", "c1", "planned")]),
      "c1",
      "Backlog",
    );
    // A drag moved a task into the synthetic column before the refetch.
    once.columns[0].tasks = [
      ...once.columns[0].tasks,
      task("a2", "c1", "planned"),
    ];
    const twice = scopeProjectToCycle(once, "c1", "Backlog");
    expect(twice.columns.map((column) => column.id)).toEqual([
      PLANNED_COLUMN_ID,
      "to-do",
      "done",
    ]);
    expect(twice.columns[0].tasks.map((t) => t.id)).toEqual(["p", "a2"]);
  });

  it("empties the archived tasks", () => {
    expect(
      scopeProjectToCycle(project([]), "c1", "Backlog").archivedTasks,
    ).toEqual([]);
  });
});

describe("highPriorityCycleTasks", () => {
  it("lists open urgent and high tasks of the cycle, urgent first", () => {
    const board = project([
      { ...task("p", "c1", "planned"), priority: "high" },
    ]);
    board.columns[0].tasks = [
      { ...task("h", "c1"), priority: "high" },
      { ...task("u", "c1"), priority: "urgent" },
      { ...task("m", "c1"), priority: "medium" },
      { ...task("x", "c2"), priority: "urgent" },
    ];
    board.columns[1].tasks = [
      { ...task("d", "c1", "done"), priority: "urgent" },
    ];
    expect(highPriorityCycleTasks(board, "c1").map((t) => t.id)).toEqual([
      "u",
      "p",
      "h",
    ]);
    expect(highPriorityCycleTasks(board, "c1", 1).map((t) => t.id)).toEqual([
      "u",
    ]);
  });
});
