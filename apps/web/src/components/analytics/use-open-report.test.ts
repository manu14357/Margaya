import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TASK_FILTERS_STORAGE_PREFIX,
  type TaskQueryStateHandle,
} from "@/hooks/use-task-query-state";
import type { AnalyticsReport } from "@/types/analytics-report";
import type { AnalyticsScope } from "./analytics-context";
import { storeTaskSetFor, useOpenReport } from "./use-open-report";

const filters = { key: "priority", operator: "in", values: ["high"] };

function report(projectIds?: string[]): AnalyticsReport {
  return {
    id: "r1",
    workspaceId: "ws-1",
    name: "Bugs",
    visibility: "private",
    owner: null,
    isOwner: true,
    canDelete: true,
    config: {
      ...(projectIds ? { scope: { projectIds } } : {}),
      filters,
      archived: "include",
      xAxis: "priority",
    },
    droppedProjectCount: 0,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
  } as AnalyticsReport;
}

const projects = [
  { id: "p1", name: "Alpha", slug: "alpha", icon: null, cyclesEnabled: true },
  { id: "p2", name: "Beta", slug: "beta", icon: null },
] as AnalyticsScope["projects"];

function setup(overrides: Partial<AnalyticsScope> = {}) {
  const handle = {
    setFilters: vi.fn(),
    setArchived: vi.fn(),
  } as unknown as TaskQueryStateHandle;
  const setProjectIds = vi.fn();
  const onClearContext = vi.fn();
  const scope: AnalyticsScope = {
    kind: "workspace",
    workspaceId: "ws-1",
    scopeKey: "all",
    projects,
    slug: "acme",
    selectableProjects: projects,
    setProjectIds,
    ...overrides,
  };
  const { result } = renderHook(() =>
    useOpenReport({ scope, handle, hasContext: false, onClearContext }),
  );
  return { open: result.current, handle, setProjectIds };
}

afterEach(() => window.localStorage.clear());

describe("useOpenReport", () => {
  it("applies the filters in place when the scope is the same", () => {
    const { open, handle, setProjectIds } = setup();
    const target = open(report());
    expect(handle.setFilters).toHaveBeenCalledWith(filters);
    expect(handle.setArchived).toHaveBeenCalledWith("include");
    expect(setProjectIds).not.toHaveBeenCalled();
    expect(target.scopeKey).toBe("all");
    expect(target.availability.projectCount).toBe(2);
  });

  it("stores the filters for another scope and switches to it", () => {
    const { open, handle, setProjectIds } = setup();
    const target = open(report(["p1"]));
    expect(handle.setFilters).not.toHaveBeenCalled();
    expect(setProjectIds).toHaveBeenCalledWith(["p1"]);
    expect(target.scopeKey).toBe("p1");
    expect(target.availability.projectCount).toBe(1);
    const stored = JSON.parse(
      window.localStorage.getItem(
        `${TASK_FILTERS_STORAGE_PREFIX}analytics:p1`,
      ) ?? "null",
    );
    expect(stored).toMatchObject({ version: 2, filters, archived: "include" });
  });

  it("keeps the project in project analytics", () => {
    const { open, handle, setProjectIds } = setup({
      kind: "project",
      projectId: "p1",
      scopeKey: "p1",
      projects: [projects[0]],
      selectableProjects: undefined,
      setProjectIds: undefined,
    });
    const target = open(report(["p1", "p2"]));
    expect(handle.setFilters).toHaveBeenCalledWith(filters);
    expect(setProjectIds).not.toHaveBeenCalled();
    expect(target.plan.otherProjects).toBe(true);
    expect(target.scopeKey).toBe("p1");
  });
});

describe("storeTaskSetFor", () => {
  it("keeps the stored display settings", () => {
    const key = `${TASK_FILTERS_STORAGE_PREFIX}analytics:p2`;
    storeTaskSetFor("analytics:p2", "workspace", {
      filters: null,
      archived: "exclude",
    });
    const first = JSON.parse(window.localStorage.getItem(key) ?? "null");
    storeTaskSetFor("analytics:p2", "workspace", {
      filters: filters as never,
      archived: "only",
    });
    const second = JSON.parse(window.localStorage.getItem(key) ?? "null");
    expect(second.display).toEqual(first.display);
    expect(second).toMatchObject({ filters, archived: "only" });
  });
});
