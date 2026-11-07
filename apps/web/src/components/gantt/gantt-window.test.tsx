import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentType, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatDate, formatDateMedium } from "@/lib/format";
import { i18n } from "@/lib/i18n";

const m = vi.hoisted(() => ({
  component: (() => null) as ComponentType,
  navigate: vi.fn(),
  update: vi.fn(),
  tasks: [] as Record<string, unknown>[],
}));
vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: { component: ComponentType }) => {
    m.component = options.component;
    return {
      useParams: () => ({ projectId: "project", workspaceId: "workspace" }),
      useSearch: () => ({}),
    };
  },
  useNavigate: () => m.navigate,
}));
vi.mock("@/components/common/project-layout", () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/page-title", () => ({ default: () => null }));
vi.mock("@/components/task/task-details-sheet", () => ({
  default: () => null,
}));
vi.mock("@/hooks/queries/task/use-get-tasks", () => ({
  useGetTasks: () => ({
    data: {
      name: "Project",
      slug: "PROJ",
      columns: [{ tasks: m.tasks }],
      plannedTasks: [],
    },
  }),
}));
vi.mock("@/hooks/mutations/task/use-update-task-dates", () => ({
  useUpdateTaskDates: () => ({ mutate: m.update, mutateAsync: m.update }),
}));
// The project has no custom fields, so the Gantt offers no field choice.
vi.mock(
  "@/hooks/queries/custom-field/use-get-custom-fields-by-project",
  () => ({
    default: () => ({ data: [] }),
  }),
);
vi.mock(
  "@/hooks/queries/custom-field/use-get-custom-field-values-by-project",
  () => ({ default: () => ({ data: undefined }) }),
);
vi.mock("@/hooks/queries/task-relation/use-get-project-dependencies", () => ({
  useGetProjectDependencies: () => ({ data: undefined }),
}));
vi.mock("@/hooks/mutations/task-relation/use-create-task-relation", () => ({
  default: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@/hooks/mutations/task/use-apply-date-cascade", () => ({
  useApplyDateCascade: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canUpdateTasks: () => true,
    canCreateTasks: () => false,
  }),
}));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/store/user-preferences", () => ({
  useUserPreferencesStore: () => 1,
}));
vi.mock("@/lib/i18n/domain", () => ({
  getStatusLabel: (status: string) => status,
  getPriorityLabel: (priority: string) => priority,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));
vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn() } }));
// No filters set: the Tasks section's filters keep every task.
vi.mock("@/hooks/use-project-layout-filter", () => ({
  useProjectLayoutFilter: ({ project }: { project: unknown }) => ({
    queryState: {},
    filteredProject: project,
    status: undefined,
  }),
}));
vi.mock("@/components/task-filters/project-filter-bar", () => ({
  default: () => null,
}));

await import(
  "@/routes/_layout/_authenticated/dashboard/workspace/$workspaceId/project/$projectId/gantt"
);
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
  // jsdom has no scrollTo; the chart centres on today with it.
  Object.defineProperty(HTMLElement.prototype, "scrollTo", {
    configurable: true,
    value: vi.fn(),
  });
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("PointerEvent", MouseEvent);
});
function task(id: string, startDate: string, dueDate: string) {
  return {
    id,
    projectId: "project",
    title: id,
    number: 1,
    status: "to-do",
    startDate,
    dueDate,
    description: "",
    labels: [],
    priority: "low",
    position: 1,
  };
}
function show() {
  const Component = m.component;
  return render(<Component />);
}
const periodStart = () =>
  screen.getByRole("button", { name: /tasks:gantt\.periodStart/ });

describe("Gantt window UI", () => {
  it("renders a bounded grid for a centuries-long legacy task and makes clipped bars safe to open", () => {
    m.tasks = [task("Long-lived", "0001-01-01", "9999-12-31")];
    const { container } = show();
    const grids = Array.from(
      container.querySelectorAll<HTMLElement>(
        '[style*="grid-template-columns: repeat"]',
      ),
    );
    expect(grids.length).toBeGreaterThan(0);
    expect(
      grids.every((grid) => /repeat\(91,/.test(grid.style.gridTemplateColumns)),
    ).toBe(true);
    expect(
      screen.getByRole("button", { name: "tasks:gantt.resizeStart" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "tasks:gantt.resizeDue" }),
    ).toBeDisabled();
    fireEvent.pointerDown(
      screen.getByRole("button", { name: "tasks:gantt.taskAriaLabel" }),
      { button: 0 },
    );
    expect(m.navigate).toHaveBeenCalledWith(
      expect.objectContaining({ search: { taskId: "Long-lived" } }),
    );
    expect(m.update).not.toHaveBeenCalled();
  });

  it("can jump to a far-away task and navigate without losing its row", () => {
    m.tasks = [
      task("Ancient", "0001-01-01", "0001-01-02"),
      task("Future", "9999-12-30", "9999-12-31"),
    ];
    const { container } = show();
    const jump = screen.getAllByRole("button", {
      name: "tasks:gantt.showTaskDates",
    });
    expect(jump).toHaveLength(2);
    fireEvent.click(jump[1]);
    expect(periodStart()).toHaveTextContent(
      formatDateMedium(new Date(9999, 9, 2)),
    );
    expect(
      screen.getByRole("button", { name: "tasks:gantt.nextPeriod" }),
    ).toBeDisabled();
    expect(screen.getByText("Ancient")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "tasks:gantt.previousPeriod" }),
    );
    expect(
      screen.getByRole("button", { name: "tasks:gantt.nextPeriod" }),
    ).not.toBeDisabled();
    expect(
      container.querySelectorAll('[style*="repeat(91,"]').length,
    ).toBeGreaterThan(0);
  });

  it("picks a far-away start from the calendar while keeping the allocated period bounded", async () => {
    m.tasks = [task("Long-lived", "0001-01-01", "9999-12-31")];
    const { container } = show();
    fireEvent.click(periodStart());
    fireEvent.change(await screen.findByLabelText("Choose the Year"), {
      target: { value: "2040" },
    });
    fireEvent.change(screen.getByLabelText("Choose the Month"), {
      target: { value: "0" },
    });
    fireEvent.click(screen.getByRole("button", { name: /January 1st, 2040/ }));
    expect(periodStart()).toHaveTextContent(
      formatDateMedium(new Date(2040, 0, 1)),
    );
    expect(
      container.querySelectorAll('[style*="repeat(91,"]').length,
    ).toBeGreaterThan(0);
  });

  it("names the months and week starts in the app's language", async () => {
    await i18n.changeLanguage("de-DE");
    try {
      m.tasks = [task("Spring", "2026-03-05", "2026-03-06")];
      show();
      expect(screen.getByText("März 2026")).toBeInTheDocument();
      expect(screen.queryByText("March 2026")).toBeNull();
      // Weeks start on Monday here (the mocked preference).
      const weekStart = new Date(2026, 2, 2);
      expect(
        screen.getByText(
          formatDate(weekStart, { month: "short", day: "numeric" }, "de-DE"),
        ),
      ).toBeInTheDocument();
      expect(screen.queryByText("Mar 2")).toBeNull();
      // The task rail's tooltip names its dates the same way.
      const range = `${formatDateMedium(new Date(2026, 2, 5))} – ${formatDateMedium(new Date(2026, 2, 6))}`;
      expect(range).toContain("März");
      expect(document.querySelector(`[title^="${range}"]`)).not.toBeNull();
    } finally {
      await i18n.changeLanguage("en-US");
    }
  });

  it("shows both ends of the period in the locale's date format, not a native date field", () => {
    m.tasks = [
      task("Ancient", "0001-01-01", "0001-01-02"),
      task("Future", "9999-12-30", "9999-12-31"),
    ];
    const { container } = show();
    fireEvent.click(
      screen.getAllByRole("button", { name: "tasks:gantt.showTaskDates" })[1],
    );
    expect(container.querySelector('input[type="date"]')).toBeNull();
    expect(periodStart()).toHaveTextContent(
      formatDateMedium(new Date(9999, 9, 2)),
    );
    expect(
      screen.getByText(`– ${formatDateMedium(new Date(9999, 11, 31))}`),
    ).toBeInTheDocument();
  });
});
