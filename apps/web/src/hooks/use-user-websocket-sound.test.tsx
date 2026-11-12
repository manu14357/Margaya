import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUserWebSocket } from "./use-user-websocket";

const { client, playForNotification, installAudioUnlock } = vi.hoisted(() => ({
  client: { invalidateQueries: vi.fn() },
  playForNotification: vi.fn(),
  installAudioUnlock: vi.fn(),
}));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => client }));
vi.mock("@/lib/auth-client", () => ({
  authClient: { useSession: () => ({ data: { user: { id: "user-a" } } }) },
}));
vi.mock("@margaya/libs", () => ({ windowId: "this-tab" }));
vi.mock("@/lib/notification-sound/notify", () => ({
  playForNotification,
  syncDesktopSoundMute: () => () => {},
}));
vi.mock("@/lib/notification-sound/player", () => ({ installAudioUnlock }));

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

describe("user WebSocket notification sounds", () => {
  beforeEach(() => {
    vi.stubGlobal("WebSocket", TestSocket);
    vi.stubEnv("VITE_API_URL", "http://localhost:1337");
    TestSocket.instances = [];
    client.invalidateQueries.mockClear();
    playForNotification.mockClear();
    installAudioUnlock.mockClear();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("listens for the gesture that starts audio", () => {
    renderHook(useUserWebSocket);
    expect(installAudioUnlock).toHaveBeenCalled();
  });

  it("plays for a new notification with its type and flags", () => {
    renderHook(useUserWebSocket);
    const message = {
      type: "NOTIFICATION_CREATED",
      notificationType: "task_comment",
      reply: true,
      needsInput: false,
    };
    deliver(message);
    expect(playForNotification).toHaveBeenCalledWith(message);
    expect(client.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["notifications"],
    });
  });

  it("refetches preferences changed on another tab or device, not its own echo", () => {
    renderHook(useUserWebSocket);
    deliver({ type: "PREFERENCES_UPDATED", originWindowId: "this-tab" });
    expect(client.invalidateQueries).not.toHaveBeenCalled();
    deliver({ type: "PREFERENCES_UPDATED", originWindowId: null });
    expect(client.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["user", "preferences"],
    });
  });

  it("stays silent when inbox state merely changes", () => {
    renderHook(useUserWebSocket);
    deliver({ type: "NOTIFICATIONS_UPDATED", workspaceId: "ws-1" });
    expect(playForNotification).not.toHaveBeenCalled();
  });
});
