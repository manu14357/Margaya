import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUserWebSocket } from "./use-user-websocket";

const { client, handleExport } = vi.hoisted(() => ({
  client: { invalidateQueries: vi.fn() },
  handleExport: vi.fn(),
}));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => client }));
vi.mock("@/lib/auth-client", () => ({
  authClient: { useSession: () => ({ data: { user: { id: "user-a" } } }) },
}));
vi.mock("@margaya/libs", () => ({ windowId: "this-tab" }));
vi.mock("@/lib/task-export/realtime", () => ({
  handleTaskExportUserMessage: handleExport,
}));

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

describe("user WebSocket export messages", () => {
  beforeEach(() => {
    vi.stubGlobal("WebSocket", TestSocket);
    vi.stubEnv("VITE_API_URL", "http://localhost:1337");
    TestSocket.instances = [];
    client.invalidateQueries.mockClear();
    handleExport.mockClear();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("hands EXPORT_UPDATED to the export handler with the query client", () => {
    renderHook(useUserWebSocket);

    const message = {
      type: "EXPORT_UPDATED",
      workspaceId: "ws-1",
      exportId: "exp-1",
      status: "completed",
    };
    deliver(message);

    expect(handleExport).toHaveBeenCalledWith(client, message);
  });
});
