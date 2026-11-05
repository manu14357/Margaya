import {
  DndContext,
  KeyboardSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { SortableContext } from "@dnd-kit/sortable";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatDateShort } from "@/lib/format";
import { i18n } from "@/lib/i18n";
import useBulkSelectionStore from "@/store/bulk-selection";
import type Task from "@/types/task";
import TaskCard from "./task-card";

const navigate = vi.hoisted(() => vi.fn());

const preferences: Record<string, boolean> = {
  showPriority: true,
  showAssignees: true,
  showDueDates: true,
  showLabels: true,
  showTaskNumbers: true,
  showEstimates: true,
};

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canUpdateTasks: () => true,
    canDeleteTasks: () => true,
    canAssignTasks: () => true,
    canUpdateLabels: () => true,
  }),
}));
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
vi.mock("@/lib/i18n/domain", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/i18n/domain")>()),
  getPriorityLabel: (priority: string) => `priority ${priority}`,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { title?: string }) =>
      options?.title ? `${key} ${options.title}` : key,
  }),
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

beforeEach(() => {
  navigate.mockClear();
});

afterEach(() => {
  cleanup();
  useBulkSelectionStore.getState().clearSelection();
});

const cardOf = (container: HTMLElement) =>
  container.querySelector<HTMLElement>("[data-board-card]") as HTMLElement;

describe("TaskCard", () => {
  it("writes the due date in the app's language", async () => {
    const dueDate = "2026-10-05T12:00:00.000Z";
    await i18n.changeLanguage("de-DE");
    try {
      render(<TaskCard task={{ ...task, dueDate }} />);
      expect(
        screen.getByText(formatDateShort(new Date(dueDate), "de-DE")),
      ).toBeTruthy();
      expect(screen.queryByText("Oct 5")).toBeNull();
    } finally {
      await i18n.changeLanguage("en-US");
    }
  });

  it("shows the card as selected while the task is in the selection", () => {
    const { container } = render(<TaskCard task={task} />);
    const card = () => container.querySelector("[data-selected]");
    expect(card()).toBeNull();

    act(() => useBulkSelectionStore.getState().selectTask(task.id));
    expect(card()).not.toBeNull();

    act(() => useBulkSelectionStore.getState().clearSelection());
    expect(card()).toBeNull();
  });

  it("selects with its checkbox without opening the task", () => {
    render(<TaskCard task={task} />);
    const checkbox = screen.getByRole("checkbox", {
      name: "tasks:bulk.selectTask Card",
    });

    fireEvent.click(checkbox);
    expect(useBulkSelectionStore.getState().isSelected(task.id)).toBe(true);
    expect(checkbox).toBeChecked();
    expect(navigate).not.toHaveBeenCalled();

    fireEvent.click(checkbox);
    expect(useBulkSelectionStore.getState().isSelected(task.id)).toBe(false);
  });

  it("keeps the checkbox hidden at rest and in view once anything is selected", () => {
    const { container } = render(<TaskCard task={task} />);
    const control = () =>
      container.querySelector("[data-selection-control]") as HTMLElement;
    expect(control()).toHaveClass("opacity-0");
    expect(control().className).toContain("group-hover/selectable:opacity-100");
    expect(control().className).toContain(
      "group-focus-within/selectable:opacity-100",
    );
    expect(control().className).toContain("pointer-coarse:opacity-100");

    act(() => useBulkSelectionStore.getState().selectTask("another-task"));
    expect(control()).toHaveClass("opacity-100");
    expect(control()).not.toHaveClass("opacity-0");
  });

  it("offers no checkbox when it is not selectable, or on the drag overlay", () => {
    const { rerender } = render(<TaskCard task={task} selectable={false} />);
    expect(screen.queryByRole("checkbox")).toBeNull();
    rerender(<TaskCard task={task} overlay />);
    expect(screen.queryByRole("checkbox")).toBeNull();
  });

  it("opens the focused card with Enter", () => {
    const { container } = render(<TaskCard task={task} />);
    fireEvent.keyDown(cardOf(container), { key: "Enter", code: "Enter" });
    expect(navigate).toHaveBeenCalledWith({
      to: ".",
      search: { taskId: task.id },
    });
  });

  describe("with the board's keyboard sensor", () => {
    function Sortable() {
      const sensors = useSensors(useSensor(KeyboardSensor));
      return (
        <DndContext sensors={sensors}>
          <SortableContext items={[task.id]}>
            <TaskCard task={task} />
          </SortableContext>
        </DndContext>
      );
    }

    it("opens on Enter instead of picking the card up", () => {
      const { container } = render(<Sortable />);

      fireEvent.keyDown(cardOf(container), { key: "Enter", code: "Enter" });

      expect(navigate).toHaveBeenCalledTimes(1);
      expect(cardOf(container)).not.toHaveAttribute("aria-pressed");
    });

    it("picks the card up on Space without opening it", () => {
      const { container } = render(<Sortable />);

      fireEvent.keyDown(cardOf(container), { key: " ", code: "Space" });

      expect(navigate).not.toHaveBeenCalled();
      expect(cardOf(container)).toHaveAttribute("aria-pressed", "true");
    });

    it("does not pick the card up from Space on a control inside it", () => {
      const { container } = render(<Sortable />);

      fireEvent.keyDown(screen.getByRole("checkbox"), {
        key: " ",
        code: "Space",
      });

      expect(cardOf(container)).not.toHaveAttribute("aria-pressed");
    });
  });

  it("leaves Enter on a control inside the card to that control", () => {
    render(<TaskCard task={task} />);
    fireEvent.keyDown(screen.getByRole("checkbox"), {
      key: "Enter",
      code: "Enter",
    });
    expect(navigate).not.toHaveBeenCalled();
  });

  it("shows a priority chip only for a real priority", () => {
    const { rerender } = render(<TaskCard task={task} />);
    expect(screen.queryByRole("img", { name: /^priority/ })).toBeNull();

    rerender(<TaskCard task={{ ...task, priority: "no-priority" }} />);
    expect(screen.queryByRole("img", { name: /^priority/ })).toBeNull();

    rerender(<TaskCard task={{ ...task, priority: "high" }} />);
    expect(
      screen.getByRole("img", { name: "priority high" }),
    ).toBeInTheDocument();
  });

  it("never renders the drag overlay copy as the dragged slot", () => {
    const { container } = render(<TaskCard task={task} overlay />);
    expect(container.querySelector("[data-dragging]")).toBeNull();
  });
});
