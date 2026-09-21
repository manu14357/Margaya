import { describe, expect, it } from "vitest";
import type Task from "@/types/task";
import { filterProjectByIds, matchesTextQuery } from "./classic";

function task(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    title: `Task ${id}`,
    number: 7,
    description: null,
    status: "to-do",
    priority: null,
    startDate: null,
    dueDate: null,
    position: 0,
    createdAt: "2026-01-01",
    userId: null,
    assigneeId: null,
    assigneeName: null,
    projectId: "p1",
    ...overrides,
  };
}

describe("classic board filtering", () => {
  it("keeps only the matching ids in columns, planned and archived", () => {
    const project = {
      columns: [{ id: "to-do", tasks: [task("a"), task("b")] }],
      plannedTasks: [task("c")],
      archivedTasks: [task("d")],
    } as never;
    const filtered = filterProjectByIds(project, new Set(["a", "d"])) as {
      columns: Array<{ tasks: Task[] }>;
      plannedTasks: Task[];
      archivedTasks: Task[];
    };
    expect(filtered.columns[0]?.tasks.map((t) => t.id)).toEqual(["a"]);
    expect(filtered.plannedTasks).toEqual([]);
    expect(filtered.archivedTasks.map((t) => t.id)).toEqual(["d"]);
  });

  it("keeps everything without ids", () => {
    const project = { columns: [{ id: "x", tasks: [task("a")] }] } as never;
    const filtered = filterProjectByIds(project, null) as {
      columns: Array<{ tasks: Task[] }>;
    };
    expect(filtered.columns[0]?.tasks).toHaveLength(1);
  });

  it("matches the text search by title, key and description matches", () => {
    const item = task("a", { title: "Fix login" });
    expect(matchesTextQuery(item, "login", "WEB")).toBe(true);
    expect(matchesTextQuery(item, "web-7", "WEB")).toBe(true);
    expect(matchesTextQuery(item, "#7", "WEB")).toBe(true);
    expect(matchesTextQuery(item, "billing", "WEB")).toBe(false);
    expect(matchesTextQuery(item, "billing", "WEB", new Set(["a"]))).toBe(true);
    expect(matchesTextQuery(item, "  ", "WEB")).toBe(true);
  });
});
