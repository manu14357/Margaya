import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildModuleTaskIndex,
  moduleTaskIndexOf,
  useModuleTaskIndex,
} from "./use-get-module-task-map";

const fetchMap = vi.hoisted(() => vi.fn());

vi.mock("@/fetchers/module/get-module-task-map", () => ({
  default: fetchMap,
}));

afterEach(() => fetchMap.mockReset());

const entries = [
  { taskId: "t1", moduleId: "billing" },
  { taskId: "t1", moduleId: "onboarding" },
  { taskId: "t2", moduleId: "billing" },
];

function wrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

describe("module task index", () => {
  it("maps tasks to modules and modules to tasks", () => {
    const index = buildModuleTaskIndex(entries);
    expect(index.modulesByTask.get("t1")).toEqual(["billing", "onboarding"]);
    expect([...(index.tasksByModule.get("billing") ?? [])]).toEqual([
      "t1",
      "t2",
    ]);
  });

  it("builds the index once per response and shares it between hooks", async () => {
    fetchMap.mockResolvedValue(entries);
    const { result } = renderHook(
      () => ({
        card: useModuleTaskIndex("project-1"),
        otherCard: useModuleTaskIndex("project-1"),
      }),
      { wrapper: wrapper() },
    );

    await waitFor(() => expect(result.current.card.isReady).toBe(true));
    expect(fetchMap).toHaveBeenCalledTimes(1);
    expect(result.current.card.modulesByTask).toBe(
      result.current.otherCard.modulesByTask,
    );
    const data = entries.slice();
    expect(moduleTaskIndexOf(data)).toBe(moduleTaskIndexOf(data));
    expect(moduleTaskIndexOf(data)).not.toBe(moduleTaskIndexOf([...data]));
  });

  it("fetches nothing and stays empty while disabled", () => {
    const { result } = renderHook(
      () => useModuleTaskIndex("project-1", { enabled: false }),
      { wrapper: wrapper() },
    );
    expect(result.current.isReady).toBe(false);
    expect(result.current.modulesByTask.size).toBe(0);
    expect(fetchMap).not.toHaveBeenCalled();
  });
});
