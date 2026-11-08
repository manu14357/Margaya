import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n } from "@/lib/i18n";
import { defaultDisplay } from "@/lib/task-query/display";
import type { TaskQueryState } from "@/lib/task-query/model";
import WorkspaceTimeline from "./workspace-timeline";

const m = vi.hoisted(() => ({
  navigate: vi.fn(),
  loadMore: vi.fn(),
  refetch: vi.fn(),
  rowsArgs: null as { state: TaskQueryState; limit: number } | null,
  query: {} as Record<string, unknown>,
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => m.navigate,
}));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/hooks/queries/task-query/use-task-query-rows", () => ({
  useTaskQueryRows: (args: { state: TaskQueryState; limit: number }) => {
    m.rowsArgs = args;
    return m.query;
  },
}));

const STATE: TaskQueryState = {
  filters: null,
  archived: "exclude",
  display: defaultDisplay("workspace"),
  displayProperties: {} as TaskQueryState["displayProperties"],
};

const row = (id: string, projectId: string, dueDate: string | null) => ({
  id,
  projectId,
  key: id.toUpperCase(),
  title: `Title ${id}`,
  status: "to-do",
  startDate: null,
  dueDate,
  priority: "no-priority",
});

function renderTimeline() {
  return render(
    <WorkspaceTimeline
      workspaceId="ws-1"
      scope={{ kind: "workspace" }}
      state={STATE}
      onClearFilters={undefined}
    />,
  );
}

const twoProjects = () => ({
  data: {
    groups: [
      { key: "p1", taskIds: ["a"], count: 1, nextCursor: null },
      { key: "p2", taskIds: ["b"], count: 70, nextCursor: "next" },
    ],
    tasks: {
      a: row("a", "p1", "2026-03-05T00:00:00.000Z"),
      b: row("b", "p2", "2026-03-06T00:00:00.000Z"),
    },
    meta: {
      projects: [
        { id: "p1", name: "Web", icon: null },
        { id: "p2", name: "API", icon: null },
      ],
      columns: [{ projectId: "p1", slug: "to-do", group: "unstarted" }],
    },
  },
  isError: false,
  error: null,
  refetch: m.refetch,
  loadMore: m.loadMore,
  isLoadingMore: () => false,
});

beforeEach(() => {
  // jsdom has no layout: nothing to scroll.
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.scrollTo = vi.fn() as unknown as Element["scrollTo"];
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("WorkspaceTimeline", () => {
  it("asks for dated tasks grouped by project, whatever the view's display", () => {
    m.query = twoProjects();
    renderTimeline();
    expect(m.rowsArgs?.limit).toBe(50);
    expect(m.rowsArgs?.state.display).toMatchObject({
      groupBy: "project",
      subGroupBy: null,
      showEmptyGroups: false,
    });
    expect(m.rowsArgs?.state.filters).toMatchObject({ op: "or" });
  });

  it("shows a section per project with its tasks", () => {
    m.query = twoProjects();
    renderTimeline();
    expect(screen.getByRole("heading", { name: "Web" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "API" })).toBeInTheDocument();
    expect(screen.getByText("A")).toBeInTheDocument();
    expect(screen.getByText("B")).toBeInTheDocument();
  });

  it("names the months in the app's language", async () => {
    await i18n.changeLanguage("de-DE");
    try {
      m.query = twoProjects();
      renderTimeline();
      expect(screen.getByText("März 2026")).toBeInTheDocument();
      expect(screen.queryByText("March 2026")).toBeNull();
    } finally {
      await i18n.changeLanguage("en-US");
    }
  });

  it("centers today on whole columns, so no day is cut off at the task list's edge", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 2, 5));
    const scrollTo = vi.fn();
    Element.prototype.scrollTo = scrollTo as unknown as Element["scrollTo"];
    // A 1000px chart with the 320px task list and 44px day columns: 15
    // whole columns fit beside the list.
    const clientWidth = vi
      .spyOn(HTMLElement.prototype, "clientWidth", "get")
      .mockImplementation(function (this: HTMLElement) {
        return this.dataset.testid === "workspace-timeline-scroll" ? 1000 : 0;
      });
    const rect = vi
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: Element) {
        const width = this.hasAttribute("data-today") ? 44 : 0;
        return {
          x: 0,
          y: 0,
          top: 0,
          left: 0,
          right: width,
          bottom: 0,
          width,
          height: 0,
          toJSON: () => null,
        } as DOMRect;
      });
    try {
      m.query = twoProjects();
      renderTimeline();
      // The chart starts on Sunday Feb 22, so today (Mar 5) is day 11. Days
      // 4 to 18 show, today in the middle, starting on day 4's edge.
      expect(scrollTo).toHaveBeenLastCalledWith({
        left: 4 * 44,
        behavior: "auto",
      });
    } finally {
      clientWidth.mockRestore();
      rect.mockRestore();
      vi.useRealTimers();
    }
  });

  it("hides a month's name rather than show a piece of it at the task list's edge", () => {
    // February's band shows 20px beside the 320px task list.
    const rect = vi
      .spyOn(Element.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: Element) {
        const text = this.textContent ?? "";
        const [left, right] = this.hasAttribute("data-gantt-month-band")
          ? text.startsWith("February")
            ? [300, 340]
            : [340, 2000]
          : [0, 0];
        return {
          x: left,
          y: 0,
          left,
          right,
          top: 0,
          bottom: 0,
          width: right - left,
          height: 0,
          toJSON: () => null,
        } as DOMRect;
      });
    const width = vi
      .spyOn(HTMLElement.prototype, "offsetWidth", "get")
      .mockImplementation(function (this: HTMLElement) {
        return this.hasAttribute("data-gantt-month-label") ? 90 : 0;
      });
    try {
      m.query = twoProjects();
      renderTimeline();
      expect(screen.getByText("February 2026")).toHaveStyle({
        visibility: "hidden",
      });
      expect(screen.getByText("March 2026")).not.toHaveStyle({
        visibility: "hidden",
      });
    } finally {
      rect.mockRestore();
      width.mockRestore();
    }
  });

  it("opens a task from its row", () => {
    m.query = twoProjects();
    renderTimeline();
    fireEvent.click(screen.getByText("A"));
    expect(m.navigate).toHaveBeenCalledTimes(1);
    const options = m.navigate.mock.calls[0]?.[0] as
      | {
          search: (
            previous: Record<string, unknown>,
          ) => Record<string, unknown>;
        }
      | undefined;
    expect(options?.search({ other: 1 })).toEqual({ other: 1, taskId: "a" });
  });

  it("loads more of one project", () => {
    m.query = twoProjects();
    renderTimeline();
    fireEvent.click(screen.getByText("tasks:gantt.showMoreTasks"));
    expect(m.loadMore).toHaveBeenCalledWith("p2");
  });

  it("says so when no task has a date", () => {
    m.query = {
      data: { groups: [], tasks: {}, meta: { projects: [], columns: [] } },
      isError: false,
    };
    renderTimeline();
    expect(screen.getByText("tasks:gantt.noTasks")).toBeInTheDocument();
    expect(
      screen.getByText("tasks:gantt.workspaceNoTasksSubtitle"),
    ).toBeInTheDocument();
  });

  it("offers a retry when the rows fail to load", () => {
    m.query = {
      data: undefined,
      isError: true,
      error: new Error("nope"),
      refetch: m.refetch,
    };
    renderTimeline();
    expect(screen.queryByText("tasks:gantt.noTasks")).toBeNull();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});
