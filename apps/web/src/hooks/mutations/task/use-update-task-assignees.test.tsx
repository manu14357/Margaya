import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProjectWithTasks } from "@/types/project";
import type Task from "@/types/task";
import { useSetTaskAssignees } from "./use-set-task-assignees";
import { useUpdateTaskAssignees } from "./use-update-task-assignees";

const api = vi.hoisted(() => ({ patch: vi.fn(), put: vi.fn() }));

vi.mock("@/fetchers/task/update-task-assignees", () => ({
  default: api.patch,
}));
vi.mock("@/fetchers/task/set-task-assignees", () => ({ default: api.put }));

afterEach(() => vi.clearAllMocks());

const ana = { id: "ana", name: "Ana Silva", image: "ana.png" };
const ben = { id: "ben", name: "Ben Ito", image: null };
const target = { taskId: "task-1", projectId: "project-1", workspaceId: "ws" };

function boardTask(): Task {
  return {
    id: "task-1",
    title: "Ship it",
    number: 1,
    description: null,
    status: "to-do",
    priority: null,
    startDate: null,
    dueDate: null,
    position: 0,
    createdAt: "2026-09-01T00:00:00.000Z",
    userId: "ana",
    assigneeId: "ana",
    assigneeName: "Ana Silva",
    assigneeImage: "ana.png",
    assigneeIds: ["ana"],
    assignees: [ana],
    projectId: "project-1",
  };
}

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  queryClient.setQueryData(["task", "task-1"], boardTask());
  queryClient.setQueryData<ProjectWithTasks>(["tasks", "project-1"], {
    columns: [{ id: "to-do", tasks: [boardTask()] }],
    plannedTasks: [],
    archivedTasks: [],
  } as unknown as ProjectWithTasks);
  queryClient.setQueryData(["active-workspace-users", "ws"], {
    members: [
      { userId: "ana", user: { name: ana.name, image: ana.image } },
      { userId: "ben", user: { name: ben.name, image: null } },
    ],
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const board = () =>
    queryClient.getQueryData<ProjectWithTasks>(["tasks", "project-1"])
      ?.columns[0]?.tasks[0];
  const detail = () => queryClient.getQueryData<Task>(["task", "task-1"]);
  return { queryClient, wrapper, board, detail };
}

function deferred() {
  let resolve!: (value: unknown) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

describe("useUpdateTaskAssignees", () => {
  it("shows the change on the board and the open task at once", async () => {
    const { wrapper, board, detail } = setup();
    const request = deferred();
    api.patch.mockReturnValue(request.promise);
    const { result } = renderHook(() => useUpdateTaskAssignees(), { wrapper });

    let pending!: Promise<unknown>;
    act(() => {
      pending = result.current.mutateAsync({ ...target, add: ["ben"] });
    });
    await vi.waitFor(() =>
      expect(board()?.assigneeIds).toEqual(["ana", "ben"]),
    );
    expect(board()?.assignees).toEqual([ana, ben]);
    expect(detail()?.assigneeIds).toEqual(["ana", "ben"]);
    expect(api.patch).toHaveBeenCalledWith("task-1", {
      add: ["ben"],
      remove: undefined,
    });

    await act(async () => {
      request.resolve({});
      await pending;
    });
  });

  it("moves the mirror to the next assignee when the first leaves", async () => {
    const { wrapper, board } = setup();
    api.patch.mockReturnValue(deferred().promise);
    const { result } = renderHook(() => useUpdateTaskAssignees(), { wrapper });

    act(() => {
      void result.current.mutateAsync({ ...target, add: ["ben"] });
    });
    await vi.waitFor(() => expect(board()?.assigneeIds).toHaveLength(2));
    act(() => {
      void result.current.mutateAsync({ ...target, remove: ["ana"] });
    });

    await vi.waitFor(() => expect(board()?.assigneeIds).toEqual(["ben"]));
    expect(board()).toMatchObject({
      userId: "ben",
      assigneeId: "ben",
      assigneeName: "Ben Ito",
      assigneeImage: null,
    });
  });

  it("undoes only its own change when it fails", async () => {
    const { wrapper, board } = setup();
    const failing = deferred();
    const succeeding = deferred();
    api.patch
      .mockReturnValueOnce(failing.promise)
      .mockReturnValueOnce(succeeding.promise);
    const { result } = renderHook(() => useUpdateTaskAssignees(), { wrapper });

    let first!: Promise<unknown>;
    act(() => {
      first = result.current.mutateAsync({ ...target, remove: ["ana"] });
    });
    await vi.waitFor(() => expect(board()?.assigneeIds).toEqual([]));
    act(() => {
      void result.current.mutateAsync({ ...target, add: ["ben"] });
    });
    await vi.waitFor(() => expect(board()?.assigneeIds).toEqual(["ben"]));

    await act(async () => {
      failing.reject(new Error("nope"));
      await first.catch(() => undefined);
    });

    // Ana returns to her place; the concurrent addition of Ben survives.
    expect(board()?.assigneeIds).toEqual(["ana", "ben"]);
    expect(board()?.userId).toBe("ana");
  });
});

describe("useSetTaskAssignees", () => {
  it("clears optimistically and restores the list when refused", async () => {
    const { wrapper, board, detail } = setup();
    const request = deferred();
    api.put.mockReturnValue(request.promise);
    const { result } = renderHook(() => useSetTaskAssignees(), { wrapper });

    let pending!: Promise<unknown>;
    act(() => {
      pending = result.current.mutateAsync({ ...target, assigneeIds: [] });
    });
    await vi.waitFor(() => expect(board()?.assigneeIds).toEqual([]));
    expect(detail()).toMatchObject({ userId: null, assigneeName: null });

    await act(async () => {
      request.reject(new Error("Forbidden"));
      await pending.catch(() => undefined);
    });

    expect(board()?.assigneeIds).toEqual(["ana"]);
    expect(detail()?.assignees).toEqual([ana]);
  });
});
