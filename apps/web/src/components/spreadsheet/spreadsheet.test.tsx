import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TaskQueryHandle } from "@/hooks/queries/task-query/use-task-query";
import { DEFAULT_DISPLAY_PROPERTIES } from "@/lib/task-query/display";
import type { MergedTaskQueryResult } from "@/lib/task-query/merge";
import { DISPLAY_PROPERTY_KEYS } from "@/lib/task-query/model";
import useBulkSelectionStore from "@/store/bulk-selection";
import Spreadsheet from "./spreadsheet";

const state = vi.hoisted(() => ({
  canUpdate: true,
  observed: [] as Array<(entries: Array<{ isIntersecting: boolean }>) => void>,
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canUpdateTasks: () => state.canUpdate,
    canAssignTasks: () => state.canUpdate,
    canCreateTasks: () => state.canUpdate,
  }),
}));

vi.mock(
  "@/components/kanban-board/task-card-context-menu/task-card-context-menu-content",
  () => ({ default: () => null }),
);

vi.mock("@/components/task-layouts/delete-task-dialog", () => ({
  default: () => null,
}));

vi.mock("@/components/task/task-shortcuts/focused-task-shortcuts", () => ({
  default: () => null,
}));

vi.mock("@/components/task-draft/quick-add", () => ({
  default: ({
    projectId,
    prefill,
  }: {
    projectId: string;
    prefill: { status: string; targetName: string };
  }) => (
    <div data-testid="quick-add">
      {`${projectId}:${prefill.status}:${prefill.targetName}`}
    </div>
  ),
}));

class FakeObserver {
  constructor(callback: (entries: Array<{ isIntersecting: boolean }>) => void) {
    state.observed.push(callback);
  }
  observe() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal("IntersectionObserver", FakeObserver);
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  state.canUpdate = true;
  state.observed = [];
  vi.unstubAllGlobals();
});

const meta: MergedTaskQueryResult["meta"] = {
  users: [],
  projects: [
    {
      id: "p1",
      name: "Web",
      slug: "WEB",
      icon: null,
      position: 0,
      cyclesEnabled: true,
      modulesEnabled: true,
      estimatesEnabled: true,
    },
  ],
  columns: [
    {
      projectId: "p1",
      slug: "to-do",
      name: "To do",
      icon: null,
      group: "unstarted",
      position: 0,
      isFinal: false,
    },
  ],
  labels: [],
  cycles: [],
  modules: [],
  estimatePoints: [],
  customFields: [],
};

function row(id: string, number: number) {
  return {
    id,
    projectId: "p1",
    number,
    key: `WEB-${number}`,
    title: `Task ${number}`,
    status: "to-do",
    columnId: "c1",
    group: "unstarted" as const,
    priority: "high",
    startDate: null,
    dueDate: null,
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-02T00:00:00.000Z",
    completedAt: null,
    archivedAt: null,
    createdBy: null,
    userId: null,
    position: 0,
    assigneeIds: [],
    labels: [],
    subTaskCount: 0,
  };
}

function handle(nextCursor: string | null = "cursor-1") {
  const data: MergedTaskQueryResult = {
    mode: "rows",
    groupBy: null,
    subGroupBy: null,
    today: "2026-09-26",
    totalCount: 3,
    groups: [{ key: "all", count: 3, taskIds: ["a", "b"], nextCursor }],
    hasMoreGroups: false,
    tasks: { a: row("a", 1), b: row("b", 2) },
    meta,
  };
  return {
    data,
    isLoading: false,
    isFetching: false,
    isPlaceholderData: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    loadMore: vi.fn(),
    isLoadingMore: () => false,
  } as unknown as TaskQueryHandle;
}

function renderSpreadsheet(
  query = handle(),
  overrides: Partial<Parameters<typeof Spreadsheet>[0]> = {},
) {
  const onSort = vi.fn();
  const onHideColumn = vi.fn();
  render(
    <Spreadsheet
      query={query}
      workspaceId="w1"
      scope={{ kind: "project", projectId: "p1" }}
      properties={{
        ...DEFAULT_DISPLAY_PROPERTIES,
        labels: false,
        customFields: [],
      }}
      availableProperties={DISPLAY_PROPERTY_KEYS}
      orderBy={{ field: "priority", direction: "desc" }}
      onSort={onSort}
      onHideColumn={onHideColumn}
      {...overrides}
    />,
  );
  return { onSort, onHideColumn };
}

describe("Spreadsheet", () => {
  it("shows the shown properties as columns in a fixed order", () => {
    renderSpreadsheet();
    const headers = screen
      .getAllByRole("columnheader")
      .map((header) => header.textContent)
      .filter(Boolean);
    expect(headers).toEqual([
      "tasks:spreadsheet.task",
      "tasks:display.props.status",
      "tasks:display.props.priority",
      "tasks:display.props.assignee",
      "tasks:display.props.modules",
      "tasks:display.props.cycle",
      "tasks:display.props.estimate",
      "tasks:display.props.dueDate",
      "tasks:display.props.subTaskCount",
    ]);
    expect(screen.getByText("WEB-1")).toBeInTheDocument();
    // The active sort shows in its header.
    const priority = screen.getByRole("columnheader", {
      name: /tasks:display.props.priority/,
    });
    expect(priority).toHaveAttribute("aria-sort", "descending");
  });

  it("sorts and hides from a header menu", async () => {
    const { onSort, onHideColumn } = renderSpreadsheet();
    fireEvent.click(
      screen.getByRole("button", { name: "tasks:display.props.dueDate" }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", {
        name: /tasks:spreadsheet.sortAsc/,
      }),
    );
    expect(onSort).toHaveBeenCalledWith({ field: "dueDate", direction: "asc" });

    fireEvent.click(
      screen.getByRole("button", { name: /tasks:display.props.priority/ }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", {
        name: /tasks:spreadsheet.hideColumn/,
      }),
    );
    expect(onHideColumn).toHaveBeenCalledWith("priority");
  });

  it("shows plain values to read-only roles", () => {
    state.canUpdate = false;
    renderSpreadsheet();
    const firstRow = screen.getAllByRole("row")[1];
    if (!firstRow) throw new Error("no row");
    // Only the title (open) and the sub-task expander would be buttons.
    const buttons = within(firstRow)
      .queryAllByRole("button")
      .map((button) => button.textContent);
    expect(buttons).toEqual(["Task 1"]);
  });

  it("requests the next page at the end of the list", () => {
    const query = handle();
    renderSpreadsheet(query);
    for (const callback of state.observed) callback([{ isIntersecting: true }]);
    expect(query.loadMore).toHaveBeenCalledWith("all");
  });

  it("offers no next page at the end of the results", () => {
    const query = handle(null);
    renderSpreadsheet(query);
    expect(state.observed).toHaveLength(0);
  });

  it("ends a project's sheet with a quick add into its entry column", () => {
    renderSpreadsheet(handle(null), { quickAdd: true });
    const quickAdd = screen.getByTestId("quick-add");
    expect(quickAdd.textContent).toBe("p1:to-do:To do");
    expect(quickAdd.closest("tr")).toHaveAttribute(
      "data-spreadsheet-quick-add",
    );
  });

  it("has no quick add without task:create or outside a project", () => {
    state.canUpdate = false;
    renderSpreadsheet(handle(null), { quickAdd: true });
    expect(screen.queryByTestId("quick-add")).toBe(null);
    cleanup();
    state.canUpdate = true;
    renderSpreadsheet(handle(null), {
      quickAdd: true,
      scope: { kind: "workspace" },
    });
    expect(screen.queryByTestId("quick-add")).toBe(null);
  });

  it("shows a selected row as checked and selected", () => {
    renderSpreadsheet();
    const [select] = screen.getAllByRole("checkbox", {
      name: /tasks:spreadsheet.selectTask/,
    });
    fireEvent.click(select);

    expect(select).toBeChecked();
    expect(select.closest("[aria-selected]")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    useBulkSelectionStore.getState().clearSelection();
  });
});
