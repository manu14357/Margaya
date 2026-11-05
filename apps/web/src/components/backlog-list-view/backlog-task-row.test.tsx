import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import EstimateCardChip from "@/components/estimate/estimate-card-chip";
import { makeEstimate } from "@/components/estimate/test-fixtures";
import { getEstimateValueMap } from "@/lib/estimate/totals";
import { formatDateShort } from "@/lib/format";
import { i18n } from "@/lib/i18n";
import { registerTaskPropertySlot } from "@/lib/task-property-slots";
import useBacklogBulkSelectionStore from "@/store/backlog-bulk-selection";
import type Task from "@/types/task";
import BacklogTaskRow from "./backlog-task-row";

const mocks = vi.hoisted(() => ({
  preferences: {
    showAssignees: true,
    showDueDates: true,
    showLabels: true,
    showTaskNumbers: true,
    showEstimates: true,
  } as Record<string, boolean>,
  activeEstimate: vi.fn(),
  customFieldValues: vi.fn(),
  navigate: vi.fn(),
}));

const cleanups: Array<() => void> = [];

afterEach(() => {
  cleanup();
  for (const undo of cleanups.splice(0)) undo();
  mocks.preferences.showEstimates = true;
  mocks.activeEstimate.mockReset();
  mocks.customFieldValues.mockReset();
  vi.clearAllMocks();
});

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock("@/hooks/mutations/task/use-delete-task", () => ({
  useDeleteTask: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "workspace-1" } }),
}));

vi.mock(
  "@/hooks/queries/workspace-users/use-get-active-workspace-users",
  () => ({
    useGetActiveWorkspaceUsers: () => ({ data: { members: [] } }),
  }),
);

vi.mock(
  "@/hooks/queries/custom-field/use-get-custom-field-values-by-project",
  () => ({ default: () => ({ data: mocks.customFieldValues() ?? [] }) }),
);

// The slot outlet reads the project for feature gating; the test slots
// below need no feature.
vi.mock("@/hooks/queries/project/use-get-project", () => ({
  default: () => ({ data: undefined }),
}));

vi.mock("@/hooks/queries/estimate/use-active-estimate", () => ({
  useActiveEstimate: () => mocks.activeEstimate(),
}));

vi.mock(
  "../kanban-board/task-card-context-menu/task-card-context-menu-content",
  () => ({ default: () => null }),
);

vi.mock("@/store/project", () => ({
  default: () => ({ project: { id: "project-1", slug: "kan" } }),
}));

vi.mock("@/store/user-preferences", () => ({
  useUserPreferencesStore: (
    selector?: (state: Record<string, boolean>) => unknown,
  ) => (selector ? selector(mocks.preferences) : mocks.preferences),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

const task: Task = {
  id: "task-1",
  title: "Backlog row",
  number: 3,
  description: null,
  status: "planned",
  priority: null,
  startDate: null,
  dueDate: null,
  position: 1,
  createdAt: "2026-08-05T00:00:00.000Z",
  userId: null,
  assigneeId: null,
  assigneeName: null,
  projectId: "project-1",
  labels: [{ id: "label-1", name: "Bug", color: "red" }],
};

function isBefore(first: Node, second: Node) {
  return Boolean(
    first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
}

describe("BacklogTaskRow", () => {
  it("writes the due date in the app's language", async () => {
    const dueDate = "2026-10-05T12:00:00.000Z";
    await i18n.changeLanguage("de-DE");
    try {
      render(<BacklogTaskRow task={{ ...task, dueDate }} />);
      expect(
        screen.getByText(formatDateShort(new Date(dueDate), "de-DE")),
      ).toBeTruthy();
      expect(screen.queryByText("Oct 5")).toBeNull();
    } finally {
      await i18n.changeLanguage("en-US");
    }
  });

  it("renders the card chip slots after the custom field chip, before the assignee", () => {
    mocks.customFieldValues.mockReturnValue([
      {
        id: "value-1",
        taskId: "task-1",
        fieldId: "field-1",
        fieldName: "Size",
        fieldPosition: 0,
        value: "L",
      },
    ]);
    cleanups.push(
      registerTaskPropertySlot("cardChip", {
        id: "test-chip",
        Component: ({ task: slotTask, projectId, workspaceId }) => (
          <span>
            chip {slotTask.id} {projectId} {workspaceId}
          </span>
        ),
      }),
    );

    render(<BacklogTaskRow task={task} />);

    const chip = screen.getByText("chip task-1 project-1 workspace-1");
    const customFields = screen.getByLabelText("tasks:customFields.ariaLabel");
    const assignee = screen.getByTitle("tasks:assignee.unassigned");
    expect(isBefore(customFields, chip)).toBe(true);
    expect(isBefore(chip, assignee)).toBe(true);
  });

  it("leaves the chip group empty, so it collapses, when no chip renders", () => {
    cleanups.push(
      registerTaskPropertySlot("cardChip", {
        id: "nothing",
        Component: () => null,
      }),
    );

    const { container } = render(<BacklogTaskRow task={task} />);

    const group = container.querySelector(".empty\\:hidden");
    expect(group).not.toBeNull();
    expect(group).toBeEmptyDOMElement();
  });

  it("shows the estimate chip only while the Estimates display option is on", () => {
    const estimate = makeEstimate("points", ["1", "3", "5"]);
    mocks.activeEstimate.mockReturnValue({
      estimate,
      pointsById: getEstimateValueMap(estimate),
    });
    cleanups.push(
      registerTaskPropertySlot("cardChip", {
        id: "estimate",
        Component: EstimateCardChip,
      }),
    );
    const estimated = { ...task, estimatePointId: "estimate-1-p2" };

    const { rerender } = render(<BacklogTaskRow task={estimated} />);
    expect(screen.getByTitle("tasks:estimate.label: 3")).toHaveTextContent("3");

    mocks.preferences.showEstimates = false;
    rerender(<BacklogTaskRow task={estimated} />);
    expect(screen.queryByTitle("tasks:estimate.label: 3")).toBeNull();
  });

  it("selects with its checkbox and leaves the other selection store alone", () => {
    render(<BacklogTaskRow task={task} />);

    fireEvent.click(screen.getByRole("checkbox"));
    expect(useBacklogBulkSelectionStore.getState().isSelected(task.id)).toBe(
      true,
    );

    act(() => useBacklogBulkSelectionStore.getState().clearSelection());
    expect(screen.getByRole("checkbox")).not.toBeChecked();
  });

  it("opens the focused row with Enter, leaving Enter on its controls alone", () => {
    render(<BacklogTaskRow task={task} />);

    fireEvent.keyDown(screen.getByRole("checkbox"), { key: "Enter" });
    expect(mocks.navigate).not.toHaveBeenCalled();

    const row = screen.getByText(task.title).closest("[tabindex]") as Element;
    fireEvent.keyDown(row, { key: "Enter" });
    expect(mocks.navigate).toHaveBeenCalledWith({
      to: ".",
      search: { taskId: task.id },
    });
  });

  it("offers no checkbox when it is not selectable", () => {
    render(<BacklogTaskRow task={task} selectable={false} />);
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("shows the row as selected while the task is in the selection", () => {
    const { container } = render(<BacklogTaskRow task={task} />);
    const row = () => container.querySelector("[data-selected]");
    expect(row()).toBeNull();

    act(() => useBacklogBulkSelectionStore.getState().selectTask(task.id));
    expect(row()).not.toBeNull();

    act(() => useBacklogBulkSelectionStore.getState().clearSelection());
    expect(row()).toBeNull();
  });
});
