import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type Task from "@/types/task";
import TaskModulesContextSubmenu from "./task-modules-context-submenu";
import { makeModule } from "./test-fixtures";

const state = vi.hoisted(() => ({
  canUpdateModules: true,
  modules: [] as unknown[],
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
    canUpdateModules: () => state.canUpdateModules,
    isCheckingPermissions: false,
  }),
}));

vi.mock("@/hooks/queries/module/use-get-modules", () => ({
  default: () => ({ data: state.modules }),
}));

vi.mock("@/hooks/queries/module/use-get-module-task-map", () => ({
  useModuleTaskIndex: () => ({
    modulesByTask: new Map([["task-1", ["m2"]]]),
    tasksByModule: new Map(),
    isReady: true,
  }),
}));

vi.mock("@/hooks/mutations/module/use-set-task-modules", () => ({
  useSetTaskModules: () => ({ mutate: state.mutate }),
}));

afterEach(() => {
  cleanup();
  state.canUpdateModules = true;
  state.modules = [
    makeModule({ id: "m1", name: "Onboarding", status: "planned" }),
    makeModule({ id: "m2", name: "Billing", status: "in-progress" }),
  ];
  state.mutate.mockReset();
});

state.modules = [
  makeModule({ id: "m1", name: "Onboarding", status: "planned" }),
  makeModule({ id: "m2", name: "Billing", status: "in-progress" }),
];

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
  createdAt: "",
  userId: null,
  assigneeId: null,
  assigneeName: null,
  projectId: "project-1",
} satisfies Task;

function renderSubmenu() {
  render(
    <TaskModulesContextSubmenu
      task={task}
      projectId="project-1"
      workspaceId="ws-1"
    />,
  );
}

describe("TaskModulesContextSubmenu", () => {
  it("lists active modules by status and checks the task's modules", () => {
    renderSubmenu();
    expect(
      screen
        .getAllByRole("menuitemcheckbox")
        .map((item) => [item.textContent, item.getAttribute("aria-checked")]),
    ).toEqual([
      ["Onboarding", "false"],
      ["Billing", "true"],
    ]);
  });

  it("adds or removes the task on click", () => {
    renderSubmenu();
    fireEvent.click(screen.getByText("Onboarding"));
    expect(state.mutate).toHaveBeenCalledWith(
      { taskId: "task-1", projectId: "project-1", addModuleIds: ["m1"] },
      expect.any(Object),
    );
    fireEvent.click(screen.getByText("Billing"));
    expect(state.mutate).toHaveBeenLastCalledWith(
      { taskId: "task-1", projectId: "project-1", removeModuleIds: ["m2"] },
      expect.any(Object),
    );
  });

  it("is hidden without module:update or without active modules", () => {
    state.canUpdateModules = false;
    renderSubmenu();
    expect(screen.queryAllByRole("menuitemcheckbox")).toEqual([]);
    cleanup();

    state.canUpdateModules = true;
    state.modules = [];
    renderSubmenu();
    expect(screen.queryAllByRole("menuitemcheckbox")).toEqual([]);
  });
});
