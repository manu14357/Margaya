import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { moduleQueryKeys } from "@/hooks/queries/module/module-query-keys";
import type Task from "@/types/task";
import TaskModulesProperty from "./task-modules-property";
import { makeModule } from "./test-fixtures";

const state = vi.hoisted(() => ({
  canUpdateModules: true,
  refs: [] as Array<{ id: string; name: string; status: string }>,
  setTaskModules: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("react-i18next", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-i18next")>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: ({
    children,
    className,
  }: {
    children?: ReactNode;
    className?: string;
  }) => (
    <a href="/module" className={className}>
      {children}
    </a>
  ),
}));

vi.mock("@/hooks/use-workspace-permission", () => ({
  useWorkspacePermission: () => ({
    canUpdateModules: () => state.canUpdateModules,
    canCreateModules: () => state.canUpdateModules,
    isCheckingPermissions: false,
  }),
}));

vi.mock("@/fetchers/module/get-modules", () => ({
  default: async () => modules,
}));

vi.mock("@/fetchers/module/get-task-modules", () => ({
  default: async () => state.refs,
}));

vi.mock("@/fetchers/module/set-task-modules", () => ({
  default: state.setTaskModules,
}));

vi.mock("@/lib/toast", () => ({
  toast: { success: vi.fn(), error: state.toastError },
}));

const modules = [
  makeModule({ id: "m1", name: "Billing", status: "in-progress" }),
  makeModule({ id: "m2", name: "Onboarding", status: "planned" }),
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
  createdAt: "2026-01-01T00:00:00.000Z",
  userId: null,
  assigneeId: null,
  assigneeName: null,
  projectId: "project-1",
} satisfies Task;

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  state.canUpdateModules = true;
  state.setTaskModules.mockReset();
  state.toastError.mockReset();
});

function renderProperty() {
  state.refs = [{ id: "m1", name: "Billing", status: "in-progress" }];
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  queryClient.setQueryData(
    moduleQueryKeys.list("project-1", "active"),
    modules,
  );
  queryClient.setQueryData(
    moduleQueryKeys.task("project-1", task.id),
    state.refs,
  );
  render(
    <QueryClientProvider client={queryClient}>
      <TaskModulesProperty
        task={task}
        layout="stack"
        projectId="project-1"
        workspaceId="ws-1"
      />
    </QueryClientProvider>,
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function toggleOnboarding() {
  fireEvent.click(
    await screen.findByRole("button", { name: "modules:picker.add" }),
  );
  const option = (await screen.findByText("Onboarding")).closest("button");
  if (!option) throw new Error("option missing");
  fireEvent.click(option);
}

const chipNames = () =>
  screen.queryAllByRole("link").map((link) => link.textContent);

describe("TaskModulesProperty", () => {
  it("shows a module at once while the save is still running", async () => {
    const save = deferred<unknown>();
    state.setTaskModules.mockReturnValue(save.promise);
    renderProperty();
    expect(await screen.findByText("Billing")).toBeInTheDocument();

    await toggleOnboarding();

    await waitFor(() =>
      expect(state.setTaskModules).toHaveBeenCalledWith("task-1", {
        addModuleIds: ["m2"],
      }),
    );
    await waitFor(() => expect(chipNames()).toEqual(["Billing", "Onboarding"]));
    state.refs = [
      { id: "m1", name: "Billing", status: "in-progress" },
      { id: "m2", name: "Onboarding", status: "planned" },
    ];
    save.resolve(state.refs);
    await waitFor(() => expect(chipNames()).toEqual(["Billing", "Onboarding"]));
    expect(state.toastError).not.toHaveBeenCalled();
  });

  it("rolls the change back and says so when the save fails", async () => {
    const save = deferred<unknown>();
    state.setTaskModules.mockReturnValue(save.promise);
    renderProperty();
    await toggleOnboarding();
    await waitFor(() => expect(chipNames()).toContain("Onboarding"));

    save.reject(new Error("nope"));

    await waitFor(() => expect(chipNames()).toEqual(["Billing"]));
    expect(state.toastError).toHaveBeenCalledWith(
      "modules:toast.membershipError",
    );
  });

  it("only lists the modules without module:update", async () => {
    state.canUpdateModules = false;
    renderProperty();
    expect(await screen.findByText("Billing")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "modules:picker.add" }),
    ).toBeNull();
  });
});
