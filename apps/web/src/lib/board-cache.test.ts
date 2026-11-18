import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProjectWithTasks } from "@/types/project";
import type Task from "@/types/task";
import {
  boardFieldsOf,
  patchBoardTask,
  resetBoardCacheState,
  scheduleBoardRefresh,
  startBoardEdit,
  withLocalBoardEdits,
} from "./board-cache";

function task(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    title: id,
    number: 1,
    description: null,
    status: "to-do",
    priority: "low",
    startDate: null,
    dueDate: null,
    position: 0,
    createdAt: "2026-11-01T00:00:00.000Z",
    userId: null,
    assigneeId: null,
    assigneeName: null,
    projectId: "p1",
    archivedAt: null,
    ...overrides,
  };
}

function board(): ProjectWithTasks {
  return {
    id: "p1",
    name: "P",
    slug: "P",
    icon: null,
    description: null,
    isPublic: false,
    workspaceId: "w1",
    columns: [
      {
        id: "to-do",
        slug: "to-do",
        name: "To do",
        icon: null,
        group: "unstarted",
        isFinal: false,
        position: 0,
        tasks: [
          task("a", { position: 1 }),
          task("b", { position: 2 }),
          task("c", { position: 3 }),
        ],
      },
      {
        id: "done",
        slug: "done",
        name: "Done",
        icon: null,
        group: "completed",
        isFinal: true,
        position: 1,
        tasks: [
          task("d", { status: "done", position: 1 }),
          task("e", { status: "done", position: 5 }),
        ],
      },
    ],
    plannedTasks: [],
    archivedTasks: [],
  } as ProjectWithTasks;
}

const idsOf = (tasks: Task[]) => tasks.map((entry) => entry.id);

afterEach(() => {
  resetBoardCacheState();
  vi.useRealTimers();
});

describe("patchBoardTask", () => {
  it("replaces a field in place and keeps other columns' identity", () => {
    const before = board();
    const after = patchBoardTask(before, "b", { title: "Renamed" });
    expect(after.columns[0]?.tasks[1]?.title).toBe("Renamed");
    expect(idsOf(after.columns[0]?.tasks ?? [])).toEqual(["a", "b", "c"]);
    expect(after.columns[1]).toBe(before.columns[1]);
  });

  it("moves a task to its new status column in board order", () => {
    const after = patchBoardTask(board(), "a", { status: "done", position: 3 });
    expect(idsOf(after.columns[0]?.tasks ?? [])).toEqual(["b", "c"]);
    expect(idsOf(after.columns[1]?.tasks ?? [])).toEqual(["d", "a", "e"]);
  });

  it("re-sorts a column when a reorder changes a position", () => {
    const after = patchBoardTask(board(), "c", { position: 0 });
    expect(idsOf(after.columns[0]?.tasks ?? [])).toEqual(["c", "a", "b"]);
  });

  it("moves archived and planned tasks to their buckets", () => {
    const archived = patchBoardTask(board(), "a", {
      archivedAt: "2026-11-02T00:00:00.000Z",
    });
    expect(idsOf(archived.archivedTasks)).toEqual(["a"]);
    expect(idsOf(archived.columns[0]?.tasks ?? [])).toEqual(["b", "c"]);
    const planned = patchBoardTask(board(), "b", { status: "planned" });
    expect(idsOf(planned.plannedTasks)).toEqual(["b"]);
  });

  it("keeps a task whose status has no column where it is", () => {
    const after = patchBoardTask(board(), "a", { status: "unknown" });
    expect(after.columns[0]?.tasks[0]).toMatchObject({
      id: "a",
      status: "unknown",
    });
  });

  it("returns the same board when nothing changes or the task is absent", () => {
    const before = board();
    expect(patchBoardTask(before, "a", { title: "a" })).toBe(before);
    expect(patchBoardTask(before, "missing", { title: "x" })).toBe(before);
  });
});

describe("boardFieldsOf", () => {
  it("keeps only board fields and drops the archive alias", () => {
    expect(
      boardFieldsOf({
        title: "T",
        status: "archived",
        assigneeIds: ["u1"],
        dueDate: undefined,
      }),
    ).toEqual({ title: "T" });
  });
});

describe("startBoardEdit", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient();
    queryClient.setQueryData(["tasks", "p1"], board());
  });

  const cached = () =>
    queryClient.getQueryData<ProjectWithTasks>(["tasks", "p1"]);

  it("shows the edit at once and takes the server's copy when saved", () => {
    const edit = startBoardEdit(queryClient, "p1", "a", { status: "done" });
    expect(idsOf(cached()?.columns[1]?.tasks ?? [])).toContain("a");
    edit.saved({ id: "a", status: "done", position: 9, title: "From server" });
    const moved = cached()?.columns[1]?.tasks;
    expect(idsOf(moved ?? [])).toEqual(["d", "e", "a"]);
    expect(moved?.[2]).toMatchObject({ title: "From server", position: 9 });
  });

  it("puts back only the fields it changed when the request fails", () => {
    const edit = startBoardEdit(queryClient, "p1", "a", { status: "done" });
    const other = startBoardEdit(queryClient, "p1", "b", { title: "Kept" });
    edit.failed();
    expect(idsOf(cached()?.columns[0]?.tasks ?? [])).toEqual(["a", "b", "c"]);
    expect(cached()?.columns[0]?.tasks[1]?.title).toBe("Kept");
    other.saved();
  });

  it("keeps edits over a reload that started before they were saved", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const pending = startBoardEdit(queryClient, "p1", "a", { title: "Mine" });
    // A load that began before the save returns the old title.
    expect(
      withLocalBoardEdits("p1", board(), 500).columns[0]?.tasks[0]?.title,
    ).toBe("Mine");
    vi.setSystemTime(2_000);
    pending.saved();
    expect(
      withLocalBoardEdits("p1", board(), 1_500).columns[0]?.tasks[0]?.title,
    ).toBe("Mine");
    // A load that began after the save has it, and the edit is forgotten.
    const fresh = board();
    expect(withLocalBoardEdits("p1", fresh, 2_500)).toBe(fresh);
    expect(
      withLocalBoardEdits("p1", board(), 100).columns[0]?.tasks[0]?.title,
    ).toBe("a");
  });

  it("forgets a failed edit for later reloads", () => {
    const edit = startBoardEdit(queryClient, "p1", "a", { title: "Mine" });
    edit.failed();
    expect(
      withLocalBoardEdits("p1", board(), 0).columns[0]?.tasks[0]?.title,
    ).toBe("a");
  });
});

describe("scheduleBoardRefresh", () => {
  it("reloads a board once for a burst of edits", async () => {
    vi.useFakeTimers();
    const queryClient = new QueryClient();
    const invalidate = vi
      .spyOn(queryClient, "invalidateQueries")
      .mockResolvedValue();
    for (let i = 0; i < 20; i++) scheduleBoardRefresh(queryClient, "p1");
    scheduleBoardRefresh(queryClient, "p2");
    expect(invalidate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(250);
    expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toEqual(
      [
        ["tasks", "p1"],
        ["tasks", "p2"],
      ],
    );
  });
});
