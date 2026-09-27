import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerTaskPropertySlot } from "@/lib/task-property-slots";
import useCopyTaskDialog from "@/store/copy-task-dialog";
import type Task from "@/types/task";
import TaskCardContextMenuContent from "./task-card-context-menu-content";

const mocks = vi.hoisted(() => ({
  members: [] as Array<{
    userId: string;
    user: { name: string; image: string | null };
  }>,
  updateAssignees: vi.fn(),
  setAssignees: vi.fn(),
  permissions: { update: true, delete: true, assign: true, create: true },
  project: undefined as { id: string; slug: string } | undefined,
  copy: vi.fn(),
  toast: { error: vi.fn(), success: vi.fn() },
  setArchived: vi.fn(),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.members = [];
  mocks.permissions = {
    update: true,
    delete: true,
    assign: true,
    create: true,
  };
  mocks.project = undefined;
  useCopyTaskDialog.getState().close();
});

vi.mock("@/components/ui/context-menu", () => ({
  ContextMenuContent: ({
    children,
  }: {
    children: React.ReactNode;
  }): React.JSX.Element => <div>{children}</div>,
  ContextMenuItem: ({
    children,
    disabled,
    onClick,
  }: {
    children: React.ReactNode;
    disabled?: boolean;
    onClick?: () => void;
  }): React.JSX.Element => (
    <button type="button" disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
  ContextMenuSeparator: (): React.JSX.Element => <div />,
  ContextMenuSub: ({
    children,
  }: {
    children: React.ReactNode;
  }): React.JSX.Element => <div>{children}</div>,
  ContextMenuSubContent: ({
    children,
  }: {
    children: React.ReactNode;
  }): React.JSX.Element => <div>{children}</div>,
  ContextMenuSubTrigger: ({
    children,
  }: {
    children: React.ReactNode;
  }): React.JSX.Element => <div>{children}</div>,
  // A clickable stand-in that reports the next checked state, like the
  // real item, and exposes whether a click would close the menu.
  ContextMenuCheckboxItem: ({
    children,
    checked,
    disabled,
    closeOnClick,
    onCheckedChange,
  }: {
    children: React.ReactNode;
    checked?: boolean;
    disabled?: boolean;
    closeOnClick?: boolean;
    onCheckedChange?: (checked: boolean) => void;
  }): React.JSX.Element => (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={Boolean(checked)}
      disabled={disabled}
      data-close-on-click={String(Boolean(closeOnClick))}
      onClick={() => onCheckedChange?.(!checked)}
    >
      {children}
    </button>
  ),
}));

vi.mock("@/hooks/queries/project/use-get-project", () => ({
  default: () => ({ data: mocks.project }),
}));

vi.mock("@/lib/copy-to-clipboard", () => ({ copyToClipboard: mocks.copy }));

vi.mock("@/hooks/queries/column/use-get-columns", () => ({
  useGetColumns: () => ({
    data: [],
  }),
}));

vi.mock(
  "@/hooks/queries/workspace-users/use-get-active-workspace-users",
  () => ({
    useGetActiveWorkspaceUsers: () => ({
      data: { members: mocks.members },
    }),
  }),
);

vi.mock("@/hooks/mutations/task/use-update-task", () => ({
  useUpdateTask: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("@/hooks/mutations/task/use-update-task-assignees", () => ({
  useUpdateTaskAssignees: () => ({ mutateAsync: mocks.updateAssignees }),
}));

vi.mock("@/hooks/mutations/task/use-set-task-assignees", () => ({
  useSetTaskAssignees: () => ({ mutateAsync: mocks.setAssignees }),
}));

vi.mock("@/components/providers/auth-provider/hooks/use-auth", () => ({
  default: () => ({ user: { id: "me" } }),
}));

vi.mock("@/lib/toast", () => ({ toast: mocks.toast }));

vi.mock("@/hooks/mutations/task/use-update-task-description", () => ({
  useUpdateTaskDescription: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("@/hooks/mutations/task/use-update-task-due-date", () => ({
  useUpdateTaskDueDate: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("@/hooks/mutations/task/use-update-task-status", () => ({
  useUpdateTaskStatus: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("@/hooks/mutations/task/use-update-task-status-priority", () => ({
  useUpdateTaskPriority: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("@/hooks/mutations/task/use-update-task-title", () => ({
  useUpdateTaskTitle: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock("@/hooks/mutations/task/use-archive-task", () => ({
  useArchiveTask: () => ({ mutateAsync: mocks.setArchived }),
}));

vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canUpdateTasks: () => mocks.permissions.update,
    canDeleteTasks: () => mocks.permissions.delete,
    canAssignTasks: () => mocks.permissions.assign,
    canCreateTasks: () => mocks.permissions.create,
  }),
}));

vi.mock("@/store/project", () => ({
  default: () => ({
    project: {
      columns: [],
    },
  }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: { name?: string }) =>
      options?.name ? `${key}:${options.name}` : key,
  }),
}));

const task = {
  id: "task-1",
  title: "Test task",
  number: 1,
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
} as const satisfies Task;

const taskCardContext = {
  projectId: "project-1",
  worskpaceId: "workspace-1",
};

function renderTask(taskToRender: Task) {
  render(
    <TaskCardContextMenuContent
      task={taskToRender}
      taskCardContext={taskCardContext}
      onDeleteClick={vi.fn()}
    />,
  );
}

describe("TaskCardContextMenuContent", () => {
  it("hides Mark as planned for planned tasks", () => {
    renderTask({
      ...task,
      status: "planned",
    });

    expect(
      screen.queryByText("tasks:actions.markAsPlanned"),
    ).not.toBeInTheDocument();
  });

  it("shows Mark as planned for tasks that are not planned", () => {
    renderTask(task);

    expect(screen.getByText("tasks:actions.markAsPlanned")).toBeInTheDocument();
  });

  it("renders context-menu slots between the property submenus and archive", () => {
    const unregister = registerTaskPropertySlot("contextMenu", {
      id: "test-slot",
      Component: ({ task: slotTask, projectId }) => (
        <div>
          slot {slotTask.id} {projectId}
        </div>
      ),
    });
    try {
      renderTask(task);
      const slot = screen.getByText("slot task-1 project-1");
      const assignee = screen.getByText("tasks:assignee.label");
      const archive = screen.getByText("tasks:actions.archive");
      expect(
        assignee.compareDocumentPosition(slot) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(
        slot.compareDocumentPosition(archive) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    } finally {
      unregister();
    }
  });

  it("keeps the built-in items when no slot is registered", () => {
    renderTask(task);

    for (const label of [
      "tasks:contextMenu.copyLink",
      "tasks:priority.label",
      "tasks:status.label",
      "tasks:dueDate.label",
      "tasks:assignee.label",
      "tasks:actions.archive",
      "tasks:actions.delete",
    ]) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });
});

describe("TaskCardContextMenuContent copy actions", () => {
  it("lets viewers copy the link and the key, but not make a copy", async () => {
    mocks.permissions = {
      update: false,
      delete: false,
      assign: false,
      create: false,
    };
    mocks.project = { id: "project-1", slug: "web" };
    mocks.copy.mockResolvedValue(true);
    renderTask(task);

    expect(screen.getByText("tasks:contextMenu.copyLink")).toBeInTheDocument();
    expect(screen.queryByText("tasks:actions.makeCopy")).toBeNull();

    fireEvent.click(screen.getByText("tasks:actions.copyKey"));
    await vi.waitFor(() => expect(mocks.copy).toHaveBeenCalledWith("WEB-1"));
  });

  it("copies a link to the task's own project", async () => {
    mocks.copy.mockResolvedValue(true);
    renderTask({ ...task, projectId: "project-2" });

    fireEvent.click(screen.getByText("tasks:contextMenu.copyLink"));
    await vi.waitFor(() =>
      expect(mocks.copy).toHaveBeenCalledWith(
        expect.stringMatching(
          /\/dashboard\/workspace\/workspace-1\/project\/project-2\/task\/task-1$/,
        ),
      ),
    );
    expect(mocks.toast.success).toHaveBeenCalledWith(
      "tasks:contextMenu.copyLinkSuccess",
    );
  });

  it("opens the copy dialog for the task with task:create", () => {
    renderTask(task);

    fireEvent.click(screen.getByText("tasks:actions.makeCopy"));
    expect(useCopyTaskDialog.getState().target).toEqual({
      taskId: "task-1",
      projectId: "project-1",
      workspaceId: "workspace-1",
    });
  });
});

describe("TaskCardContextMenuContent assignees", () => {
  const assigned = {
    ...task,
    userId: "ana",
    assigneeId: "ana",
    assigneeName: "Ana",
    assigneeIds: ["ana"],
    assignees: [{ id: "ana", name: "Ana", image: null }],
  } satisfies Task;

  function setMembers() {
    mocks.members = [
      { userId: "ana", user: { name: "Ana", image: null } },
      { userId: "me", user: { name: "Me Myself", image: null } },
    ];
  }

  it("lists me first and toggles a person without closing the menu", () => {
    setMembers();
    renderTask(assigned);

    const items = screen.getAllByRole("menuitemcheckbox");
    const people = items.filter((item) =>
      /Ana|Me Myself/.test(item.textContent ?? ""),
    );
    expect(people).toHaveLength(2);
    expect(people[0]).toHaveTextContent("tasks:assignees.you:Me Myself");
    expect(people[1]).toHaveTextContent("Ana");
    expect(people[1]).toHaveAttribute("aria-checked", "true");

    const me = people[0];
    expect(me).toHaveAttribute("aria-checked", "false");
    expect(me).toHaveAttribute("data-close-on-click", "false");
    fireEvent.click(me);
    expect(mocks.updateAssignees).toHaveBeenCalledWith({
      taskId: "task-1",
      projectId: "project-1",
      workspaceId: "workspace-1",
      add: ["me"],
    });

    fireEvent.click(people[1]);
    expect(mocks.updateAssignees).toHaveBeenLastCalledWith(
      expect.objectContaining({ remove: ["ana"] }),
    );
  });

  it("clears everyone with Unassigned", () => {
    setMembers();
    renderTask(assigned);

    const unassigned = screen.getByRole("menuitemcheckbox", {
      name: /tasks:assignee\.unassigned/,
    });
    expect(unassigned).toHaveAttribute("aria-checked", "false");
    fireEvent.click(unassigned);
    expect(mocks.setAssignees).toHaveBeenCalledWith({
      taskId: "task-1",
      projectId: "project-1",
      workspaceId: "workspace-1",
      assigneeIds: [],
    });
  });

  it("keeps a former member listed, checked, so they can be removed", () => {
    setMembers();
    renderTask({
      ...assigned,
      assigneeIds: ["ana", "gone"],
      assignees: [
        { id: "ana", name: "Ana", image: null },
        { id: "gone", name: "Gone Person", image: null },
      ],
    });

    const former = screen.getByRole("menuitemcheckbox", {
      name: /Gone Person/,
    });
    expect(former).toHaveAttribute("aria-checked", "true");
    expect(former).toHaveTextContent("tasks:assignees.formerMember");
    fireEvent.click(former);
    expect(mocks.updateAssignees).toHaveBeenCalledWith(
      expect.objectContaining({ remove: ["gone"] }),
    );
  });
});
