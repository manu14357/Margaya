import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TaskQueryStateHandle } from "@/hooks/use-task-query-state";
import type { FilterNode, TaskQueryScope } from "@/lib/task-query/model";
import LayoutToggle from "./layout-toggle";
import TaskToolbar from "./task-toolbar";

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/components/ai/filters/ai-filter-button", () => ({
  default: () => null,
}));
vi.mock("@/hooks/queries/project/use-get-projects", () => ({
  default: () => ({ data: [] }),
}));
// Only its "Custom date…" path: it asks the toolbar for a new date chip.
vi.mock("./filter-menu", () => ({
  default: ({
    onEditDate,
  }: {
    onEditDate: (subject: Record<string, unknown>) => void;
  }) => (
    <button
      type="button"
      onClick={() =>
        onEditDate({
          id: "dueDate",
          key: "dueDate",
          label: "Due date",
          kind: "date",
        })
      }
    >
      custom date
    </button>
  ),
}));
vi.mock("./date-condition-editor", () => ({
  default: () => <div data-testid="date-editor" />,
}));
vi.mock("./filter-chip", () => ({
  default: ({ subject }: { subject: { label: string } }) => (
    <span data-testid="chip">{subject.label}</span>
  ),
}));
vi.mock("./subjects", () => ({
  useFilterSubjects: () => [
    {
      id: "assignee",
      key: "assignee",
      label: "Assignee",
      kind: "set",
      options: [],
    },
  ],
}));

afterEach(cleanup);

const MY_TASKS = "tasks:filters.myTasks";
const project: TaskQueryScope = { kind: "project", projectId: "p" };

function Toolbar({
  scope = project,
  initial = null,
  hiddenSubjects,
}: {
  scope?: TaskQueryScope;
  initial?: FilterNode | null;
  hiddenSubjects?: string[];
}) {
  const [filters, setFilters] = useState<FilterNode | null>(initial);
  const handle = {
    filters,
    archived: "exclude",
    hasActiveFilters: Boolean(filters),
    setFilters: (
      next: FilterNode | null | ((previous: FilterNode | null) => FilterNode),
    ) => setFilters(typeof next === "function" ? next(filters) : next),
    clearFilters: () => setFilters(null),
    setArchived: vi.fn(),
  } as unknown as TaskQueryStateHandle;
  return (
    <TaskToolbar
      workspaceId="w"
      scope={scope}
      handle={handle}
      hiddenSubjects={hiddenSubjects}
    />
  );
}

describe("TaskToolbar my tasks", () => {
  it("filters to my tasks in one click, and back in another", () => {
    render(<Toolbar />);
    const button = screen.getByRole("button", { name: MY_TASKS });
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByTestId("chip")).toBeNull();

    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("chip")).toHaveTextContent("Assignee");

    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByTestId("chip")).toBeNull();
  });

  it("reads as on when the filter was set some other way", () => {
    render(
      <Toolbar
        initial={{
          op: "and",
          children: [{ key: "assignee", operator: "in", values: ["me"] }],
        }}
      />,
    );
    expect(screen.getByRole("button", { name: MY_TASKS })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("is not offered across projects, without the subject, or on a read-only tree", () => {
    const { unmount } = render(
      <Toolbar
        scope={{ kind: "workspace", workspaceId: "w" } as TaskQueryScope}
      />,
    );
    expect(screen.queryByRole("button", { name: MY_TASKS })).toBeNull();
    unmount();

    const hidden = render(<Toolbar hiddenSubjects={["assignee"]} />);
    expect(screen.queryByRole("button", { name: MY_TASKS })).toBeNull();
    hidden.unmount();

    render(
      <Toolbar
        initial={{
          op: "and",
          children: [
            {
              op: "or",
              children: [{ key: "priority", operator: "in", values: ["high"] }],
            },
          ],
        }}
      />,
    );
    expect(screen.queryByRole("button", { name: MY_TASKS })).toBeNull();
  });
});

describe("TaskToolbar custom date", () => {
  it("opens one editor for the new date filter, with its entrance", () => {
    render(<Toolbar />);
    fireEvent.click(screen.getByRole("button", { name: "custom date" }));

    // The toolbar lays its chips out twice, for wide and narrow screens. A
    // second, hidden chip's editor showed at the page's top left corner.
    const popups = document.querySelectorAll("[data-slot=popover-popup]");
    expect(popups).toHaveLength(1);
    expect(screen.getAllByTestId("date-editor")).toHaveLength(1);
    // Opened after it mounts, so it fades in where it belongs.
    expect(popups[0]).toHaveAttribute("data-starting-style");
  });
});

describe("LayoutToggle", () => {
  const layouts = ["list", "calendar"] as const;

  it("names each layout once on screen under the tab row, and still for screen readers", () => {
    render(
      <LayoutToggle
        layouts={layouts}
        value="list"
        onChange={vi.fn()}
        iconsOnly
      />,
    );
    expect(screen.queryByText("tasks:view.list")).toBeNull();
    expect(
      screen.getByRole("button", { name: "tasks:view.list" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(
      screen.getByRole("button", { name: "tasks:calendar.title" }),
    ).toHaveAttribute("title", "tasks:calendar.title");
  });

  it("keeps its labels away from a project's tab row", () => {
    render(<LayoutToggle layouts={layouts} value="list" onChange={vi.fn()} />);
    expect(screen.getByText("tasks:view.list")).toBeInTheDocument();
  });

  it("switches layout", () => {
    const onChange = vi.fn();
    render(
      <LayoutToggle
        layouts={layouts}
        value="list"
        onChange={onChange}
        iconsOnly
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "tasks:calendar.title" }),
    );
    expect(onChange).toHaveBeenCalledWith("calendar");
  });
});
