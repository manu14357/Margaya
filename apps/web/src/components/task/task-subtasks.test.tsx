import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "@/lib/toast";
import TaskSubtasks, { type TaskSubtasksHandle } from "./task-subtasks";

const mocks = vi.hoisted(() => ({
  canCreateTasks: vi.fn(),
  canUpdateTasks: vi.fn(),
  createTask: vi.fn(),
  getColumns: vi.fn(),
  getRelations: vi.fn(),
  updateTaskStatus: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: unknown }) => children,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/hooks/mutations/task/use-create-task", () => ({
  default: () => ({ mutateAsync: mocks.createTask, isPending: false }),
}));
vi.mock("@/hooks/mutations/task/use-delete-task", () => ({
  useDeleteTask: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock("@/hooks/mutations/task/use-update-task-status", () => ({
  useUpdateTaskStatus: () => ({ mutateAsync: mocks.updateTaskStatus }),
}));
vi.mock("@/hooks/queries/column/use-get-columns", () => ({
  useGetColumns: () => mocks.getColumns(),
}));
vi.mock("@/hooks/queries/task-relation/use-get-task-relations", () => ({
  default: () => mocks.getRelations(),
}));
vi.mock("./subtask-row", () => ({
  default: (props: {
    task: { id: string };
    isCompleted: boolean;
    completeDisabledReason?: string;
    onToggleComplete: () => void;
  }) => (
    <button
      type="button"
      data-testid={`toggle-${props.task.id}`}
      data-reason={props.completeDisabledReason ?? ""}
      disabled={!props.isCompleted && Boolean(props.completeDisabledReason)}
      onClick={props.onToggleComplete}
    >
      {props.isCompleted ? "done" : "open"}
    </button>
  ),
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
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canCreateTasks: mocks.canCreateTasks,
    canUpdateTasks: mocks.canUpdateTasks,
  }),
}));
vi.mock("@/lib/toast", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

beforeEach(() => {
  mocks.getRelations.mockReturnValue({ data: [] });
  mocks.updateTaskStatus.mockResolvedValue({});
  mocks.canCreateTasks.mockReturnValue(true);
  mocks.canUpdateTasks.mockReturnValue(true);
  mocks.getColumns.mockReturnValue({
    data: [
      { id: "todo", slug: "to-do", name: "To Do", isFinal: false },
      { id: "done", slug: "done", name: "Done", isFinal: true },
    ],
    isLoading: false,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TaskSubtasks", () => {
  it("creates a subtask as planned when its parent is planned", async () => {
    mocks.createTask.mockResolvedValue({ id: "subtask-1" });

    render(
      <TaskSubtasks
        taskId="parent-1"
        projectId="project-1"
        workspaceId="workspace-1"
        parentStatus="planned"
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "tasks:subtasks.addAction tasks:subtasks.title",
      }),
    );
    fireEvent.change(
      screen.getByPlaceholderText("tasks:subtasks.inputPlaceholder"),
      { target: { value: "Design login form" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "tasks:subtasks.addAction" }),
    );

    await waitFor(() => expect(mocks.createTask).toHaveBeenCalledTimes(1));
    // One call creates the sub-task and links it to its parent.
    expect(mocks.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ status: "planned", parentId: "parent-1" }),
    );
  });

  it("uses the project's first active column for an active parent", async () => {
    mocks.createTask.mockResolvedValue({ id: "subtask-2" });

    render(
      <TaskSubtasks
        taskId="parent-2"
        projectId="project-1"
        workspaceId="workspace-1"
        parentStatus="in-progress"
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "tasks:subtasks.addAction tasks:subtasks.title",
      }),
    );
    fireEvent.change(
      screen.getByPlaceholderText("tasks:subtasks.inputPlaceholder"),
      { target: { value: "Implement login form" } },
    );
    fireEvent.click(
      screen.getByRole("button", { name: "tasks:subtasks.addAction" }),
    );

    await waitFor(() => expect(mocks.createTask).toHaveBeenCalledTimes(1));
    expect(mocks.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ status: "to-do" }),
    );
  });

  it("blocks active-parent creation until project columns are available", () => {
    mocks.getColumns.mockReturnValue({ data: [], isLoading: true });

    render(
      <TaskSubtasks
        taskId="parent-3"
        projectId="project-1"
        workspaceId="workspace-1"
        parentStatus="in-progress"
      />,
    );

    expect(
      screen.getByRole("button", {
        name: "tasks:subtasks.addAction tasks:subtasks.title",
      }),
    ).toBeDisabled();
  });

  it("hides subtask creation without task-create permission", () => {
    mocks.canCreateTasks.mockReturnValue(false);

    render(
      <TaskSubtasks
        taskId="parent-4"
        projectId="project-1"
        workspaceId="workspace-1"
        parentStatus="planned"
      />,
    );

    expect(
      screen.queryByRole("button", {
        name: "tasks:subtasks.addAction tasks:subtasks.title",
      }),
    ).not.toBeInTheDocument();
  });

  it("checks a subtask into the completed column even after a cancelled one", async () => {
    mocks.getColumns.mockReturnValue({
      data: [
        {
          id: "c1",
          slug: "to-do",
          position: 0,
          group: "unstarted",
          isFinal: false,
        },
        {
          id: "c2",
          slug: "wont-do",
          position: 1,
          group: "cancelled",
          isFinal: true,
        },
        {
          id: "c3",
          slug: "shipped",
          position: 2,
          group: "completed",
          isFinal: true,
        },
      ],
      isLoading: false,
    });
    mocks.getRelations.mockReturnValue({
      data: [subtaskRelation("to-do", "parent-5")],
    });

    render(
      <TaskSubtasks
        taskId="parent-5"
        projectId="project-1"
        workspaceId="workspace-1"
        parentStatus="in-progress"
      />,
    );

    fireEvent.click(screen.getByTestId("toggle-child-1"));
    await waitFor(() =>
      expect(mocks.updateTaskStatus).toHaveBeenCalledWith(
        expect.objectContaining({ id: "child-1", status: "shipped" }),
      ),
    );
  });

  it("unchecks a subtask into the entry column", async () => {
    mocks.getColumns.mockReturnValue({
      data: [
        {
          id: "c1",
          slug: "doing",
          position: 0,
          group: "started",
          isFinal: false,
        },
        {
          id: "c2",
          slug: "ready",
          position: 1,
          group: "unstarted",
          isFinal: false,
        },
        {
          id: "c3",
          slug: "shipped",
          position: 2,
          group: "completed",
          isFinal: true,
        },
      ],
      isLoading: false,
    });
    mocks.getRelations.mockReturnValue({
      data: [subtaskRelation("shipped", "parent-6")],
    });

    render(
      <TaskSubtasks
        taskId="parent-6"
        projectId="project-1"
        workspaceId="workspace-1"
        parentStatus="in-progress"
      />,
    );

    fireEvent.click(screen.getByTestId("toggle-child-1"));
    await waitFor(() =>
      expect(mocks.updateTaskStatus).toHaveBeenCalledWith(
        expect.objectContaining({ status: "ready" }),
      ),
    );
  });

  it("disables checking when the project has no completed column", () => {
    mocks.getColumns.mockReturnValue({
      data: [
        {
          id: "c1",
          slug: "to-do",
          position: 0,
          group: "unstarted",
          isFinal: false,
        },
        {
          id: "c2",
          slug: "wont-do",
          position: 1,
          group: "cancelled",
          isFinal: true,
        },
      ],
      isLoading: false,
    });
    mocks.getRelations.mockReturnValue({
      data: [subtaskRelation("to-do", "parent-7")],
    });

    render(
      <TaskSubtasks
        taskId="parent-7"
        projectId="project-1"
        workspaceId="workspace-1"
        parentStatus="in-progress"
      />,
    );

    const toggle = screen.getByTestId("toggle-child-1");
    expect(toggle).toBeDisabled();
    expect(toggle).toHaveAttribute(
      "data-reason",
      "tasks:subtasks.noCompletedColumn",
    );
  });

  it("holds an Enter made while the columns load and sends it once they do", async () => {
    mocks.createTask.mockResolvedValue({ id: "subtask-q" });
    mocks.getColumns.mockReturnValue({ data: undefined, isLoading: true });
    const ref = createRef<TaskSubtasksHandle>();
    const props = {
      taskId: "parent-q",
      projectId: "project-1",
      workspaceId: "workspace-1",
      parentStatus: "to-do",
    };
    const { rerender } = render(<TaskSubtasks ref={ref} {...props} />);

    act(() => ref.current?.openCreate());
    const input = screen.getByPlaceholderText(
      "tasks:subtasks.inputPlaceholder",
    );
    fireEvent.change(input, { target: { value: "Queued child" } });
    fireEvent.keyDown(input, { key: "Enter" });

    // Not sent yet, not lost: the form shows the submit as pending.
    expect(mocks.createTask).not.toHaveBeenCalled();
    expect(input).toHaveValue("Queued child");
    expect(input).toHaveAttribute("readonly");
    expect(
      screen.getByRole("button", { name: "tasks:subtasks.adding" }),
    ).toBeDisabled();

    mocks.getColumns.mockReturnValue({
      data: [
        { id: "todo", slug: "to-do", name: "To Do", isFinal: false },
        { id: "done", slug: "done", name: "Done", isFinal: true },
      ],
      isLoading: false,
    });
    rerender(<TaskSubtasks ref={ref} {...props} />);

    await waitFor(() => expect(mocks.createTask).toHaveBeenCalledTimes(1));
    expect(mocks.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Queued child", status: "to-do" }),
    );
  });

  it("keeps the title and says why when there is no column for new tasks", () => {
    mocks.getColumns.mockReturnValue({ data: [], isLoading: false });
    const ref = createRef<TaskSubtasksHandle>();
    render(
      <TaskSubtasks
        ref={ref}
        taskId="parent-n"
        projectId="project-1"
        workspaceId="workspace-1"
        parentStatus="to-do"
      />,
    );

    act(() => ref.current?.openCreate());
    const input = screen.getByPlaceholderText(
      "tasks:subtasks.inputPlaceholder",
    );
    fireEvent.change(input, { target: { value: "Nowhere to go" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(mocks.createTask).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith("tasks:subtasks.noEntryColumn");
    expect(input).toHaveValue("Nowhere to go");
  });
});

function subtaskRelation(status: string, parentId: string) {
  return {
    id: "relation-1",
    relationType: "subtask",
    sourceTaskId: parentId,
    targetTask: {
      id: "child-1",
      title: "Child",
      number: 2,
      status,
      priority: null,
      userId: null,
      assigneeName: null,
      projectId: "project-1",
    },
  };
}
