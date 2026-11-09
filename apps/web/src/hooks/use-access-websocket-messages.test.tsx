import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  forgetClosedProjectSockets,
  useProjectWebSocket,
} from "./use-project-websocket";
import { useUserWebSocket } from "./use-user-websocket";

// Access and membership changes refresh my project roles (what the UI lets me
// do in each project) and each project's people (whom pickers offer).

const { client } = vi.hoisted(() => ({
  client: { invalidateQueries: vi.fn(), removeQueries: vi.fn() },
}));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => client }));
vi.mock("@/lib/auth-client", () => ({
  authClient: { useSession: () => ({ data: { user: { id: "user-a" } } }) },
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
  act(() => socket?.onmessage?.({ data: JSON.stringify(message) }));
}

const invalidated = () =>
  client.invalidateQueries.mock.calls.map(([options]) => options.queryKey);

describe("access changes over WebSockets", () => {
  beforeEach(() => {
    vi.stubGlobal("WebSocket", TestSocket);
    vi.stubEnv("VITE_API_URL", "http://localhost:1337");
    TestSocket.instances = [];
    client.invalidateQueries.mockClear();
    forgetClosedProjectSockets();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("refreshes my project roles and the pickers' people when my access changes", () => {
    renderHook(useUserWebSocket);
    deliver({
      type: "PROJECT_ACCESS_CHANGED",
      workspaceId: "ws-1",
      projectId: "project-1",
    });
    expect(invalidated()).toEqual(
      expect.arrayContaining([["project-rights"], ["project-audience"]]),
    );
  });

  it("refreshes them when members join, leave or change role", () => {
    renderHook(useUserWebSocket);
    deliver({ type: "WORKSPACE_MEMBERS_UPDATED", workspaceId: "ws-1" });
    expect(invalidated()).toEqual(
      expect.arrayContaining([
        ["workspace-capabilities"],
        ["project-rights"],
        ["project-audience"],
      ]),
    );
  });

  it("refreshes a project's people and my roles from its own socket", () => {
    renderHook(() => useProjectWebSocket("project-1"));
    deliver({ type: "PROJECT_ACCESS_CHANGED", projectId: "project-1" });
    expect(invalidated()).toEqual(
      expect.arrayContaining([
        ["project-access", "project-1"],
        ["project-audience", "project-1"],
        ["project-rights"],
      ]),
    );
  });
});
