import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type Task from "@/types/task";
import TaskCycleContextSubmenu from "./task-cycle-context-submenu";
import { makeCycle } from "./test-fixtures";

const state = vi.hoisted(() => ({
  canUpdateCycles: true,
  mutate: vi.fn(),
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
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
    disabled,
    onCheckedChange,
  }: {
    children: ReactNode;
    checked?: boolean;
    disabled?: boolean;
    onCheckedChange?: () => void;
  }) => (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={checked}
      disabled={disabled}
      onClick={onCheckedChange}
    >
      {children}
    </button>
  ),
}));

vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canUpdateCycles: () => state.canUpdateCycles,
    isCheckingPermissions: false,
  }),
}));

const cycles = [
  makeCycle({ id: "now", name: "Now", status: "current" }),
  makeCycle({ id: "next", name: "Next", status: "upcoming" }),
  makeCycle({ id: "done", name: "Finished", status: "completed" }),
];

vi.mock("@/hooks/queries/cycle/use-cycle-lookup", () => ({
  useCycleLookup: (_projectId: string, cycleId: string | null | undefined) => ({
    cycles,
    cycle: cycles.find((cycle) => cycle.id === cycleId) ?? null,
  }),
}));

vi.mock("@/hooks/mutations/cycle/use-set-task-cycle", () => ({
  useSetTaskCycle: () => ({ mutate: state.mutate }),
}));

afterEach(() => {
  cleanup();
  state.canUpdateCycles = true;
  state.mutate.mockReset();
});

function task(cycleId: string | null | undefined): Task {
  return {
    id: "task-1",
    title: "Task",
    number: 1,
    description: null,
    status: "to-do",
    priority: null,
    startDate: null,
    dueDate: null,
    position: 0,
    createdAt: "",
    userId: null,
    assigneeId: null,
    assigneeName: null,
    projectId: "project-1",
    cycleId,
  };
}

function renderSubmenu(cycleId: string | null | undefined) {
  render(
    <TaskCycleContextSubmenu
      task={task(cycleId)}
      projectId="project-1"
      workspaceId="ws-1"
    />,
  );
}

const items = () =>
  screen.queryAllByRole("menuitemcheckbox").map((item) => ({
    text: item.textContent,
    checked: item.getAttribute("aria-checked") === "true",
    disabled: (item as HTMLButtonElement).disabled,
  }));

describe("TaskCycleContextSubmenu", () => {
  it("offers No cycle and open cycles, checking the task's cycle", () => {
    renderSubmenu("next");
    expect(items()).toEqual([
      { text: "cycles:picker.none", checked: false, disabled: false },
      { text: "Now", checked: false, disabled: false },
      { text: "Next", checked: true, disabled: false },
    ]);
  });

  it("moves the task on click and removes it with No cycle", () => {
    renderSubmenu("next");
    fireEvent.click(screen.getByText("Now"));
    expect(state.mutate).toHaveBeenCalledWith(
      { taskId: "task-1", projectId: "project-1", cycleId: "now" },
      expect.any(Object),
    );
    fireEvent.click(screen.getByText("cycles:picker.none"));
    expect(state.mutate).toHaveBeenLastCalledWith(
      { taskId: "task-1", projectId: "project-1", cycleId: null },
      expect.any(Object),
    );
  });

  it("lists a completed current cycle checked and disabled", () => {
    renderSubmenu("done");
    expect(items()[1]).toEqual({
      text: "Finished",
      checked: true,
      disabled: true,
    });
  });

  it("is hidden without cycle:update or when the task's cycle is unknown", () => {
    state.canUpdateCycles = false;
    renderSubmenu("next");
    expect(items()).toEqual([]);
    cleanup();

    state.canUpdateCycles = true;
    renderSubmenu(undefined);
    expect(items()).toEqual([]);
  });
});
