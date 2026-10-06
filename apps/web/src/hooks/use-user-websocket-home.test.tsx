import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUserWebSocket } from "./use-user-websocket";

const { client } = vi.hoisted(() => ({
  client: { invalidateQueries: vi.fn() },
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
  act(() => socket.onmessage?.({ data: JSON.stringify(message) }));
}

describe("user WebSocket Home messages", () => {
  beforeEach(() => {
    vi.stubGlobal("WebSocket", TestSocket);
    vi.stubEnv("VITE_API_URL", "http://localhost:1337");
    TestSocket.instances = [];
    client.invalidateQueries.mockClear();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("refetches stickies changed in another window only", () => {
    renderHook(useUserWebSocket);

    deliver({
      type: "STICKIES_UPDATED",
      workspaceId: "ws-1",
      originWindowId: "this-tab",
    });
    expect(client.invalidateQueries).not.toHaveBeenCalled();

    deliver({
      type: "STICKIES_UPDATED",
      workspaceId: "ws-1",
      originWindowId: "other-tab",
    });
    expect(client.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["stickies", "ws-1"],
    });
  });

  it("refetches quick links and Home preferences the same way", () => {
    renderHook(useUserWebSocket);

    deliver({
      type: "QUICK_LINKS_UPDATED",
      workspaceId: "ws-1",
      originWindowId: null,
    });
    deliver({
      type: "HOME_PREFERENCES_UPDATED",
      workspaceId: "ws-1",
      originWindowId: "other-tab",
    });
    deliver({
      type: "HOME_PREFERENCES_UPDATED",
      workspaceId: "ws-1",
      originWindowId: "this-tab",
    });

    expect(client.invalidateQueries.mock.calls).toEqual([
      [{ queryKey: ["quick-links", "ws-1"] }],
      [{ queryKey: ["home-preferences", "ws-1"] }],
    ]);
  });
});
