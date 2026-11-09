import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useMentionMembers } from "./use-mention-members";
import { ProjectScope } from "./use-project-scope";
import { useAssigneePeople } from "./use-task-assignees";

// Pickers in a project offer that project's people, so a guest (whose
// workspace member list holds only themselves) can still pick the people they
// work with, and nobody else in the workspace.

const mocks = vi.hoisted(() => ({
  getActiveWorkspaceUsers: vi.fn(),
  getProjectAudience: vi.fn(),
}));

vi.mock("@/fetchers/workspace-user/get-active-workspace-users", () => ({
  default: mocks.getActiveWorkspaceUsers,
}));
vi.mock("@/fetchers/project/project-audience", () => ({
  getProjectAudience: mocks.getProjectAudience,
}));

function wrapper(projectId?: string) {
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

describe("picker people", () => {
  beforeEach(() => {
    mocks.getActiveWorkspaceUsers.mockReset();
    mocks.getProjectAudience.mockReset();
    // What a guest gets from the workspace member list: only themselves.
    mocks.getActiveWorkspaceUsers.mockResolvedValue({
      members: [
        {
          userId: "guest",
          user: { name: "Gus", email: "gus@x.io", image: null },
        },
      ],
    });
    mocks.getProjectAudience.mockResolvedValue([
      { id: "guest", name: "Gus", image: null },
      { id: "mia", name: "Mia", image: "mia.png" },
    ]);
  });

  it("offers the project's people for mentions inside a project", async () => {
    const { result } = renderHook(() => useMentionMembers("ws-1"), {
      wrapper: wrapper("project-1"),
    });
    await waitFor(() => expect(result.current).toHaveLength(2));
    expect(result.current).toEqual([
      { id: "guest", label: "Gus", image: null },
      { id: "mia", label: "Mia", image: "mia.png" },
    ]);
    expect(mocks.getProjectAudience).toHaveBeenCalledWith("project-1");
    expect(mocks.getActiveWorkspaceUsers).not.toHaveBeenCalled();
  });

  it("offers the project's people as assignees inside a project", async () => {
    const { result } = renderHook(() => useAssigneePeople("ws-1"), {
      wrapper: wrapper("project-1"),
    });
    await waitFor(() => expect(result.current.people).toHaveLength(2));
    expect(result.current.people?.map((person) => person.id)).toEqual([
      "guest",
      "mia",
    ]);
  });

  it("keeps the workspace members outside a project", async () => {
    const mentions = renderHook(() => useMentionMembers("ws-1"), {
      wrapper: wrapper(),
    });
    await waitFor(() => expect(mentions.result.current).toHaveLength(1));
    expect(mentions.result.current[0]).toEqual({
      id: "guest",
      label: "Gus",
      image: null,
    });
    const assignees = renderHook(() => useAssigneePeople("ws-1"), {
      wrapper: wrapper(),
    });
    await waitFor(() =>
      expect(assignees.result.current.people).toHaveLength(1),
    );
    expect(mocks.getProjectAudience).not.toHaveBeenCalled();
  });
});
