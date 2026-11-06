import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import DueTodaySection from "./due-today-section";

const mocks = vi.hoisted(() => ({
  options: null as unknown,
  result: {} as Record<string, unknown>,
  refetch: vi.fn(),
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (key: string, values?: { total?: number }) =>
      values?.total === undefined ? key : `${key} ${values.total}`,
  }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    search,
    className,
  }: {
    children?: ReactNode;
    search?: { filter?: string };
    className?: string;
  }) => (
    <a href={`#${search?.filter}`} className={className}>
      {children}
    </a>
  ),
}));
vi.mock("@/hooks/queries/task-query/use-task-query-rows", () => ({
  useTaskQueryRows: (options: unknown) => {
    mocks.options = options;
    return mocks.result;
  },
}));

const row = (id: string, title: string) => ({
  id,
  title,
  key: `WEB-${id}`,
  priority: "high",
  projectId: "p-1",
});

function loaded(ids: string[], totalCount = ids.length) {
  return {
    isLoading: false,
    isError: false,
    refetch: mocks.refetch,
    data: {
      totalCount,
      groups: [{ key: "all", count: totalCount, taskIds: ids }],
      tasks: Object.fromEntries(ids.map((id) => [id, row(id, `Task ${id}`)])),
      meta: { projects: [{ id: "p-1", name: "Website" }] },
    },
  };
}

const onOpenTask = vi.fn();

function renderSection() {
  return render(<DueTodaySection workspaceId="ws-1" onOpenTask={onOpenTask} />);
}

beforeEach(() => {
  mocks.result = loaded([]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("DueTodaySection", () => {
  it("asks for my open tasks due today, ungrouped and most urgent first", () => {
    renderSection();
    expect(mocks.options).toMatchObject({
      workspaceId: "ws-1",
      scope: { kind: "workspace" },
      baseConditions: [{ key: "assignee", operator: "in", values: ["me"] }],
      ungrouped: true,
      limit: 6,
      state: {
        archived: "exclude",
        filters: {
          op: "and",
          children: [
            {
              key: "group",
              operator: "in",
              values: ["backlog", "unstarted", "started"],
            },
            { key: "dueDate", operator: "in", values: ["today"] },
          ],
        },
        display: { orderBy: { field: "priority", direction: "desc" } },
      },
    });
  });

  it("lists tasks, opening one in the sheet and keeping the page as its href", () => {
    mocks.result = loaded(["1", "2"]);
    renderSection();

    const link = screen.getByText("Task 1").closest("a") as HTMLAnchorElement;
    expect(link).toHaveAttribute(
      "href",
      "/dashboard/workspace/ws-1/project/p-1/task/1",
    );
    expect(screen.getByText("WEB-1")).toBeInTheDocument();
    expect(screen.getAllByText("Website")).toHaveLength(2);

    fireEvent.click(link);
    expect(onOpenTask).toHaveBeenCalledWith("1", "p-1");

    // A modified click is left to the browser (new tab).
    fireEvent.click(link, { ctrlKey: true });
    expect(onOpenTask).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/home:dueToday\.viewAll/)).toBeNull();
  });

  it("links to the full list only when more tasks are due than it shows", () => {
    mocks.result = loaded(["1", "2", "3", "4", "5", "6"], 9);
    renderSection();
    const viewAll = screen.getByText("home:dueToday.viewAll 9");
    expect(viewAll.closest("a")).toHaveAttribute("href", "#dueToday");
  });

  it("says so when nothing is due today", () => {
    renderSection();
    expect(screen.getByText("home:dueToday.empty")).toBeInTheDocument();
    expect(screen.getByRole("region")).toHaveAccessibleName(
      "home:dueToday.title",
    );
  });

  it("shows skeletons while loading, not the empty line", () => {
    mocks.result = { isLoading: true, isError: false, refetch: mocks.refetch };
    renderSection();
    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByText("home:dueToday.empty")).toBeNull();
  });

  it("offers Retry after a failed load instead of claiming nothing is due", () => {
    mocks.result = { isLoading: false, isError: true, refetch: mocks.refetch };
    renderSection();
    expect(screen.queryByText("home:dueToday.empty")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "home:retry" }));
    expect(mocks.refetch).toHaveBeenCalledTimes(1);
  });
});
