import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpError } from "@/lib/http-error";
import type { ProjectWithTasks } from "@/types/project";
import type Task from "@/types/task";
import { useBulkAssigneeGroups } from "./use-bulk-assignee-groups";

const mocks = vi.hoisted(() => ({
  add: vi.fn(),
  remove: vi.fn(),
  clear: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/hooks/mutations/task/use-bulk-operations", () => ({
  useBulkOperations: () => ({
    bulkAddAssignee: mocks.add,
    bulkRemoveAssignee: mocks.remove,
    bulkClearAssignees: mocks.clear,
  }),
}));

vi.mock(
  "@/hooks/queries/workspace-users/use-get-active-workspace-users",
  () => ({
    useGetActiveWorkspaceUsers: () => ({
      data: {
        members: [
          { userId: "ana", user: { name: "Ana Silva", image: null } },
          { userId: "ben", user: { name: "Ben Ito", image: null } },
        ],
      },
    }),
  }),
);

vi.mock("@/lib/toast", () => ({
  toast: { success: mocks.success, error: mocks.error },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key}(${Object.values(options).join("|")})` : key,
  }),
}));

beforeEach(() => {
  mocks.add.mockResolvedValue({ success: true, updatedCount: 2 });
  mocks.remove.mockResolvedValue({ success: true, updatedCount: 1 });
  mocks.clear.mockResolvedValue({ success: true, updatedCount: 1 });
});

afterEach(() => vi.clearAllMocks());

function task(id: string, assigneeIds: string[]): Task {
  return {
    id,
    title: id,
    number: null,
    description: null,
    status: "to-do",
    priority: null,
    startDate: null,
    dueDate: null,
    position: 0,
    createdAt: "2026-09-01T00:00:00.000Z",
    userId: assigneeIds[0] ?? null,
    assigneeId: assigneeIds[0] ?? null,
    assigneeName: null,
    assigneeIds,
    assignees: assigneeIds.map((assigneeId) => ({
      id: assigneeId,
      name: assigneeId === "gone" ? "Gone Person" : assigneeId,
      image: null,
    })),
    projectId: "project-1",
  };
}

function project(tasks: Task[]) {
  return {
    columns: [{ id: "to-do", tasks: tasks.slice(0, 2) }],
    plannedTasks: tasks.slice(2),
    archivedTasks: [],
  } as unknown as ProjectWithTasks;
}

function groups(tasks: Task[], selected: string[], onDone = vi.fn()) {
  const { result } = renderHook(() =>
    useBulkAssigneeGroups({
      project: project(tasks),
      workspaceId: "ws",
      selectedTaskIds: new Set(selected),
      enabled: true,
      onDone,
    }),
  );
  return result.current;
}

describe("useBulkAssigneeGroups", () => {
  it("offers every member to add", () => {
    const [add] = groups([task("t1", [])], ["t1"]);
    expect(add.label).toBe("tasks:bulk.addAssignee");
    expect(add.items.map((item) => item.label)).toEqual([
      "Ana Silva",
      "Ben Ito",
    ]);
  });

  it("offers to remove whoever is on any selected task, then clear", () => {
    const [, remove] = groups(
      [task("t1", ["ben"]), task("t2", ["ana"]), task("t3", ["gone", "ben"])],
      ["t1", "t3"],
    );
    expect(remove.items.map((item) => item.label)).toEqual([
      "Ben Ito",
      "Gone Person",
      "tasks:bulk.clearAssignees",
    ]);
  });

  it("offers only Clear assignees when nobody is assigned", () => {
    const [, remove] = groups([task("t1", [])], ["t1"]);
    expect(remove.items.map((item) => item.value)).toEqual(["clear-assignees"]);
  });

  it("adds one person to every selected task in one request", async () => {
    const onDone = vi.fn();
    const [add] = groups(
      [task("t1", []), task("t2", ["ana"])],
      ["t1", "t2"],
      onDone,
    );

    await act(async () => add.items[0]?.onRun());
    expect(mocks.add).toHaveBeenCalledWith({
      taskIds: ["t1", "t2"],
      userId: "ana",
    });
    expect(mocks.success).toHaveBeenCalledWith(
      "tasks:bulk.addAssigneeSuccess(Ana Silva|2)",
    );
    expect(onDone).toHaveBeenCalled();
  });

  it("shows the server's refusal and keeps the selection", async () => {
    mocks.add.mockRejectedValueOnce(
      new HttpError(400, "A task can have at most 20 assignees"),
    );
    const onDone = vi.fn();
    const [add] = groups([task("t1", [])], ["t1"], onDone);

    await act(async () => add.items[1]?.onRun());
    expect(mocks.error).toHaveBeenCalledWith(
      "A task can have at most 20 assignees",
    );
    expect(onDone).not.toHaveBeenCalled();
  });

  it("falls back to a generic message for other failures", async () => {
    mocks.clear.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const [, remove] = groups([task("t1", ["ana"])], ["t1"]);

    await act(async () => remove.items.at(-1)?.onRun());
    expect(mocks.clear).toHaveBeenCalledWith(["t1"]);
    expect(mocks.error).toHaveBeenCalledWith("tasks:bulk.assigneesError");
  });

  it("has no groups without the assign permission", () => {
    const { result } = renderHook(() =>
      useBulkAssigneeGroups({
        project: project([task("t1", [])]),
        workspaceId: "ws",
        selectedTaskIds: new Set(["t1"]),
        enabled: false,
        onDone: vi.fn(),
      }),
    );
    expect(result.current).toEqual([]);
  });
});
