import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import useBulkSelectionStore from "@/store/bulk-selection";
import type Task from "@/types/task";
import TaskCard from "./task-card";

const preferences: Record<string, boolean> = {
  showAssignees: true,
  showDueDates: true,
  showLabels: true,
  showTaskNumbers: true,
  showEstimates: true,
};

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("@/hooks/mutations/task/use-delete-task", () => ({
  useDeleteTask: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock(
  "@/hooks/queries/custom-field/use-get-custom-field-values-by-project",
  () => ({ default: () => ({ data: [] }) }),
);
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "workspace-1" } }),
}));
vi.mock(
  "@/hooks/queries/workspace-users/use-get-active-workspace-users",
  () => ({ useGetActiveWorkspaceUsers: () => ({ data: { members: [] } }) }),
);
vi.mock("@/hooks/queries/project/use-get-project", () => ({
  default: () => ({ data: undefined }),
}));
vi.mock("./task-card-context-menu/task-card-context-menu-content", () => ({
  default: () => null,
}));
vi.mock("@/store/project", () => ({
  default: () => ({ project: { id: "project-1", slug: "kan" } }),
}));
vi.mock("@/store/user-preferences", () => ({
  useUserPreferencesStore: (
    selector?: (state: Record<string, boolean>) => unknown,
  ) => (selector ? selector(preferences) : preferences),
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

const task: Task = {
  id: "task-1",
  title: "Card",
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
  labels: [],
  externalLinks: [],
};

afterEach(() => {
  cleanup();
  useBulkSelectionStore.getState().clearSelection();
});

describe("TaskCard", () => {
  it("shows the card as selected while the task is in the selection", () => {
    const { container } = render(<TaskCard task={task} />);
    const card = () => container.querySelector("[data-selected]");
    expect(card()).toBeNull();

    act(() => useBulkSelectionStore.getState().selectTask(task.id));
    expect(card()).not.toBeNull();

    act(() => useBulkSelectionStore.getState().clearSelection());
    expect(card()).toBeNull();
  });
});
