import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useScheduleViewPreferences } from "@/store/schedule-view-preferences";
import ProjectGantt from "./project-gantt";

// The custom field chosen for Calendar and Gantt, in the Gantt's task rail.

const m = vi.hoisted(() => ({
  fields: [] as Record<string, unknown>[],
  values: [] as Record<string, unknown>[],
  valuesProjectIds: [] as string[],
}));

vi.mock(
  "@/hooks/queries/custom-field/use-get-custom-fields-by-project",
  () => ({
    default: () => ({ data: m.fields }),
  }),
);
vi.mock(
  "@/hooks/queries/custom-field/use-get-custom-field-values-by-project",
  () => ({
    default: (projectId: string) => {
      m.valuesProjectIds.push(projectId);
      return { data: projectId ? m.values : undefined };
    },
  }),
);
vi.mock("@/hooks/mutations/task/use-update-task-dates", () => ({
  useUpdateTaskDates: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }),
}));
vi.mock("@/hooks/mutations/task-relation/use-create-task-relation", () => ({
  default: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@/hooks/mutations/task-relation/use-delete-task-relation", () => ({
  default: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@/hooks/mutations/task/use-apply-date-cascade", () => ({
  useApplyDateCascade: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock("@/hooks/queries/task-relation/use-get-project-dependencies", () => ({
  useGetProjectDependencies: () => ({ data: undefined }),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canUpdateTasks: () => false,
    canCreateTasks: () => false,
  }),
}));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: () => false }));
vi.mock("@/store/user-preferences", () => ({
  useUserPreferencesStore: (
    selector: (state: {
      weekStartsOn: number;
      showAssignees: boolean;
    }) => unknown,
  ) => selector({ weekStartsOn: 1, showAssignees: false }),
}));
vi.mock("@/lib/i18n/domain", () => ({
  getStatusLabel: (status: string) => status,
  getPriorityLabel: (priority: string) => priority,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options?.name ? `${options.name}: ${options.value}` : key,
  }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));
vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn() } }));
vi.mock("@/components/task-draft/quick-add", () => ({ default: () => null }));

function task(id: string, title: string) {
  return {
    id,
    projectId: "project",
    title,
    number: 1,
    status: "to-do",
    startDate: "2026-10-01",
    dueDate: "2026-10-10",
    description: "",
    labels: [],
    priority: "low",
    position: 1,
  };
}

function show() {
  const tasks = [task("a", "Kickoff"), task("b", "Launch")];
  const project = {
    id: "project",
    name: "Project",
    slug: "PROJ",
    columns: [{ id: "to-do", slug: "to-do", tasks, group: "unstarted" }],
    plannedTasks: [],
  };
  return render(
    <ProjectGantt
      workspaceId="workspace"
      projectId="project"
      // biome-ignore lint/suspicious/noExplicitAny: a hand-built board.
      loadedProject={project as any}
      // biome-ignore lint/suspicious/noExplicitAny: a hand-built board.
      project={project as any}
      isLoading={false}
      loadFailure={null}
      onOpenTask={vi.fn()}
    />,
  );
}

const railButton = (container: HTMLElement, id: string) =>
  within(
    container.querySelector(`[data-gantt-row="${id}"]`) as HTMLElement,
  ).getAllByRole("button")[0] as HTMLElement;

beforeEach(() => {
  m.fields = [{ id: "f1", name: "Customer", type: "dropdown", options: [] }];
  m.values = [{ taskId: "a", fieldId: "f1", value: "Acme" }];
  m.valuesProjectIds = [];
  useScheduleViewPreferences.setState({
    scheduleFieldByProject: {},
    ganttZoom: "month",
  });
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
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 5));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("a custom field on the Gantt", () => {
  it("offers the field choice and loads no values until one is chosen", () => {
    const { container } = show();
    expect(
      screen.getByRole("combobox", { name: "tasks:scheduleField.label" }),
    ).toHaveTextContent("tasks:scheduleField.none");
    expect(
      container.querySelector("[data-testid=gantt-field-value]"),
    ).toBeNull();
    expect(m.valuesProjectIds.every((id) => id === "")).toBe(true);
  });

  it("has no field choice in a project without custom fields", () => {
    m.fields = [];
    show();
    expect(
      screen.queryByRole("combobox", { name: "tasks:scheduleField.label" }),
    ).toBeNull();
  });

  it("shows the chosen field's value beside the task in the rail", () => {
    useScheduleViewPreferences.getState().setScheduleField("project", "f1");
    const { container } = show();

    const withValue = railButton(container, "a");
    expect(
      within(withValue).getByTestId("gantt-field-value"),
    ).toHaveTextContent("Acme");
    expect(withValue).toHaveAccessibleName(/Kickoff.*Customer: Acme/);
    expect(withValue.getAttribute("title")).toContain("Customer: Acme");

    const withoutValue = railButton(container, "b");
    expect(within(withoutValue).queryByTestId("gantt-field-value")).toBeNull();
    expect(withoutValue.getAttribute("title")).not.toContain("Customer");
    expect(
      screen.getByRole("combobox", { name: "tasks:scheduleField.label" }),
    ).toHaveTextContent("Customer");
  });
});
