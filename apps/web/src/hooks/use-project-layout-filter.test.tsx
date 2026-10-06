import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ProjectWithTasks } from "@/types/project";
import { useProjectLayoutFilter } from "./use-project-layout-filter";

const m = vi.hoisted(() => ({
  stateOptions: [] as unknown[],
  ids: null as { ids: Set<string>; truncated: boolean } | null,
}));

vi.mock("@/hooks/use-task-query-state", () => ({
  useTaskQueryState: (options: unknown) => {
    m.stateOptions.push(options);
    return {
      state: {
        filters: {
          op: "and",
          children: [{ key: "priority", operator: "in", values: ["high"] }],
        },
        archived: "exclude",
        display: { showSubTasks: true },
      },
    };
  },
}));
vi.mock("@/hooks/queries/task-query/use-task-query-rows", () => ({
  useTaskQueryIdsFor: () => ({
    data: m.ids,
    isFetching: false,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

const project = {
  id: "p1",
  slug: "WEB",
  columns: [
    {
      id: "c1",
      tasks: [
        { id: "high", title: "High" },
        { id: "low", title: "Low" },
      ],
    },
  ],
  plannedTasks: [{ id: "planned", title: "Planned" }],
} as unknown as ProjectWithTasks;

describe("useProjectLayoutFilter", () => {
  it("keeps the tasks the Tasks section's filters match", () => {
    m.ids = { ids: new Set(["high"]), truncated: false };
    const { result } = renderHook(() =>
      useProjectLayoutFilter({ workspaceId: "w1", projectId: "p1", project }),
    );

    // The same saved state as the project's Board, List and Spreadsheet.
    expect(m.stateOptions.at(-1)).toMatchObject({
      storageScope: "p1",
      scope: "project",
    });
    expect(
      result.current.filteredProject?.columns[0].tasks.map((task) => task.id),
    ).toEqual(["high"]);
    expect(result.current.filteredProject?.plannedTasks).toEqual([]);
  });

  it("shows every task until the matching ids arrive", () => {
    m.ids = null;
    const { result } = renderHook(() =>
      useProjectLayoutFilter({ workspaceId: "w1", projectId: "p1", project }),
    );
    expect(result.current.filteredProject?.columns[0].tasks).toHaveLength(2);
  });
});
