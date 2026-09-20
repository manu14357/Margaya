import { IterationCw } from "lucide-react";
import { describe, expect, it } from "vitest";
import { withTaskCycle } from "@/hooks/mutations/cycle/use-set-task-cycle";
import type { ProjectWithTasks } from "@/types/project";
import type Task from "@/types/task";
import { cycleEntityLink } from "./entity-link";

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

describe("withTaskCycle", () => {
  it("changes one task's cycle wherever it sits on the board", () => {
    const next = withTaskCycle(board, "p", "c9");
    expect(next.plannedTasks?.find((t) => t.id === "p")?.cycleId).toBe("c9");
    const moved = withTaskCycle(board, "c", null);
    expect(moved.columns?.[0].tasks.find((t) => t.id === "c")?.cycleId).toBe(
      null,
    );
    expect(board.columns[0].tasks[2].cycleId).toBe("c1");
  });
});

describe("cycleEntityLink", () => {
  it("opens a cycle on its page with the cycle icon", () => {
    const entity = { type: "cycle", id: "c1", icon: null, projectId: "p1" };
    expect(cycleEntityLink.path(entity, "w1")).toBe(
      "/dashboard/workspace/w1/project/p1/cycles/c1",
    );
    expect(
      cycleEntityLink.path({ ...entity, projectId: null }, "w1"),
    ).toBeNull();
    expect(cycleEntityLink.icon(entity)).toBe(IterationCw);
  });
});
