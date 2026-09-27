import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TaskParentPopover from "./task-parent-popover";

const mocks = vi.hoisted(() => ({
  canUpdate: true,
  relations: [] as unknown[],
  mutate: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({
    t: (key: string, options?: { key?: string }) =>
      options?.key ? `${key}:${options.key}` : key,
  }),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({ canUpdateTasks: () => mocks.canUpdate }),
}));
vi.mock("@/hooks/queries/task-relation/use-get-task-relations", () => ({
  default: () => ({ data: mocks.relations }),
}));
vi.mock("@/hooks/queries/task/use-get-tasks", () => ({
  useGetTasks: (projectId: string) => ({
    isLoading: false,
    data: projectId
      ? {
          slug: "web",
          columns: [
            {
              id: "to-do",
              position: 0,
              tasks: ["t1", "t2", "t3", "t4"].map((id, index) => ({
                id,
                number: index + 1,
                title: `Task ${id}`,
                status: "to-do",
              })),
            },
          ],
          plannedTasks: [],
        }
      : undefined,
  }),
}));
vi.mock("@/hooks/mutations/task-relation/use-set-task-parent", () => ({
  default: () => ({ mutate: mocks.mutate }),
}));
vi.mock("@/lib/toast", () => ({ toast: mocks.toast }));

function summary(id: string) {
  return {
    id,
    title: `Task ${id}`,
    status: "to-do",
    priority: null,
    number: Number(id.slice(1)),
    projectId: "p-web",
    projectSlug: "web",
    projectName: "Web",
    group: "unstarted",
    userId: null,
    assigneeName: null,
    assigneeIds: [],
  };
}

function subtaskRow(parent: string, child: string) {
  return {
    id: `${parent}-${child}`,
    sourceTaskId: parent,
    targetTaskId: child,
    relationType: "subtask",
    createdAt: "2026-09-01T00:00:00.000Z",
    sourceTask: summary(parent),
    targetTask: summary(child),
  };
}

function openPopover() {
  render(
    <TaskParentPopover task={{ id: "t1", projectId: "p-web" }}>
      <button type="button">Parent</button>
    </TaskParentPopover>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Parent" }));
}

beforeEach(() => {
  mocks.canUpdate = true;
  mocks.relations = [];
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TaskParentPopover", () => {
  it("offers project tasks except the task itself and its sub-tasks", async () => {
    // t2 is the parent (listed apart, checked); t3 is a sub-task.
    mocks.relations = [subtaskRow("t2", "t1"), subtaskRow("t1", "t3")];
    openPopover();

    await screen.findByText("tasks:parent.tasksInProject");
    const option = (key: string) =>
      screen.queryAllByText(key).map((node) => node.closest("button"));
    expect(option("WEB-4")).toHaveLength(1);
    expect(option("WEB-3")).toHaveLength(0);
    expect(option("WEB-1")).toHaveLength(0);
    // The current parent is listed once, with a check mark.
    expect(option("WEB-2")).toHaveLength(1);
    expect(
      option("WEB-2")[0]?.querySelector("svg.lucide-check"),
    ).not.toBeNull();
  });

  it("offers Remove parent only when the task has one", async () => {
    openPopover();
    await screen.findByText("tasks:parent.tasksInProject");
    expect(screen.queryByText("tasks:parent.remove")).toBeNull();
    cleanup();

    mocks.relations = [subtaskRow("t2", "t1")];
    openPopover();
    fireEvent.click(await screen.findByText("tasks:parent.remove"));
    expect(mocks.mutate).toHaveBeenCalledWith(
      { taskId: "t1", parentTaskId: null, projectId: "p-web" },
      expect.any(Object),
    );
  });

  it("sets the picked parent and reports it", async () => {
    mocks.mutate.mockImplementation((_variables, options) =>
      options.onSuccess(),
    );
    openPopover();
    fireEvent.click(await screen.findByText("Task t4"));

    expect(mocks.mutate).toHaveBeenCalledWith(
      { taskId: "t1", parentTaskId: "t4", projectId: "p-web" },
      expect.any(Object),
    );
    expect(mocks.toast.success).toHaveBeenCalledWith(
      "tasks:parent.toast.set:WEB-4",
    );
  });

  it("toasts the server's reason when the change is refused", async () => {
    mocks.mutate.mockImplementation((_variables, options) =>
      options.onError(
        new Error("A task can't be a subtask of its own subtask"),
      ),
    );
    openPopover();
    fireEvent.click(await screen.findByText("Task t4"));

    expect(mocks.toast.error).toHaveBeenCalledWith(
      "A task can't be a subtask of its own subtask",
    );
  });

  it("only shows the trigger without task:update", () => {
    mocks.canUpdate = false;
    openPopover();
    expect(screen.queryByPlaceholderText("tasks:parent.search")).toBeNull();
  });
});
