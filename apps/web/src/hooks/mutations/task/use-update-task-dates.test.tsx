import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Task from "@/types/task";
import { useUpdateTaskDates } from "./use-update-task-dates";

const m = vi.hoisted(() => ({ put: vi.fn(), updateTask: vi.fn() }));

vi.mock("@margaya/libs", () => ({
  client: { task: { dates: { ":id": { $put: m.put } } } },
}));
vi.mock("@/fetchers/task/update-task", () => ({ default: m.updateTask }));

const START = "2026-11-09T00:00:00.000Z";
const DUE = "2026-11-11T00:00:00.000Z";

/** The board's copy, loaded before a colleague changed the task. */
function staleTask(overrides: Partial<Task> = {}) {
  return {
    id: "t1",
    projectId: "p1",
    title: "A title someone has since changed",
    status: "to-do",
    priority: "low",
    position: 3,
    userId: "someone-since-unassigned",
    startDate: "2026-11-02T00:00:00.000Z",
    dueDate: "2026-11-04T00:00:00.000Z",
    ...overrides,
  } as Task;
}

function setup() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const { result } = renderHook(() => useUpdateTaskDates(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
  return { result, queryClient };
}

afterEach(cleanup);

beforeEach(() => {
  m.put.mockReset().mockResolvedValue(Response.json({}));
  m.updateTask.mockReset().mockResolvedValue({});
});

describe("useUpdateTaskDates", () => {
  it("sends only the dates, never the cached copy of the task", async () => {
    const { result } = setup();

    await act(async () => {
      await result.current.mutateAsync({
        task: staleTask(),
        startDate: START,
        dueDate: DUE,
      });
    });

    expect(m.updateTask).not.toHaveBeenCalled();
    expect(m.put).toHaveBeenCalledTimes(1);
    expect(m.put).toHaveBeenCalledWith({
      param: { id: "t1" },
      json: { startDate: START, dueDate: DUE },
    });
  });

  it("leaves a date the task doesn't have alone instead of clearing it", async () => {
    const { result } = setup();

    await act(async () => {
      await result.current.mutateAsync({
        task: staleTask({ isMilestone: true, startDate: null } as never),
        startDate: null,
        dueDate: DUE,
      });
    });

    // Someone may have set a start date since this board loaded; null
    // would clear it.
    expect(m.put).toHaveBeenCalledWith({
      param: { id: "t1" },
      json: { dueDate: DUE },
    });
    expect(m.put.mock.calls[0]?.[0].json.startDate).toBeUndefined();
  });

  it("moves the task at once and puts it back when the request fails", async () => {
    let fail: (response: Response) => void = () => {};
    m.put.mockReturnValue(
      new Promise<Response>((resolve) => {
        fail = resolve;
      }),
    );
    const { result, queryClient } = setup();
    const task = staleTask();
    const board = { id: "p1", columns: [{ tasks: [task] }], plannedTasks: [] };
    queryClient.setQueryData(["task", "t1"], task);
    queryClient.setQueryData(["tasks", "p1"], board);

    let settled: Promise<unknown> = Promise.resolve();
    await act(async () => {
      settled = result.current
        .mutateAsync({ task, startDate: START, dueDate: DUE })
        .catch(() => {});
      await Promise.resolve();
    });

    await vi.waitFor(() =>
      expect(queryClient.getQueryData(["task", "t1"])).toMatchObject({
        startDate: START,
        dueDate: DUE,
      }),
    );
    expect(
      queryClient.getQueryData<typeof board>(["tasks", "p1"])?.columns[0]
        ?.tasks[0],
    ).toMatchObject({ startDate: START, dueDate: DUE });

    await act(async () => {
      fail(
        new Response("Start date cannot be after due date", { status: 400 }),
      );
      await settled;
    });

    expect(queryClient.getQueryData(["task", "t1"])).toEqual(task);
    expect(queryClient.getQueryData(["tasks", "p1"])).toEqual(board);
  });
});
