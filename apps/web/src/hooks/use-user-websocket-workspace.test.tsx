import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUserWebSocket } from "./use-user-websocket";

const { client, notify } = vi.hoisted(() => ({
  client: { invalidateQueries: vi.fn(async (_arg: unknown) => {}) },
  notify: vi.fn(),
}));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => client }));
vi.mock("@/lib/auth-client", () => ({
  authClient: {
    useSession: () => ({ data: { user: { id: "user-a" } } }),
    $store: { notify },
  },
}));
vi.mock("@margaya/libs", () => ({ windowId: "this-tab" }));

class TestSocket {
  static OPEN = 1;
  static instances: TestSocket[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  send = vi.fn();
  close = vi.fn();
  constructor(public url: string) {
    TestSocket.instances.push(this);
  }
}

function deliver(message: Record<string, unknown>) {
  const socket = TestSocket.instances[TestSocket.instances.length - 1];
  act(() => socket.onmessage?.({ data: JSON.stringify(message) }));
}

const keys = () =>
  client.invalidateQueries.mock.calls.map(
    ([arg]) => (arg as { queryKey?: unknown }).queryKey,
  );

describe("user WebSocket workspace messages", () => {
  beforeEach(() => {
    vi.stubGlobal("WebSocket", TestSocket);
    vi.stubEnv("VITE_API_URL", "http://localhost:1337");
    TestSocket.instances = [];
    client.invalidateQueries.mockClear();
    notify.mockClear();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("reloads my session on every device when I edit my profile", () => {
    renderHook(useUserWebSocket);
    deliver({ type: "USER_PROFILE_UPDATED", userId: "user-a" });
    expect(notify).toHaveBeenCalledWith("$sessionSignal");
    expect(keys()).toContainEqual(["workspace-users"]);
    expect(keys()).toContainEqual(["tasks"]);
  });

  it("refreshes a teammate's name without touching my session", () => {
    renderHook(useUserWebSocket);
    deliver({ type: "USER_PROFILE_UPDATED", userId: "user-b" });
    expect(notify).not.toHaveBeenCalled();
    expect(keys()).toContainEqual(["comments"]);
  });

  it("reloads the workspace switcher when a workspace changes", () => {
    renderHook(useUserWebSocket);
    deliver({ type: "WORKSPACE_UPDATED", workspaceId: "ws-1" });
    expect(notify.mock.calls).toEqual([["$listOrg"], ["$activeOrgSignal"]]);
    expect(keys()).toContainEqual(["workspace", "full"]);
  });

  it("refreshes the sidebar's projects from any screen", () => {
    renderHook(useUserWebSocket);
    deliver({ type: "PROJECTS_UPDATED", workspaceId: "ws-1" });
    expect(keys()).toEqual(
      expect.arrayContaining([
        ["projects", "ws-1"],
        ["favorites", "ws-1"],
        ["recent-visits", "ws-1"],
      ]),
    );
  });
});
