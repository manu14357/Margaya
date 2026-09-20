import { describe, expect, it } from "vitest";
import { PLANNED_COLUMN_ID } from "@/lib/cycle/scope";
import type { ProjectWithTasks } from "@/types/project";
import type Task from "@/types/task";
import { scopeProjectToModule } from "./scope";

function task(id: string, status = "to-do"): Task {
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
        tasks: [task("a"), task("b"), task("c")],
      },
      {
        id: "done",
        slug: "done",
        name: "Done",
        icon: null,
        group: "completed",
        isFinal: true,
        tasks: [task("d", "done")],
      },
    ],
    archivedTasks: [task("e", "archived")],
    plannedTasks,
  } as unknown as ProjectWithTasks;
}

const columnTasks = (scoped: ProjectWithTasks) =>
  scoped.columns.map((column) => [
    column.id,
    column.tasks.map((entry) => entry.id),
  ]);

describe("scopeProjectToModule", () => {
  it("keeps only the module's tasks in each column", () => {
    const scoped = scopeProjectToModule(
      project([]),
      new Set(["a", "d", "e"]),
      "Backlog",
    );
    expect(columnTasks(scoped)).toEqual([
      ["to-do", ["a"]],
      ["done", ["d"]],
    ]);
  });

  it("adds the backlog column only when planned tasks are in the module", () => {
    const withPlanned = scopeProjectToModule(
      project([task("p1", "planned"), task("p2", "planned")]),
      new Set(["a", "p2"]),
      "Backlog",
    );
    expect(withPlanned.columns[0]).toMatchObject({
      id: PLANNED_COLUMN_ID,
      name: "Backlog",
      group: "backlog",
    });
    expect(withPlanned.columns[0].tasks.map((entry) => entry.id)).toEqual([
      "p2",
    ]);
    expect(withPlanned.plannedTasks.map((entry) => entry.id)).toEqual(["p2"]);

    const withoutPlanned = scopeProjectToModule(
      project([task("p1", "planned")]),
      new Set(["a"]),
      "Backlog",
    );
    expect(withoutPlanned.columns.map((column) => column.id)).toEqual([
      "to-do",
      "done",
    ]);
  });

  it("drops archived tasks and handles a module without tasks", () => {
    const scoped = scopeProjectToModule(project([]), new Set(["e"]), "Backlog");
    expect(scoped.archivedTasks).toEqual([]);
    expect(columnTasks(scoped)).toEqual([
      ["to-do", []],
      ["done", []],
    ]);
    expect(
      scopeProjectToModule(project([]), undefined, "Backlog").columns.flatMap(
        (column) => column.tasks,
      ),
    ).toEqual([]);
  });
});
