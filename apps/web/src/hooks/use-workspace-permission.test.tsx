import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectScope } from "./use-project-scope";
import { useWorkspacePermission } from "./use-workspace-permission";

const { hasPermission, getMyProjectRights } = vi.hoisted(() => ({
  hasPermission: vi.fn(),
  getMyProjectRights: vi.fn(),
}));

vi.mock("@/fetchers/project/project-rights", () => ({ getMyProjectRights }));

const VIEWER_STATEMENTS = {
  project: ["read"],
  task: ["read"],
  label: ["read"],
  cycle: ["read"],
  module: ["read"],
  view: ["read"],
  page: ["read"],
  intake: ["create", "read"],
};

vi.mock("@/hooks/queries/workspace/use-active-workspace", () => ({
  default: () => ({ data: { id: "workspace-1" } }),
}));

vi.mock("@/hooks/queries/workspace-users/use-active-workspace-user", () => ({
  useGetActiveWorkspaceUser: () => ({ data: { role: "member" } }),
}));

vi.mock("@/lib/auth-client", () => ({
  authClient: {
    organization: { hasPermission },
  },
}));

function createWrapper(projectId?: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <ProjectScope projectId={projectId}>{children}</ProjectScope>
      </QueryClientProvider>
    );
  };
}

/** A workspace role that grants what a member gets by default. */
function grantMember() {
  const granted: Record<string, Set<string>> = {
    project: new Set(["create", "read"]),
    task: new Set(["create", "read", "update"]),
    label: new Set(["create", "read", "update", "delete"]),
    cycle: new Set(["create", "read", "update"]),
    module: new Set(["create", "read", "update"]),
    view: new Set(["create", "read", "update"]),
    page: new Set(["create", "read", "update"]),
    analytics: new Set(["read"]),
    invitation: new Set(["create"]),
  };
  hasPermission.mockImplementation(
    async ({ permissions }: { permissions: Record<string, string[]> }) => ({
      data: {
        success: Object.entries(permissions).every(([resource, actions]) =>
          actions.every((action) => granted[resource]?.has(action)),
        ),
      },
    }),
  );
}

describe("useWorkspacePermission", () => {
  beforeEach(() => {
    hasPermission.mockReset();
    getMyProjectRights.mockReset();
    getMyProjectRights.mockResolvedValue([]);
  });

  it("keeps update capabilities independent from delete capabilities", async () => {
    const granted = {
      task: new Set(["create", "read", "update"]),
      label: new Set(["create", "read", "update"]),
      module: new Set(["create", "read", "update"]),
    } as Record<string, Set<string>>;

    hasPermission.mockImplementation(
      async ({ permissions }: { permissions: Record<string, string[]> }) => ({
        data: {
          success: Object.entries(permissions).every(([resource, actions]) =>
            actions.every((action) => granted[resource]?.has(action)),
          ),
        },
      }),
    );

    const { result } = renderHook(() => useWorkspacePermission(), {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(result.current.isCheckingPermissions).toBe(false);
    });

    expect(result.current.canCreateTasks()).toBe(true);
    expect(result.current.canUpdateTasks()).toBe(true);
    expect(result.current.canDeleteTasks()).toBe(false);
    expect(result.current.canCreateLabels()).toBe(true);
    expect(result.current.canUpdateLabels()).toBe(true);
    expect(result.current.canDeleteLabels()).toBe(false);
    expect(result.current.canCreateModules()).toBe(true);
    expect(result.current.canUpdateModules()).toBe(true);
    expect(result.current.canDeleteModules()).toBe(false);
  });

  // Each `/organization/*` call otherwise toggles Better Auth's active
  // organization signal, so every check refetched get-full-organization.
  it("checks permissions without signalling the active organization store", async () => {
    hasPermission.mockResolvedValue({ data: { success: true } });
    const { result } = renderHook(() => useWorkspacePermission(), {
      wrapper: createWrapper(),
    });
    await waitFor(() => {
      expect(result.current.isCheckingPermissions).toBe(false);
    });
    await result.current.hasPermission({ project: ["read"] });

    expect(hasPermission.mock.calls.length).toBeGreaterThan(30);
    for (const [request] of hasPermission.mock.calls) {
      expect(request.fetchOptions).toEqual({ disableSignal: true });
    }
  });

  it("caps a project's capabilities by my viewer role there, and not the workspace's", async () => {
    grantMember();
    getMyProjectRights.mockResolvedValue([
      {
        projectId: "project-1",
        projectRole: "viewer",
        statements: VIEWER_STATEMENTS,
      },
    ]);
    const { result } = renderHook(() => useWorkspacePermission(), {
      wrapper: createWrapper("project-1"),
    });
    await waitFor(() => {
      expect(result.current.isCheckingPermissions).toBe(false);
    });

    expect(getMyProjectRights).toHaveBeenCalledWith("workspace-1");
    expect(result.current.projectRole).toBe("viewer");
    for (const can of [
      result.current.canCreateTasks,
      result.current.canUpdateTasks,
      result.current.canUpdateLabels,
      result.current.canCreateCycles,
      result.current.canUpdateModules,
      result.current.canUpdatePages,
      result.current.canReadAnalytics,
    ]) {
      expect(can()).toBe(false);
    }
    // What the viewer role holds stays, and workspace actions aren't capped.
    expect(result.current.canReadPages()).toBe(true);
    expect(result.current.canCreateProjects()).toBe(true);
    expect(result.current.canInviteUsers()).toBe(true);
  });

  it("keeps the workspace's capabilities where no project role caps them", async () => {
    grantMember();
    // Capped elsewhere only.
    getMyProjectRights.mockResolvedValue([
      {
        projectId: "project-2",
        projectRole: "viewer",
        statements: VIEWER_STATEMENTS,
      },
    ]);
    const { result } = renderHook(() => useWorkspacePermission(), {
      wrapper: createWrapper("project-1"),
    });
    await waitFor(() => {
      expect(result.current.isCheckingPermissions).toBe(false);
    });
    expect(result.current.canUpdateTasks()).toBe(true);
    expect(result.current.canCreateCycles()).toBe(true);
    expect(result.current.projectRole).toBeNull();
  });

  it("never grants more than the workspace role, whatever the project role", async () => {
    grantMember();
    getMyProjectRights.mockResolvedValue([
      {
        projectId: "project-1",
        projectRole: "admin",
        statements: { task: ["create", "read", "update", "delete", "assign"] },
      },
    ]);
    const { result } = renderHook(() => useWorkspacePermission(), {
      wrapper: createWrapper("project-1"),
    });
    await waitFor(() => {
      expect(result.current.isCheckingPermissions).toBe(false);
    });
    expect(result.current.canUpdateTasks()).toBe(true);
    expect(result.current.canDeleteTasks()).toBe(false);
  });

  it("holds project capabilities back until the project's rights load", async () => {
    grantMember();
    let resolve: (value: unknown) => void = () => {};
    getMyProjectRights.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      }),
    );
    const { result } = renderHook(() => useWorkspacePermission(), {
      wrapper: createWrapper("project-1"),
    });
    await waitFor(() => {
      expect(hasPermission).toHaveBeenCalled();
    });
    expect(result.current.isCheckingPermissions).toBe(true);
    expect(result.current.canUpdateTasks()).toBe(false);
    resolve([]);
    await waitFor(() => {
      expect(result.current.canUpdateTasks()).toBe(true);
    });
  });

  it("caps nothing outside a project, and answers per project for cross-project lists", async () => {
    grantMember();
    getMyProjectRights.mockResolvedValue([
      {
        projectId: "project-2",
        projectRole: "viewer",
        statements: VIEWER_STATEMENTS,
      },
    ]);
    const { result } = renderHook(() => useWorkspacePermission(), {
      wrapper: createWrapper(),
    });
    await waitFor(() => {
      expect(result.current.isCheckingPermissions).toBe(false);
    });
    expect(result.current.canUpdateTasks()).toBe(true);
    await waitFor(() =>
      expect(result.current.canInProject("project-2", "updateTasks")).toBe(
        false,
      ),
    );
    expect(result.current.canInProject("project-1", "updateTasks")).toBe(true);
    expect(result.current.canInProject("project-2", "inviteUsers")).toBe(true);
    // One request for the whole workspace, however many projects are asked.
    expect(getMyProjectRights).toHaveBeenCalledTimes(1);
  });
});
