import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type Task from "@/types/task";
import TaskEstimateContextSubmenu from "./task-estimate-context-submenu";
import { makeEstimate, testTranslate } from "./test-fixtures";

const state = vi.hoisted(() => ({
  canUpdateTasks: true,
  mutate: vi.fn(),
  active: null as ReturnType<typeof makeEstimate> | null,
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: testTranslate }),
}));

vi.mock("@/components/ui/context-menu", () => ({
  ContextMenuSub: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  ContextMenuSubTrigger: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  ContextMenuSubContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  ContextMenuCheckboxItem: ({
    children,
    checked,
    onCheckedChange,
  }: {
    children: ReactNode;
    checked?: boolean;
    onCheckedChange?: () => void;
  }) => (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      onClick={onCheckedChange}
    >
      {children}
    </button>
  ),
}));

vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canUpdateTasks: () => state.canUpdateTasks,
    isCheckingPermissions: false,
  }),
}));

vi.mock("@/hooks/queries/estimate/use-active-estimate", () => ({
  useActiveEstimate: () => ({ estimate: state.active }),
}));

vi.mock("@/hooks/mutations/estimate/use-update-task-estimate", () => ({
  useUpdateTaskEstimate: () => ({ mutate: state.mutate }),
}));

afterEach(() => {
  cleanup();
  state.canUpdateTasks = true;
  state.active = null;
  state.mutate.mockReset();
});

const task = {
  id: "task-1",
  title: "Task",
  number: 1,
  description: null,
  status: "to-do",
  priority: null,
  startDate: null,
  dueDate: null,
  position: 0,
  createdAt: "2026-09-01T00:00:00.000Z",
  userId: null,
  assigneeId: null,
  assigneeName: null,
  projectId: "project-1",
  estimatePointId: "estimate-1-p2",
} satisfies Task;

function renderMenu(taskToRender: Task = task) {
  return render(
    <TaskEstimateContextSubmenu
      task={taskToRender}
      projectId="project-1"
      workspaceId="workspace-1"
    />,
  );
}

describe("TaskEstimateContextSubmenu", () => {
  it("is absent while estimates are inactive", () => {
    const { container } = renderMenu();
    expect(container).toBeEmptyDOMElement();
  });

  it("lists No estimate and the values, checking the current one", () => {
    state.active = makeEstimate("points", ["1", "3"]);
    renderMenu();
    expect(screen.getByText("tasks:contextMenu.estimate")).toBeInTheDocument();
    const items = screen.getAllByRole("menuitemcheckbox");
    expect(items.map((item) => item.textContent)).toEqual([
      "tasks:estimate.none",
      "1 pts",
      "3 pts",
    ]);
    expect(items[2]).toHaveAttribute("aria-checked", "true");
  });

  it("sets a value or clears it", () => {
    state.active = makeEstimate("points", ["1", "3"]);
    renderMenu();
    fireEvent.click(screen.getByText("1 pts"));
    expect(state.mutate).toHaveBeenCalledWith(
      {
        taskId: "task-1",
        projectId: "project-1",
        estimatePointId: "estimate-1-p1",
      },
      expect.any(Object),
    );
    fireEvent.click(screen.getByText("tasks:estimate.none"));
    expect(state.mutate).toHaveBeenLastCalledWith(
      expect.objectContaining({ estimatePointId: null }),
      expect.any(Object),
    );
  });

  it("is absent without task:update or for partial task rows", () => {
    state.active = makeEstimate("points", ["1", "3"]);
    state.canUpdateTasks = false;
    expect(renderMenu().container).toBeEmptyDOMElement();
    cleanup();
    state.canUpdateTasks = true;
    const { estimatePointId: _omitted, ...partial } = task;
    expect(renderMenu(partial).container).toBeEmptyDOMElement();
  });
});
