import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { callSlack, recordConnectionStatus, loadActiveConnection, handle } =
  vi.hoisted(() => ({
    callSlack: vi.fn(),
    recordConnectionStatus: vi.fn(async () => {}),
    loadActiveConnection: vi.fn(),
    handle: vi.fn(),
  }));

vi.mock("../../../apps/api/src/database", () => ({ default: {} }));
vi.mock("../../../apps/api/src/slack-app/web-api", () => ({
  callSlack,
  SlackApiError: class SlackApiError extends Error {
    constructor(
      readonly method: string,
      readonly code: string,
    ) {
      super(code);
    }
  },
}));
vi.mock("../../../apps/api/src/slack-app/store", () => ({
  recordConnectionStatus,
  loadActiveConnection,
  listActiveSocketConnections: vi.fn(async () => []),
  loadConnectionRow: vi.fn(),
}));
vi.mock("../../../apps/api/src/slack-app/inbound", () => ({
  handleInbound: handle,
}));

const { SlackSocketClient } = await import(
  "../../../apps/api/src/slack-app/socket"
);
const { handleSlackEventsRoute } = await import(
  "../../../apps/api/src/slack-app/http"
);
const { computeSlackSignature } = await import(
  "../../../apps/api/src/slack-app/signature"
);

const connection = {
  id: "c-1",
  workspaceId: "ws-1",
  mode: "socket" as const,
  botToken: "xoxb-1",
  appToken: "xapp-1",
  signingSecret: null,
  teamId: "T1",
  botUserId: "UBOT",
  defaultProjectId: null,
  expandTaskKeys: false,
  isActive: true,
  updatedAt: new Date(),
};

beforeEach(() => {
  callSlack.mockReset();
  recordConnectionStatus.mockClear();
  loadActiveConnection.mockReset();
  handle.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

class FakeSocket {
  sent: string[] = [];
  closed = false;
  listeners = new Map<string, Array<(event: unknown) => void>>();
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.closed = true;
    for (const listener of this.listeners.get("close") ?? []) listener({});
  }
  addEventListener(type: string, listener: (event: unknown) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  emit(data: unknown) {
    for (const listener of this.listeners.get("message") ?? []) {
      listener({ data: JSON.stringify(data) });
    }
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("Socket Mode client", () => {
  it("opens with the app token and acks each envelope with the reply", async () => {
    callSlack.mockResolvedValue({ ok: true, url: "wss://slack.test/link" });
    const sockets: FakeSocket[] = [];
    handle.mockResolvedValue({ body: { text: "hi" } });
    const client = new SlackSocketClient(
      connection,
      (url) => {
        expect(url).toBe("wss://slack.test/link");
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
      handle,
    );
    client.start();
    await flush();
    expect(callSlack).toHaveBeenCalledWith("xapp-1", "apps.connections.open");
    const socket = sockets[0] as FakeSocket;

    socket.emit({ type: "hello" });
    await flush();
    expect(client.connected).toBe(true);
    expect(recordConnectionStatus).toHaveBeenCalledWith("c-1", {
      connected: true,
    });

    socket.emit({
      envelope_id: "env-1",
      type: "slash_commands",
      payload: { text: "help" },
    });
    await flush();
    expect(handle).toHaveBeenCalledWith(connection, {
      kind: "command",
      payload: { text: "help" },
    });
    expect(JSON.parse(socket.sent[0] as string)).toEqual({
      envelope_id: "env-1",
      payload: { text: "hi" },
    });
    client.stop();
  });

  it("reconnects after Slack asks it to", async () => {
    vi.useFakeTimers();
    callSlack.mockResolvedValue({ ok: true, url: "wss://slack.test/link" });
    const sockets: FakeSocket[] = [];
    const client = new SlackSocketClient(
      connection,
      () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
      handle,
    );
    client.start();
    await vi.advanceTimersByTimeAsync(0);
    (sockets[0] as FakeSocket).emit({ type: "disconnect", reason: "refresh" });
    await vi.advanceTimersByTimeAsync(1100);
    expect(sockets).toHaveLength(2);
    client.stop();
  });

  it("records Slack's error code when the app token is refused", async () => {
    const { SlackApiError } = await import(
      "../../../apps/api/src/slack-app/web-api"
    );
    callSlack.mockRejectedValue(
      new SlackApiError("apps.connections.open", "invalid_auth"),
    );
    const client = new SlackSocketClient(connection, () => new FakeSocket());
    client.start();
    await flush();
    expect(recordConnectionStatus).toHaveBeenCalledWith("c-1", {
      connected: false,
      error: "invalid_auth",
    });
    client.stop();
  });
});

describe("HTTP mode endpoint", () => {
  const secret = "8f742231b10e8888abcd99yyyzzz85a5";
  const app = new Hono();
  app.post("/api/slack/events/:workspaceId", handleSlackEventsRoute);

  function signed(body: string, timestamp = Math.floor(Date.now() / 1000)) {
    return {
      "x-slack-request-timestamp": String(timestamp),
      "x-slack-signature": computeSlackSignature(
        secret,
        String(timestamp),
        body,
      ),
    };
  }

  const httpConnection = {
    ...connection,
    mode: "http" as const,
    appToken: null,
    signingSecret: secret,
  };

  it("answers Slack's URL check when signed", async () => {
    loadActiveConnection.mockResolvedValue(httpConnection);
    const body = JSON.stringify({ type: "url_verification", challenge: "c1" });
    const response = await app.request("/api/slack/events/ws-1", {
      method: "POST",
      headers: { "content-type": "application/json", ...signed(body) },
      body,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ challenge: "c1" });
  });

  it("refuses an unsigned, stale or socket-mode request the same way", async () => {
    const body = "command=%2Fmargaya&text=help&team_id=T1&user_id=U1";
    const form = { "content-type": "application/x-www-form-urlencoded" };

    loadActiveConnection.mockResolvedValue(httpConnection);
    const unsigned = await app.request("/api/slack/events/ws-1", {
      method: "POST",
      headers: form,
      body,
    });
    const stale = await app.request("/api/slack/events/ws-1", {
      method: "POST",
      headers: {
        ...form,
        ...signed(body, Math.floor(Date.now() / 1000) - 600),
      },
      body,
    });
    loadActiveConnection.mockResolvedValue(connection);
    const socketMode = await app.request("/api/slack/events/ws-1", {
      method: "POST",
      headers: { ...form, ...signed(body) },
      body,
    });
    loadActiveConnection.mockResolvedValue(null);
    const unknown = await app.request("/api/slack/events/ws-1", {
      method: "POST",
      headers: { ...form, ...signed(body) },
      body,
    });
    for (const response of [unsigned, stale, socketMode, unknown]) {
      expect(response.status).toBe(401);
    }
    expect(handle).not.toHaveBeenCalled();
  });

  it("hands a signed slash command to the shared handler", async () => {
    loadActiveConnection.mockResolvedValue(httpConnection);
    handle.mockResolvedValue({ body: { text: "help text" } });
    const body = "command=%2Fmargaya&text=help&team_id=T1&user_id=U1";
    const response = await app.request("/api/slack/events/ws-1", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        ...signed(body),
      },
      body,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ text: "help text" });
    expect(handle).toHaveBeenCalledWith(httpConnection, {
      kind: "command",
      payload: expect.objectContaining({ text: "help", team_id: "T1" }),
    });
  });
});
