import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import updateTaskStatus from "@/fetchers/task/update-task-status";
import type { ProjectWithTasks } from "@/types/project";
import type Task from "@/types/task";
import { useUpdateTask } from "./use-update-task";
import { useUpdateTaskStatus } from "./use-update-task-status";

vi.mock("@/fetchers/task/update-task-status", () => ({
  default: vi.fn(async () => ({})),
}));
vi.mock("@/fetchers/task/update-task", () => ({
  default: vi.fn(async () => ({})),
}));

function setup<T>(hook: () => T, queryClient = new QueryClient()) {
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const { result } = renderHook(hook, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
  const keys = () =>
    invalidate.mock.calls.map(([filters]) => JSON.stringify(filters?.queryKey));
  return { result, keys };
}

const planningKeys = [
  '["cycles","p1"]',
  '["modules","p1","list"]',
  '["modules","p1","detail"]',
  '["modules","p1","progress"]',
];

describe("task status mutations", () => {
  it("refresh cycle and module progress in the tab that made the change", async () => {
    const { result, keys } = setup(() => useUpdateTaskStatus());
    await act(async () => {
      await result.current.mutateAsync({
        id: "t1",
        projectId: "p1",
        status: "done",
      } as Task);
    });
    expect(keys()).toEqual(expect.arrayContaining(planningKeys));
  });

  it("do the same for a move between columns", async () => {
    const { result, keys } = setup(() => useUpdateTask());
    await act(async () => {
      await result.current.mutateAsync({
        id: "t1",
        projectId: "p1",
        status: "done",
      } as Parameters<typeof result.current.mutateAsync>[0]);
    });
    expect(keys()).toEqual(expect.arrayContaining(planningKeys));
  });
});

describe("status changes on the board", () => {
  const board = () =>
    ({
      id: "p1",
      columns: [
        { id: "to-do", slug: "to-do", tasks: [{ id: "t1", status: "to-do" }] },
        { id: "done", slug: "done", tasks: [] },
      ],
      plannedTasks: [],
      archivedTasks: [],
    }) as unknown as ProjectWithTasks;
  const columnIds = (queryClient: QueryClient) =>
    queryClient
      .getQueryData<ProjectWithTasks>(["tasks", "p1"])
      ?.columns.map((column) => column.tasks.map((task) => task.id));

  it("move the card at once and reload the board only once, later", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["tasks", "p1"], board());
    let finish: (value: unknown) => void = () => {};
    vi.mocked(updateTaskStatus).mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve;
      }) as never,
    );
    const { result, keys } = setup(() => useUpdateTaskStatus(), queryClient);
    let done: Promise<unknown> = Promise.resolve();
    await act(async () => {
      done = result.current.mutateAsync({
        id: "t1",
        projectId: "p1",
        status: "done",
      } as Task);
    });
    await vi.waitFor(() =>
      expect(columnIds(queryClient)).toEqual([[], ["t1"]]),
    );
    expect(keys()).not.toContain('["tasks","p1"]');
    await act(async () => {
      finish({ id: "t1", status: "done", position: 4 });
      await done;
    });
    expect(keys()).not.toContain('["tasks","p1"]');
    expect(keys()).not.toContain('["notifications"]');
    await vi.waitFor(() =>
      expect(keys().filter((key) => key === '["tasks","p1"]')).toHaveLength(1),
    );
  });

  it("put the card back when the change fails", async () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(["tasks", "p1"], board());
    vi.mocked(updateTaskStatus).mockRejectedValueOnce(new Error("nope"));
    const { result } = setup(() => useUpdateTaskStatus(), queryClient);
    await act(async () => {
      await result.current
        .mutateAsync({ id: "t1", projectId: "p1", status: "done" } as Task)
        .catch(() => {});
    });
    expect(columnIds(queryClient)).toEqual([["t1"], []]);
  });
});
