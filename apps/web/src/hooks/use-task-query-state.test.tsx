import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultDisplay } from "@/lib/task-query/display";
import type { TaskQueryState } from "@/lib/task-query/model";
import { useUserPreferencesStore } from "@/store/user-preferences";
import {
  defaultTaskQueryState,
  TASK_FILTERS_STORAGE_PREFIX,
  useTaskQueryState,
} from "./use-task-query-state";

const labels = vi.hoisted(() => ({
  data: undefined as
    | Array<{ id: string; name: string; color: string; taskId: string | null }>
    | undefined,
}));

vi.mock("@/hooks/queries/label/use-get-labels-by-workspace", () => ({
  default: () => ({ data: labels.data }),
}));

const stored = (scope: string) => {
  const raw = window.localStorage.getItem(
    `${TASK_FILTERS_STORAGE_PREFIX}${scope}`,
  );
  return raw ? JSON.parse(raw) : null;
};

const priorityHigh = {
  op: "and" as const,
  children: [{ key: "priority", operator: "in", values: ["high"] }],
};

describe("useTaskQueryState", () => {
  beforeEach(() => {
    window.localStorage.clear();
    labels.data = undefined;
    useUserPreferencesStore.setState({ showAssignees: true });
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it("stores the state under the v2 key", () => {
    const { result } = renderHook(() =>
      useTaskQueryState({
        storageScope: "p1",
        scope: "project",
        workspaceId: "w1",
      }),
    );
    act(() => result.current.setFilters(priorityHigh));
    expect(stored("p1")).toMatchObject({ version: 2, filters: priorityHigh });
    expect(result.current.isDirty).toBe(true);
    expect(result.current.hasActiveFilters).toBe(true);
    act(() => result.current.clearFilters());
    expect(result.current.hasActiveFilters).toBe(false);
  });

  it("restores a stored state and survives corrupt storage", () => {
    window.localStorage.setItem(
      `${TASK_FILTERS_STORAGE_PREFIX}p1`,
      JSON.stringify({
        version: 2,
        filters: priorityHigh,
        archived: "only",
        display: { groupBy: "priority" },
      }),
    );
    window.localStorage.setItem(`${TASK_FILTERS_STORAGE_PREFIX}p2`, "{nope");
    const { result: first } = renderHook(() =>
      useTaskQueryState({
        storageScope: "p1",
        scope: "project",
        workspaceId: "w1",
      }),
    );
    expect(first.current.filters).toEqual(priorityHigh);
    expect(first.current.archived).toBe("only");
    expect(first.current.display.groupBy).toBe("priority");
    const { result: second } = renderHook(() =>
      useTaskQueryState({
        storageScope: "p2",
        scope: "project",
        workspaceId: "w1",
      }),
    );
    expect(second.current.state.filters).toBe(null);
  });

  it("converts the old board filters and sort once", () => {
    window.localStorage.setItem(
      "margaya:board-filters:p1",
      JSON.stringify({ priority: ["high"], dueDate: ["noDueDate"] }),
    );
    window.localStorage.setItem(
      "margaya:board-sort:p1",
      JSON.stringify({ field: "dueDate", direction: "desc" }),
    );
    const { result } = renderHook(() =>
      useTaskQueryState({
        storageScope: "p1",
        scope: "project",
        workspaceId: "w1",
        legacy: { filtersScope: "p1", sortProjectId: "p1" },
      }),
    );
    expect(result.current.filters).toEqual({
      op: "and",
      children: [
        { key: "priority", operator: "in", values: ["high"] },
        { key: "dueDate", operator: "in", values: ["none"] },
      ],
    });
    expect(result.current.display.orderBy).toEqual({
      field: "dueDate",
      direction: "desc",
    });
    expect(stored("p1")?.filters).toEqual(result.current.filters);
    // The legacy key stays for a rollback.
    expect(window.localStorage.getItem("margaya:board-filters:p1")).not.toBe(
      null,
    );
  });

  it("waits for workspace labels to convert old label filters", () => {
    window.localStorage.setItem(
      "margaya:board-filters:p1",
      JSON.stringify({ labels: ["copy-1"] }),
    );
    const { result, rerender } = renderHook(() =>
      useTaskQueryState({
        storageScope: "p1",
        scope: "project",
        workspaceId: "w1",
        legacy: { filtersScope: "p1" },
      }),
    );
    expect(result.current.isConverting).toBe(true);
    expect(stored("p1")).toBe(null);
    labels.data = [
      { id: "ws-1", name: "Bug", color: "red", taskId: null },
      { id: "copy-1", name: "Bug", color: "red", taskId: "t1" },
    ];
    rerender();
    expect(result.current.filters).toEqual({
      op: "and",
      children: [{ key: "label", operator: "in", values: ["ws-1"] }],
    });
    expect(stored("p1")?.filters).toEqual(result.current.filters);
  });

  it("keeps a view's unsaved changes apart and resets to the view", () => {
    const baseline: TaskQueryState = {
      ...defaultTaskQueryState("workspace"),
      filters: priorityHigh,
    };
    const { result } = renderHook(() =>
      useTaskQueryState({
        storageScope: "view:v1",
        scope: "workspace",
        workspaceId: "w1",
        baseline,
      }),
    );
    expect(result.current.isDirty).toBe(false);
    expect(stored("view:v1")).toBe(null);
    act(() => result.current.updateDisplay({ groupBy: "priority" }));
    expect(result.current.isDirty).toBe(true);
    expect(stored("view:v1")?.display.groupBy).toBe("priority");
    act(() => result.current.reset());
    expect(result.current.isDirty).toBe(false);
    expect(stored("view:v1")).toBe(null);
  });

  it("forgets unsaved changes once they are saved", () => {
    const baseline = defaultTaskQueryState("project");
    const { result } = renderHook(() =>
      useTaskQueryState({
        storageScope: "view:v2",
        scope: "project",
        workspaceId: "w1",
        baseline,
      }),
    );
    act(() => result.current.setArchived("include"));
    expect(stored("view:v2")).not.toBe(null);
    act(() =>
      result.current.commit({ ...result.current.state, archived: "include" }),
    );
    expect(result.current.isDirty).toBe(false);
    expect(stored("view:v2")).toBe(null);
  });

  it("writes mirrored display properties to the global toggles", () => {
    const { result } = renderHook(() =>
      useTaskQueryState({
        storageScope: "p1",
        scope: "project",
        workspaceId: "w1",
      }),
    );
    act(() => result.current.setDisplayProperty("assignee", false));
    expect(useUserPreferencesStore.getState().showAssignees).toBe(false);
    expect(result.current.displayProperties.assignee).toBe(false);
    act(() => result.current.setDisplayProperty("startDate", true));
    expect(result.current.displayProperties.startDate).toBe(true);
    expect(stored("p1")?.displayProperties.startDate).toBe(true);
  });

  it("drops a sub-group equal to, or without, the group", () => {
    const { result } = renderHook(() =>
      useTaskQueryState({
        storageScope: null,
        scope: "project",
        workspaceId: "w1",
      }),
    );
    act(() =>
      result.current.updateDisplay({
        groupBy: "priority",
        subGroupBy: "label",
      }),
    );
    expect(result.current.display.subGroupBy).toBe("label");
    act(() => result.current.updateDisplay({ groupBy: null }));
    expect(result.current.display).toMatchObject({
      groupBy: null,
      subGroupBy: null,
    });
    expect(defaultDisplay("project").groupBy).toBe("status");
  });
});
