import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Task from "@/types/task";
import { useApplyDateCascade } from "./use-apply-date-cascade";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    updateTask: vi.fn(),
    updateDueDate: vi.fn(),
    bulkOperation: vi.fn(),
    updateDates: vi.fn(),
  },
}));

vi.mock("@/fetchers/task/update-task", () => ({ default: mocks.updateTask }));
vi.mock("@/fetchers/task/update-task-due-date", () => ({
  default: mocks.updateDueDate,
}));
vi.mock("@/fetchers/task/bulk-operation", () => ({
  default: mocks.bulkOperation,
}));
vi.mock("@/fetchers/task/update-task-dates", () => ({
  default: mocks.updateDates,
}));
vi.mock("./invalidate-planning-progress", () => ({
  invalidatePlanningProgress: vi.fn(),
}));

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

function applyHook() {
  const queryClient = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return renderHook(() => useApplyDateCascade("p1"), { wrapper });
}

afterEach(cleanup);

beforeEach(() => {
  for (const mock of Object.values(mocks)) {
    mock.mockReset().mockResolvedValue({});
  }
});

describe("useApplyDateCascade", () => {
  const start = "2026-11-09T00:00:00.000Z";
  const due = "2026-11-11T00:00:00.000Z";

  it("moves each task's dates in one request that sends only the dates", async () => {
    const { result } = applyHook();
    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.mutateAsync([
        { task: staleTask(), startDate: start, dueDate: due },
      ]);
    });

    expect(mocks.updateDates).toHaveBeenCalledTimes(1);
    expect(mocks.updateDates).toHaveBeenCalledWith("t1", {
      startDate: start,
      dueDate: due,
    });
    expect(mocks.updateTask).not.toHaveBeenCalled();
    expect(mocks.updateDueDate).not.toHaveBeenCalled();
    expect(mocks.bulkOperation).not.toHaveBeenCalled();
    expect(outcome).toEqual({ moved: 1, failed: 0 });
  });

  it("leaves alone a date the task doesn't have", async () => {
    const { result } = applyHook();
    await act(async () => {
      await result.current.mutateAsync([
        {
          task: staleTask({ startDate: null, dueDate: "2026-11-04" } as never),
          startDate: null,
          dueDate: due,
        },
        {
          task: staleTask({
            id: "t2",
            startDate: "2026-11-02",
            dueDate: null,
          } as never),
          startDate: start,
          dueDate: null,
        },
      ]);
    });
    const sent = (taskId: string) =>
      mocks.updateDates.mock.calls.find(([id]) => id === taskId)?.[1];
    expect(sent("t1")).toEqual({ dueDate: due });
    expect(sent("t1")?.startDate).toBeUndefined();
    expect(sent("t2")).toEqual({ startDate: start });
    expect(sent("t2")?.dueDate).toBeUndefined();
  });

  it("counts a failed move and carries on with the rest", async () => {
    mocks.updateDates.mockRejectedValueOnce(new Error("refused"));
    const { result } = applyHook();
    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.mutateAsync([
        { task: staleTask(), startDate: start, dueDate: due },
        { task: staleTask({ id: "t2" }), startDate: start, dueDate: due },
      ]);
    });
    expect(outcome).toEqual({ moved: 1, failed: 1 });
    expect(mocks.updateDates).toHaveBeenCalledTimes(2);
  });
});
