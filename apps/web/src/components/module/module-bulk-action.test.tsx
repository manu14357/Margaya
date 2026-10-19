import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ModuleBulkAction from "./module-bulk-action";
import { makeModule } from "./test-fixtures";

const mocks = vi.hoisted(() => ({
  add: vi.fn(),
  remove: vi.fn(),
  scope: null as { projectId: string; moduleId: string } | null,
  toast: { success: vi.fn(), error: vi.fn() },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canUpdateModules: () => true,
    isCheckingPermissions: false,
  }),
}));
vi.mock("@/hooks/queries/module/use-get-modules", () => ({
  default: () => ({
    data: [
      makeModule({ id: "m-billing", name: "Billing" }),
      makeModule({ id: "m-search", name: "Search" }),
    ],
  }),
}));
vi.mock("@/hooks/queries/module/use-get-module-task-map", () => ({
  useModuleTaskIndex: () => ({
    modulesByTask: new Map([["t1", ["m-billing"]]]),
    tasksByModule: new Map([["m-billing", new Set(["t1"])]]),
    isReady: true,
  }),
}));
vi.mock("@/hooks/mutations/module/use-add-module-tasks", () => ({
  useAddModuleTasks: () => ({ mutateAsync: mocks.add, isPending: false }),
}));
vi.mock("@/hooks/mutations/module/use-remove-module-tasks", () => ({
  useRemoveModuleTasks: () => ({ mutateAsync: mocks.remove, isPending: false }),
}));
vi.mock("./module-scope-context", () => ({
  useModuleScope: () => mocks.scope,
}));
vi.mock("@/lib/toast", () => ({ toast: mocks.toast }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.scope = null;
});

const props = {
  taskIds: ["t1", "t2"],
  onDone: vi.fn(),
  projectId: "project-1",
  workspaceId: "ws-1",
  surface: "board" as const,
};

describe("ModuleBulkAction", () => {
  it("removes the selection from a module that holds any of it", async () => {
    mocks.remove.mockResolvedValue({ removed: ["t1"], added: [] });
    render(<ModuleBulkAction {...props} />);

    fireEvent.click(
      screen.getByRole("button", { name: /modules:bulk.removeFromModule/ }),
    );
    // Only the module that holds a selected task is offered.
    expect(screen.queryByRole("button", { name: /Search/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Billing/ }));

    await waitFor(() =>
      expect(mocks.remove).toHaveBeenCalledWith({
        moduleId: "m-billing",
        projectId: "project-1",
        taskIds: ["t1", "t2"],
      }),
    );
    expect(props.onDone).toHaveBeenCalled();
  });

  it("offers no removal when no selected task is in a module", () => {
    render(<ModuleBulkAction {...props} taskIds={["t2"]} />);
    expect(
      screen.queryByRole("button", { name: /modules:bulk.removeFromModule/ }),
    ).toBeNull();
  });
});
