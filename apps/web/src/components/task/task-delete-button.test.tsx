import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TaskDeleteButton from "./task-delete-button";

const mocks = vi.hoisted(() => ({
  canDeleteTasks: vi.fn(),
  deleteTask: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
  restoreTask: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/hooks/mutations/task/use-delete-task", () => ({
  useDeleteTask: () => ({
    mutateAsync: mocks.deleteTask,
    isPending: false,
  }),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canDeleteTasks: mocks.canDeleteTasks,
    isCheckingPermissions: false,
  }),
}));
vi.mock("@/lib/toast", () => ({
  toast: { error: mocks.error, success: mocks.success },
}));
vi.mock("@/fetchers/trash/task-trash", () => ({
  restoreTask: mocks.restoreTask,
}));
vi.mock("@/query-client", () => ({
  default: { invalidateQueries: vi.fn() },
}));

beforeEach(() => {
  mocks.canDeleteTasks.mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TaskDeleteButton", () => {
  it("is only shown to users with task deletion permission", () => {
    mocks.canDeleteTasks.mockReturnValue(false);

    render(<TaskDeleteButton taskId="task-1" onDeleted={vi.fn()} />);

    expect(
      screen.queryByRole("button", { name: "tasks:delete.action" }),
    ).toBeNull();
  });

  it("deletes after confirmation and reports success", async () => {
    const onDeleted = vi.fn();
    mocks.deleteTask.mockResolvedValue({ id: "task-1", projectId: "p1" });
    mocks.restoreTask.mockResolvedValue({ id: "task-1" });
    render(<TaskDeleteButton taskId="task-1" onDeleted={onDeleted} />);

    fireEvent.click(
      screen.getByRole("button", { name: "tasks:delete.action" }),
    );
    const deleteButtons = await screen.findAllByRole("button", {
      name: "tasks:delete.action",
    });
    fireEvent.click(deleteButtons.at(-1) as HTMLButtonElement);

    await waitFor(() =>
      expect(mocks.deleteTask).toHaveBeenCalledWith("task-1"),
    );
    expect(mocks.success).toHaveBeenCalledWith(
      "tasks:delete.success",
      expect.objectContaining({
        action: expect.objectContaining({ label: "common:actions.undo" }),
      }),
    );
    expect(onDeleted).toHaveBeenCalledTimes(1);

    // Undo restores the task from the trash.
    mocks.success.mock.calls[0]?.[1]?.action?.onClick();
    await waitFor(() =>
      expect(mocks.restoreTask).toHaveBeenCalledWith("task-1"),
    );
    await waitFor(() =>
      expect(mocks.success).toHaveBeenCalledWith("tasks:archive.restored"),
    );
  });

  it("keeps the current view open and reports a failed deletion", async () => {
    const onDeleted = vi.fn();
    mocks.deleteTask.mockRejectedValue(new Error("Delete denied"));
    render(<TaskDeleteButton taskId="task-1" onDeleted={onDeleted} />);

    fireEvent.click(
      screen.getByRole("button", { name: "tasks:delete.action" }),
    );
    const deleteButtons = await screen.findAllByRole("button", {
      name: "tasks:delete.action",
    });
    fireEvent.click(deleteButtons.at(-1) as HTMLButtonElement);

    await waitFor(() =>
      expect(mocks.error).toHaveBeenCalledWith("Delete denied"),
    );
    expect(mocks.success).not.toHaveBeenCalled();
    expect(onDeleted).not.toHaveBeenCalled();
  });
});
