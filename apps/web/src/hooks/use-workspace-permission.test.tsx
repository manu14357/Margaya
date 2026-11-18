import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectScope } from "./use-project-scope";
import { useWorkspacePermission } from "./use-workspace-permission";

const { getMyWorkspacePermissions, getMyProjectRights } = vi.hoisted(() => ({
  getMyWorkspacePermissions: vi.fn(),
  getMyProjectRights: vi.fn(),
}));

vi.mock("@/fetchers/project/project-rights", () => ({ getMyProjectRights }));
vi.mock("@/fetchers/workspace/get-my-workspace-permissions", () => ({
  default: getMyWorkspacePermissions,
}));

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

vi.mock("@/components/providers/auth-provider/hooks/use-auth", () => ({
  default: () => ({ user: { id: "user-1" } }),
}));

/** The API's answer for a member whose role grants `permissions`. */
function answer(permissions: Record<string, string[]>, role = "member") {
  getMyWorkspacePermissions.mockResolvedValue({
    workspaceId: "workspace-1",
    userId: "user-1",
    role,
    joinedAt: "2026-01-01T00:00:00.000Z",
    permissions,
  });
}

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
  answer({
    project: ["create", "read"],
    task: ["create", "read", "update"],
    label: ["create", "read", "update", "delete"],
    cycle: ["create", "read", "update"],
    module: ["create", "read", "update"],
    view: ["create", "read", "update"],
    page: ["create", "read", "update"],
    analytics: ["read"],
    invitation: ["create"],
  });
}

describe("useWorkspacePermission", () => {
  beforeEach(() => {
    getMyWorkspacePermissions.mockReset();
    getMyProjectRights.mockReset();
    getMyProjectRights.mockResolvedValue([]);
  });

  it("keeps update capabilities independent from delete capabilities", async () => {
    answer({
      task: ["create", "read", "update"],
      label: ["create", "read", "update"],
      module: ["create", "read", "update"],
    });

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

  it("answers every capability, my role and my membership from one request", async () => {
    grantMember();
    const { result } = renderHook(() => useWorkspacePermission(), {
      wrapper: createWrapper(),
    });
    expect(result.current.isCheckingPermissions).toBe(true);
    await waitFor(() => {
      expect(result.current.isCheckingPermissions).toBe(false);
    });

    expect(getMyWorkspacePermissions).toHaveBeenCalledTimes(1);
    expect(getMyWorkspacePermissions).toHaveBeenCalledWith("workspace-1");
    expect(result.current.role).toBe("member");
    expect(result.current.isAdmin).toBe(false);
    expect(result.current.member).toMatchObject({
      userId: "user-1",
      role: "member",
    });
    expect(result.current.canCreateProjects()).toBe(true);
    expect(result.current.canManageProjects()).toBe(false);
    expect(result.current.canInviteUsers()).toBe(true);
    expect(result.current.canManageInvitations()).toBe(false);
    expect(result.current.canReadAuditLog()).toBe(false);
    // Ad-hoc checks reuse the cached answer.
    await expect(
      result.current.hasPermission({ task: ["create", "update"] }),
    ).resolves.toBe(true);
    await expect(
      result.current.hasPermission({ task: ["delete"] }),
    ).resolves.toBe(false);
    expect(getMyWorkspacePermissions).toHaveBeenCalledTimes(1);
  });

  it("grants nothing and stops checking when the request fails", async () => {
    getMyWorkspacePermissions.mockRejectedValue(new Error("403"));
    const { result } = renderHook(() => useWorkspacePermission(), {
      wrapper: createWrapper(),
    });
    await waitFor(() => {
      expect(result.current.isCheckingPermissions).toBe(false);
    });
    expect(result.current.role).toBeUndefined();
    expect(result.current.canCreateTasks()).toBe(false);
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
      expect(result.current.role).toBe("member");
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
