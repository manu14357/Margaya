import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import type Task from "@/types/task";
import { useUpdateTask } from "./use-update-task";
import { useUpdateTaskStatus } from "./use-update-task-status";

vi.mock("@/fetchers/task/update-task-status", () => ({
  default: vi.fn(async () => ({})),
}));
vi.mock("@/fetchers/task/update-task", () => ({
  default: vi.fn(async () => ({})),
}));

function setup<T>(hook: () => T) {
  const queryClient = new QueryClient();
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
