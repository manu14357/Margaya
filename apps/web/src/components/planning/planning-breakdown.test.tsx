import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BoardFilters } from "@/lib/task-query/planning-filters";
import {
  BreakdownList,
  useAssigneeItems,
  useLabelItems,
} from "./breakdown-list";
import PlanningBreakdown from "./planning-breakdown";

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/lib/i18n/domain", () => ({
  getPriorityLabel: (priority: string) => `priority ${priority}`,
}));

afterEach(() => {
  cleanup();
});

const empty: BoardFilters = {
  status: null,
  priority: null,
  assignee: null,
  dueDate: null,
  labels: null,
  customFields: null,
};

const columns = [
  { slug: "to-do", group: "unstarted" },
  { slug: "doing", group: "started" },
  { slug: "review", group: "started" },
  { slug: "done", group: "completed" },
];

const progress: ComponentProps<typeof PlanningBreakdown>["progress"] = {
  counts: {
    total: 5,
    backlog: 0,
    unstarted: 1,
    started: 2,
    completed: 1,
    cancelled: 1,
  },
  assignees: [],
  labels: [],
  priorities: [
    { priority: "high", completed: 1, total: 2, cancelled: 0, pending: 1 },
  ],
};

function renderBreakdown(filters: BoardFilters = empty) {
  const updateFilter = vi.fn();
  render(
    <PlanningBreakdown
      progress={progress}
      filters={filters}
      updateFilter={updateFilter}
      updateLabelFilter={vi.fn()}
      columns={columns}
      workspaceLabels={[]}
    />,
  );
  return updateFilter;
}

describe("PlanningBreakdown", () => {
  it("labels its tabs with the shared planning keys", () => {
    renderBreakdown();
    for (const tab of [
      "tabStatus",
      "tabAssignees",
      "tabLabels",
      "tabPriority",
    ]) {
      expect(
        screen.getByRole("tab", { name: `planning:breakdown.${tab}` }),
      ).toBeInTheDocument();
    }
  });

  it("filters the board by a group's columns, and clears it on a second click", () => {
    const updateFilter = renderBreakdown();
    fireEvent.click(
      screen.getByRole("button", { name: /tasks:columnGroups\.started/ }),
    );
    expect(updateFilter).toHaveBeenCalledWith("status", ["doing", "review"]);

    cleanup();
    const again = renderBreakdown({ ...empty, status: ["doing", "review"] });
    const started = screen.getByRole("button", {
      name: /tasks:columnGroups\.started/,
    });
    expect(started).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(started);
    expect(again).toHaveBeenCalledWith("status", null);
  });
});

describe("BreakdownList", () => {
  it("shows the empty text, or nothing without one", () => {
    const { container, rerender } = render(
      <BreakdownList items={[]} emptyText="planning:breakdown.noAssignees" />,
    );
    expect(
      screen.getByText("planning:breakdown.noAssignees"),
    ).toBeInTheDocument();
    rerender(<BreakdownList items={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("names unassigned and unlabeled rows and makes them unclickable", () => {
    function Rows() {
      const assignees = useAssigneeItems([
        {
          userId: null,
          name: null,
          image: null,
          completed: 0,
          total: 2,
          cancelled: 0,
          pending: 2,
        },
      ]);
      const labels = useLabelItems([
        {
          name: null,
          color: null,
          completed: 1,
          total: 1,
          cancelled: 0,
          pending: 0,
        },
      ]);
      return (
        <BreakdownList items={[...assignees, ...labels]} onToggle={vi.fn()} />
      );
    }
    render(<Rows />);
    expect(
      screen.getByRole("button", { name: /planning:breakdown\.unassigned/ }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: /planning:breakdown\.noLabel/ }),
    ).toBeDisabled();
  });
});
