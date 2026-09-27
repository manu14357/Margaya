import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import EstimateCardChip from "@/components/estimate/estimate-card-chip";
import { makeEstimate } from "@/components/estimate/test-fixtures";
import { getEstimateValueMap } from "@/lib/estimate/totals";
import { registerTaskPropertySlot } from "@/lib/task-property-slots";
import useBulkSelectionStore from "@/store/bulk-selection";
import type Task from "@/types/task";
import TaskRow from "./task-row";

const mocks = vi.hoisted(() => ({
  preferences: {
    showAssignees: true,
    showDueDates: true,
    showLabels: true,
    showTaskNumbers: true,
    showEstimates: true,
  } as Record<string, boolean>,
  activeEstimate: vi.fn(),
}));

const useExternalLinks = vi.fn((_taskId: string) => ({ data: [] }));
const useGetLabelsByTask = vi.fn((_taskId: string) => ({ data: [] }));
const cleanups: Array<() => void> = [];

afterEach(() => {
  cleanup();
  for (const undo of cleanups.splice(0)) undo();
  mocks.preferences.showEstimates = true;
  mocks.activeEstimate.mockReset();
  vi.clearAllMocks();
});

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock("@/hooks/queries/external-link/use-external-links", () => ({
  default: (taskId: string) => useExternalLinks(taskId),
}));

vi.mock("@/hooks/queries/label/use-get-labels-by-task", () => ({
  default: (taskId: string) => useGetLabelsByTask(taskId),
}));

vi.mock("@/hooks/mutations/task/use-delete-task", () => ({
  useDeleteTask: () => ({ mutateAsync: vi.fn() }),
}));

// Read-only: the triage triggers render plain glyphs (no popovers).
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canUpdateTasks: () => false,
    canAssignTasks: () => false,
  }),
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
  title: "Row from payload",
  number: 7,
  description: null,
  status: "to-do",
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
  externalLinks: [
    {
      id: "link-1",
      taskId: "task-1",
      integrationId: "integration-1",
      resourceType: "pull_request",
      externalId: "42",
      url: "https://github.com/o/r/pull/42",
      title: "Fix it",
      metadata: { merged: false, draft: false },
    },
  ],
};

function isBefore(first: Node, second: Node) {
  return Boolean(
    first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
}

describe("TaskRow", () => {
  it("renders labels and pull requests from the task payload without per-row requests", () => {
    render(<TaskRow task={task} projectSlug="kan" />);

    expect(screen.getByText("Bug")).toBeVisible();
    expect(screen.getByText("#42")).toBeVisible();
    expect(useExternalLinks).not.toHaveBeenCalled();
    expect(useGetLabelsByTask).not.toHaveBeenCalled();
  });

  it("renders the card chip slots between the labels and the pull requests", () => {
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

    render(<TaskRow task={task} projectSlug="kan" />);

    const chip = screen.getByText("chip task-1 project-1 workspace-1");
    expect(isBefore(screen.getByText("Bug"), chip)).toBe(true);
    expect(isBefore(chip, screen.getByText("#42"))).toBe(true);
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
    const estimated = { ...task, estimatePointId: "estimate-1-p3" };

    const { rerender } = render(<TaskRow task={estimated} projectSlug="kan" />);
    expect(screen.getByTitle("tasks:estimate.label: 5")).toHaveTextContent("5");

    mocks.preferences.showEstimates = false;
    rerender(<TaskRow task={estimated} projectSlug="kan" />);
    expect(screen.queryByTitle("tasks:estimate.label: 5")).toBeNull();
  });

  it("shows the row as selected while the task is in the selection", () => {
    const { container } = render(<TaskRow task={task} projectSlug="kan" />);
    const row = () => container.querySelector("[data-selected]");
    expect(row()).toBeNull();

    act(() => useBulkSelectionStore.getState().selectTask(task.id));
    expect(row()).not.toBeNull();

    act(() => useBulkSelectionStore.getState().clearSelection());
    expect(row()).toBeNull();
  });
});
