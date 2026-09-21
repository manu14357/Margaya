import { describe, expect, it } from "vitest";
import type Task from "@/types/task";
import { sortTasks } from "./sort-tasks";

function task(id: string, estimatePointId: string | null): Task {
  return {
    id,
    title: id,
    number: null,
    description: null,
    status: "to-do",
    priority: null,
    startDate: null,
    dueDate: null,
    position: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    userId: null,
    assigneeId: null,
    assigneeName: null,
    projectId: "project-1",
    estimatePointId,
  };
}

const tasks = [
  task("m", "p2"),
  task("none", null),
  task("s", "p1"),
  task("l", "p3"),
];

const estimatePointsById = new Map([
  ["p1", { position: 1 }],
  ["p2", { position: 2 }],
  ["p3", { position: 3 }],
]);

const ids = (sorted: Task[]) => sorted.map((entry) => entry.id);

describe("sortTasks by estimate", () => {
  it("sorts by the active system's order, unestimated last", () => {
    expect(
      ids(
        sortTasks(
          tasks,
          { field: "estimate", direction: "asc" },
          { estimatePointsById },
        ),
      ),
    ).toEqual(["s", "m", "l", "none"]);
    expect(
      ids(
        sortTasks(
          tasks,
          { field: "estimate", direction: "desc" },
          { estimatePointsById },
        ),
      ),
    ).toEqual(["l", "m", "s", "none"]);
  });

  it("keeps position order without the estimate context", () => {
    expect(
      ids(sortTasks(tasks, { field: "estimate", direction: "desc" })),
    ).toEqual(["m", "none", "s", "l"]);
  });

  it("leaves the other fields alone", () => {
    expect(
      ids(sortTasks(tasks, { field: "title", direction: "asc" }, {})),
    ).toEqual(["l", "m", "none", "s"]);
  });
});
