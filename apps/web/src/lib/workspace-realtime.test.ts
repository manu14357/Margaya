import type { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { handleWorkspaceUserMessage } from "./workspace-realtime";

const invalidateQueries = vi.fn(async (_arg: unknown) => {});
const queryClient = { invalidateQueries } as unknown as QueryClient;
const refresh = { session: vi.fn(), workspaces: vi.fn() };

function handle(message: Record<string, unknown>) {
  return handleWorkspaceUserMessage(queryClient, message, {
    currentUserId: "me",
    refresh,
  });
}

const keys = () =>
  invalidateQueries.mock.calls.map(
    ([arg]) => (arg as { queryKey?: unknown }).queryKey ?? "predicate",
  );

beforeEach(() => {
  invalidateQueries.mockClear();
  refresh.session.mockClear();
  refresh.workspaces.mockClear();
});

describe("handleWorkspaceUserMessage", () => {
  it("refreshes every place a teammate's name or avatar shows", () => {
    expect(handle({ type: "USER_PROFILE_UPDATED", userId: "bob" })).toBe(true);
    expect(keys()).toEqual(
      expect.arrayContaining([
        ["workspace-users"],
        ["active-workspace-users"],
        ["workspace-member"],
        ["project-audience"],
        ["tasks"],
        ["task"],
        ["activities"],
        ["comments"],
        ["notifications"],
        ["my-work"],
        "predicate",
      ]),
    );
    // Someone else's change leaves my session alone.
    expect(refresh.session).not.toHaveBeenCalled();
  });

  it("also reloads my session and time zone when the profile is mine", () => {
    handle({ type: "USER_PROFILE_UPDATED", userId: "me" });
    expect(refresh.session).toHaveBeenCalledOnce();
    expect(keys()).toContainEqual(["user", "timezone"]);
  });

  it("refreshes the workspace stores, members page and settings", () => {
    handle({ type: "WORKSPACE_UPDATED", workspaceId: "ws-1" });
    expect(refresh.workspaces).toHaveBeenCalledOnce();
    expect(keys()).toEqual([
      ["workspace", "full"],
      ["workspace-settings", "ws-1"],
      ["cycles"],
    ]);
  });

  it("refreshes every list of projects in the workspace", () => {
    handle({ type: "PROJECTS_UPDATED", workspaceId: "ws-1" });
    expect(keys()).toEqual([
      ["projects", "ws-1"],
      ["favorites", "ws-1"],
      ["recent-visits", "ws-1"],
      ["archives"],
      ["trash"],
    ]);
  });

  it("refreshes label pickers and the labels shown on tasks", () => {
    handle({ type: "LABELS_UPDATED", workspaceId: "ws-1" });
    expect(keys()).toEqual(
      expect.arrayContaining([
        ["labels"],
        ["tasks"],
        ["task"],
        "predicate",
        ["my-work"],
      ]),
    );
  });

  it("refreshes workspace views with their favorites and recents", () => {
    handle({ type: "VIEWS_UPDATED", workspaceId: "ws-1" });
    expect(keys()).toEqual([
      ["views", "ws-1"],
      ["favorites", "ws-1"],
      ["recent-visits", "ws-1"],
    ]);
  });

  it("refreshes favorites and recents when something they show changed", () => {
    handle({ type: "REFERENCES_UPDATED", workspaceId: "ws-1" });
    expect(keys()).toEqual([
      ["favorites", "ws-1"],
      ["recent-visits", "ws-1"],
    ]);
  });

  it("leaves other messages to other handlers", () => {
    expect(handle({ type: "NOTIFICATION_CREATED" })).toBe(false);
    expect(handle({})).toBe(false);
    expect(invalidateQueries).not.toHaveBeenCalled();
  });
});
