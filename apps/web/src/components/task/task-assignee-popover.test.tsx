import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Task from "@/types/task";
import TaskAssigneePopover from "./task-assignee-popover";

const mocks = vi.hoisted(() => ({
  update: vi.fn(),
  set: vi.fn(),
  canAssign: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/hooks/mutations/task/use-update-task-assignees", () => ({
  useUpdateTaskAssignees: () => ({ mutateAsync: mocks.update }),
}));

vi.mock("@/hooks/mutations/task/use-set-task-assignees", () => ({
  useSetTaskAssignees: () => ({ mutateAsync: mocks.set }),
}));

vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({ canAssignTasks: mocks.canAssign }),
}));

vi.mock(
  "@/hooks/queries/workspace-users/use-get-active-workspace-users",
  () => ({
    useGetActiveWorkspaceUsers: () => ({
      data: {
        members: [
          { userId: "ana", user: { name: "Ana Silva", image: null } },
          { userId: "ben", user: { name: "Ben Ito", image: null } },
          { userId: "cy", user: { name: "Cy Moss", image: null } },
        ],
      },
      isLoading: false,
    }),
  }),
);

vi.mock("@/components/providers/auth-provider/hooks/use-auth", () => ({
  default: () => ({ user: { id: "ben" } }),
}));

vi.mock("@/components/ai/agents/agent-badge", () => ({
  AgentBadgeFor: () => null,
}));
vi.mock("@/lib/toast", () => ({ toast: { error: mocks.toastError } }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) =>
      options ? `${key}(${Object.values(options).join("|")})` : key,
  }),
}));

beforeEach(() => {
  mocks.canAssign.mockReturnValue(true);
  mocks.update.mockResolvedValue({});
  mocks.set.mockResolvedValue({});
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

function makeTask(assigneeIds: string[]): Task {
  return {
    id: "task-1",
    title: "Ship it",
    number: 1,
    description: null,
    status: "to-do",
    priority: null,
    startDate: null,
    dueDate: null,
    position: 0,
    createdAt: "2026-09-01T00:00:00.000Z",
    userId: assigneeIds[0] ?? null,
    assigneeId: assigneeIds[0] ?? null,
    assigneeName: null,
    assigneeIds,
    projectId: "project-1",
  };
}

function renderPopover(task: Task) {
  return render(
    <TaskAssigneePopover task={task} workspaceId="ws">
      <button type="button">open assignees</button>
    </TaskAssigneePopover>,
  );
}

async function openPicker() {
  fireEvent.click(screen.getByText("open assignees"));
  await screen.findAllByRole("menuitemcheckbox");
}

function row(name: RegExp) {
  return screen.getByRole("menuitemcheckbox", { name });
}

describe("TaskAssigneePopover", () => {
  it("adds and removes people with one PATCH each", async () => {
    renderPopover(makeTask(["ana"]));
    await openPicker();

    fireEvent.click(row(/Cy Moss/));
    await waitFor(() =>
      expect(mocks.update).toHaveBeenCalledWith({
        taskId: "task-1",
        projectId: "project-1",
        workspaceId: "ws",
        add: ["cy"],
      }),
    );

    fireEvent.click(row(/Ana Silva/));
    await waitFor(() =>
      expect(mocks.update).toHaveBeenLastCalledWith(
        expect.objectContaining({ remove: ["ana"] }),
      ),
    );
    // The popover stays open for more toggles.
    expect(row(/Ana Silva/)).toBeInTheDocument();
  });

  it("holds only the person whose change is in flight, keeping focus", async () => {
    let finish!: () => void;
    mocks.update.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    renderPopover(makeTask([]));
    await openPicker();

    row(/Cy Moss/).focus();
    fireEvent.click(row(/Cy Moss/));
    await waitFor(() =>
      expect(row(/Cy Moss/)).toHaveAttribute("aria-disabled", "true"),
    );
    expect(row(/Cy Moss/)).toHaveFocus();
    expect(row(/Ana Silva/)).not.toHaveAttribute("aria-disabled");

    await act(async () => finish());
    await waitFor(() =>
      expect(row(/Cy Moss/)).not.toHaveAttribute("aria-disabled"),
    );
  });

  it("shows the server's reason and frees the row when a change fails", async () => {
    mocks.update.mockRejectedValueOnce(
      new Error("A task can have at most 20 assignees"),
    );
    renderPopover(makeTask([]));
    await openPicker();

    fireEvent.click(row(/Ana Silva/));
    await waitFor(() =>
      expect(mocks.toastError).toHaveBeenCalledWith(
        "A task can have at most 20 assignees",
      ),
    );
    expect(row(/Ana Silva/)).toBeEnabled();
    expect(row(/Ana Silva/)).toHaveAttribute("aria-checked", "false");
  });

  it("clears everyone in one request", async () => {
    renderPopover(makeTask(["ana", "cy"]));
    await openPicker();

    fireEvent.click(screen.getByText("tasks:assignees.clear"));
    await waitFor(() =>
      expect(mocks.set).toHaveBeenCalledWith({
        taskId: "task-1",
        projectId: "project-1",
        workspaceId: "ws",
        assigneeIds: [],
      }),
    );
  });

  it("keeps the rows in place when the task's assignees change", async () => {
    const view = renderPopover(makeTask([]));
    await openPicker();
    const order = screen
      .getAllByRole("menuitemcheckbox")
      .map((item) => item.textContent);

    view.rerender(
      <TaskAssigneePopover task={makeTask(["cy"])} workspaceId="ws">
        <button type="button">open assignees</button>
      </TaskAssigneePopover>,
    );

    expect(
      screen.getAllByRole("menuitemcheckbox").map((item) => item.textContent),
    ).toEqual(order);
    expect(row(/Cy Moss/)).toHaveAttribute("aria-checked", "true");
  });

  it("renders only its trigger without the assign permission", () => {
    mocks.canAssign.mockReturnValue(false);
    renderPopover(makeTask(["ana"]));

    fireEvent.click(screen.getByText("open assignees"));
    expect(screen.queryByRole("menuitemcheckbox")).toBeNull();
  });
});
