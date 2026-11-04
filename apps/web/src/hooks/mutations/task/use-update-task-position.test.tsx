import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import useProjectStore from "@/store/project";
import type { ProjectWithTasks } from "@/types/project";
import { useUpdateTaskPosition } from "./use-update-task-position";

const m = vi.hoisted(() => ({
  put: vi.fn(),
  toastError: vi.fn(),
  toastDismiss: vi.fn(),
}));

vi.mock("@margaya/libs", () => ({
  client: { task: { position: { ":id": { $put: m.put } } } },
}));
vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/lib/toast", () => ({
  toast: { error: m.toastError, dismiss: m.toastDismiss },
}));

function setup() {
  const queryClient = new QueryClient();
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  const { result } = renderHook(() => useUpdateTaskPosition(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    ),
  });
  const keys = () =>
    invalidate.mock.calls.map(([filters]) => JSON.stringify(filters?.queryKey));
  return { result, queryClient, keys };
}

const stored = { id: "p1", marker: "server" } as unknown as ProjectWithTasks;
const optimistic = { id: "p1", marker: "drag" } as unknown as ProjectWithTasks;

beforeEach(() => {
  m.put.mockReset();
  m.toastError.mockReset().mockReturnValue("failure-toast");
  m.toastDismiss.mockReset();
  useProjectStore.getState().setProject(undefined);
});

describe("useUpdateTaskPosition", () => {
  it("sends only the position and status, whatever else the caller holds", async () => {
    m.put.mockResolvedValue(Response.json({}));
    const { result, keys } = setup();

    await act(async () => {
      await result.current.mutateAsync({
        id: "t1",
        projectId: "p1",
        position: 3,
        status: "done",
        title: "A stale title",
      } as Parameters<typeof result.current.mutateAsync>[0]);
    });

    expect(m.put).toHaveBeenCalledWith({
      param: { id: "t1" },
      json: { position: 3, status: "done" },
    });
    // A status change refreshes what depends on it.
    expect(keys()).toContain('["notifications"]');
    expect(keys()).toContain('["cycles","p1"]');
  });

  it("refreshes only the task and its board after a reorder", async () => {
    m.put.mockResolvedValue(Response.json({}));
    const { result, keys } = setup();

    await act(async () => {
      await result.current.mutateAsync({
        id: "t1",
        projectId: "p1",
        position: 0,
      });
    });

    expect(m.put).toHaveBeenCalledWith({
      param: { id: "t1" },
      json: { position: 0, status: undefined },
    });
    expect(keys()).toEqual(['["task","t1"]', '["tasks","p1"]']);
  });

  it("puts the board back and says so when a move fails", async () => {
    m.put.mockResolvedValue(new Response("nope", { status: 500 }));
    const { result, queryClient } = setup();
    queryClient.setQueryData(["tasks", "p1"], stored);
    useProjectStore.getState().setProject(optimistic);

    await act(async () => {
      await result.current
        .mutateAsync({ id: "t1", projectId: "p1", position: 2 })
        .catch(() => {});
    });

    expect(useProjectStore.getState().project).toBe(stored);
    expect(m.toastError).toHaveBeenCalledWith("tasks:update.error");
  });

  it("leaves one message when every write of a drop fails", async () => {
    m.put.mockImplementation(async () => new Response("nope", { status: 500 }));
    const { result } = setup();

    await act(async () => {
      await Promise.allSettled([
        result.current.mutateAsync({ id: "t1", projectId: "p1", position: 0 }),
        result.current.mutateAsync({ id: "t2", projectId: "p1", position: 1 }),
      ]);
    });

    expect(m.toastError).toHaveBeenCalledTimes(2);
    expect(m.toastDismiss).toHaveBeenLastCalledWith("failure-toast");
  });
});
