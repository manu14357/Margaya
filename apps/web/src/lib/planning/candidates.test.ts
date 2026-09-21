import { describe, expect, it } from "vitest";
import type { ProjectWithTasks } from "@/types/project";
import type Task from "@/types/task";
import { searchCandidates, taskCandidates } from "./candidates";

function task(id: string, number: number, cycleId: string | null): Task {
  return {
    id,
    title: `Task ${id}`,
    number,
    description: null,
    status: "to-do",
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

const board = {
  id: "p1",
  name: "Project",
  slug: "WEB",
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
      tasks: [task("b", 7, null), task("a", 3, null), task("c", 9, "c1")],
    },
  ],
  archivedTasks: [],
  plannedTasks: [task("p", 12, null), task("q", 1, "c2")],
} satisfies ProjectWithTasks;

const inNoCycle = (candidate: Task) => !candidate.cycleId;

describe("taskCandidates", () => {
  it("offers the tasks that pass the test, planned first, then by number", () => {
    expect(taskCandidates(board, inNoCycle).map((c) => c.key)).toEqual([
      "WEB-12",
      "WEB-3",
      "WEB-7",
    ]);
    expect(taskCandidates(null, inNoCycle)).toEqual([]);
  });

  it("uses the caller's test, such as not being in a module yet", () => {
    const inModule = new Set(["b", "p"]);
    expect(
      taskCandidates(board, (candidate) => !inModule.has(candidate.id)).map(
        (c) => c.task.id,
      ),
    ).toEqual(["q", "a", "c"]);
  });

  it("keeps the column of each task, and planned for planned tasks", () => {
    const [planned, inColumn] = taskCandidates(board, inNoCycle);
    expect(planned?.column).toEqual({
      slug: "planned",
      icon: null,
      group: "backlog",
    });
    expect(inColumn?.column).toEqual({
      slug: "to-do",
      icon: null,
      group: "unstarted",
    });
  });
});

describe("searchCandidates", () => {
  it("searches by key or title", () => {
    const candidates = taskCandidates(board, inNoCycle);
    expect(searchCandidates(candidates, "web-7").map((c) => c.task.id)).toEqual(
      ["b"],
    );
    expect(
      searchCandidates(candidates, "TASK A").map((c) => c.task.id),
    ).toEqual(["a"]);
    expect(searchCandidates(candidates, "  ")).toHaveLength(3);
  });
});
