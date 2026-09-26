import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AddExistingSubtaskDialog from "./add-existing-subtask-dialog";

const mocks = vi.hoisted(() => ({
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
vi.mock("@/hooks/queries/task-relation/use-get-task-relations", () => ({
  default: () => ({ data: mocks.relations }),
}));
vi.mock("@/hooks/queries/task/use-get-tasks", () => ({
  useGetTasks: () => ({
    data: {
      slug: "web",
      columns: [
        {
          id: "to-do",
          position: 0,
          tasks: ["t1", "t2", "t3", "t4", "t5"].map((id, index) => ({
            id,
            number: index + 1,
            title: `Task ${id}`,
            status: "to-do",
          })),
        },
      ],
      plannedTasks: [],
    },
  }),
}));
vi.mock("@/hooks/mutations/task-relation/use-set-task-parent", () => ({
  default: () => ({ mutate: mocks.mutate }),
}));
vi.mock("@/lib/toast", () => ({ toast: mocks.toast }));

function subtaskRow(parent: string, child: string) {
  return {
    id: `${parent}-${child}`,
    sourceTaskId: parent,
    targetTaskId: child,
    relationType: "subtask",
    createdAt: "2026-09-01T00:00:00.000Z",
  };
}

function renderDialog(client = new QueryClient()) {
  render(
    <QueryClientProvider client={client}>
      <AddExistingSubtaskDialog
        open
        onOpenChange={vi.fn()}
        taskId="t1"
        projectId="p-web"
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  // t2 is a sub-task of t1; t3 is t1's parent.
  mocks.relations = [subtaskRow("t1", "t2"), subtaskRow("t3", "t1")];
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AddExistingSubtaskDialog", () => {
  it("offers neither the task, its sub-tasks nor its known ancestors", async () => {
    const client = new QueryClient();
    // t4 is t3's parent, known from its cached relations.
    client.setQueryData(
      ["task-relations", "t3"],
      [subtaskRow("t4", "t3"), subtaskRow("t3", "t1")],
    );
    renderDialog(client);

    expect(await screen.findByText("Task t5")).toBeInTheDocument();
    for (const excluded of ["t1", "t2", "t3", "t4"]) {
      expect(screen.queryByText(`Task ${excluded}`)).toBeNull();
    }
  });

  it("makes the picked task a sub-task of this one", async () => {
    mocks.mutate.mockImplementation((_variables, options) =>
      options.onSuccess(),
    );
    renderDialog();

    fireEvent.click(await screen.findByText("Task t5"));

    expect(mocks.mutate).toHaveBeenCalledWith(
      { taskId: "t5", parentTaskId: "t1", projectId: "p-web" },
      expect.any(Object),
    );
    expect(mocks.toast.success).toHaveBeenCalledWith(
      "tasks:subtasks.addedExisting:WEB-5",
    );
  });
});
