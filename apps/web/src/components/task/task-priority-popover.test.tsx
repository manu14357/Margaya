import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectScope } from "@/hooks/use-project-scope";
import type Task from "@/types/task";
import TaskPriorityPopover from "./task-priority-popover";

// The real capability hook: a workspace member who is only a viewer in this
// project gets the read-only priority, as the API refuses the edit there.

const mocks = vi.hoisted(() => ({
  hasPermission: vi.fn(),
  getMyProjectRights: vi.fn(),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("@/lib/auth-client", () => ({
  authClient: { organization: { hasPermission: mocks.hasPermission } },
}));
vi.mock("@/fetchers/project/project-rights", () => ({
  getMyProjectRights: mocks.getMyProjectRights,
}));
vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "workspace-1" } }),
}));
vi.mock("@/hooks/queries/workspace-users/use-active-workspace-user", () => ({
  useGetActiveWorkspaceUser: () => ({ data: { role: "member" } }),
}));
vi.mock("@/hooks/mutations/task/use-update-task-status-priority", () => ({
  useUpdateTaskPriority: () => ({ mutateAsync: vi.fn() }),
}));

const task = { id: "task-1", projectId: "project-1", priority: "low" } as Task;

function renderInProject(projectId?: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <ProjectScope projectId={projectId}>
        <TaskPriorityPopover task={task}>
          <button type="button">priority</button>
        </TaskPriorityPopover>
      </ProjectScope>
    </QueryClientProvider>,
  );
}

const trigger = () => screen.getByRole("button", { name: "priority" });

describe("TaskPriorityPopover in a project", () => {
  beforeEach(() => {
    // A workspace member: tasks may be updated workspace-wide.
    mocks.hasPermission.mockImplementation(
      async ({ permissions }: { permissions: Record<string, string[]> }) => ({
        data: {
          success: Object.entries(permissions).every(
            ([resource, actions]) =>
              resource === "task" &&
              actions.every((action) => action !== "delete"),
          ),
        },
      }),
    );
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("offers no edit where the project role is viewer", async () => {
    mocks.getMyProjectRights.mockResolvedValue([
      {
        projectId: "project-1",
        projectRole: "viewer",
        statements: { project: ["read"], task: ["read"] },
      },
    ]);
    renderInProject("project-1");
    await waitFor(() =>
      expect(mocks.getMyProjectRights).toHaveBeenCalledWith("workspace-1"),
    );
    await waitFor(() => expect(mocks.hasPermission).toHaveBeenCalled());
    // Give the capability map time to settle, then check it stayed off.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(trigger()).not.toHaveAttribute("aria-expanded");
  });

  it("offers the edit where nothing caps the workspace role", async () => {
    mocks.getMyProjectRights.mockResolvedValue([]);
    renderInProject("project-1");
    await waitFor(() => expect(trigger()).toHaveAttribute("aria-expanded"));
  });

  it("offers the edit outside a project, whatever caps other projects", async () => {
    mocks.getMyProjectRights.mockResolvedValue([
      {
        projectId: "project-1",
        projectRole: "viewer",
        statements: { project: ["read"], task: ["read"] },
      },
    ]);
    renderInProject();
    await waitFor(() => expect(trigger()).toHaveAttribute("aria-expanded"));
  });
});
