import { afterEach, describe, expect, it, vi } from "vitest";
import mcpRoutes from "../../apps/api/src/mcp";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(async ({ headers }: { headers: Headers }) =>
    new Headers(headers).get("authorization") === "Bearer session-token"
      ? { user: { id: "session-user" } }
      : null,
  ),
  verifyApiKey: vi.fn(async (key: string) =>
    key === "key-full" || key === "key-read"
      ? { valid: true, key: { id: `id-${key}`, userId: "key-owner" } }
      : null,
  ),
}));

vi.mock("../../apps/api/src/auth", () => ({
  auth: { api: { getSession: mocks.getSession } },
}));

vi.mock("../../apps/api/src/utils/verify-api-key", () => ({
  verifyApiKey: mocks.verifyApiKey,
}));

const protocolVersion = "2026-07-28";

function initialize(headers: Record<string, string>) {
  return mcpRoutes.request("/mcp", {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "api-key-test", version: "1.0.0" },
      },
    }),
  });
}

function whoamiCall(headers: Record<string, string>) {
  return mcpRoutes.request("/mcp", {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      "content-type": "application/json",
      "mcp-method": "tools/call",
      "mcp-name": "whoami",
      "mcp-protocol-version": protocolVersion,
      ...headers,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "whoami",
        arguments: {},
        _meta: {
          "io.modelcontextprotocol/protocolVersion": protocolVersion,
          "io.modelcontextprotocol/clientInfo": {
            name: "api-key-test",
            version: "1.0.0",
          },
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    }),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  mocks.getSession.mockClear();
  mocks.verifyApiKey.mockClear();
});

describe("MCP HTTP endpoint with API keys", () => {
  it.each([
    ["Authorization: Bearer", { authorization: "Bearer key-full" }],
    ["x-api-key", { "x-api-key": "key-full" }],
  ])("accepts an API key sent as %s", async (_label, headers) => {
    const response = await initialize(headers);

    expect(response.status).toBe(200);
    expect(response.headers.get("mcp-session-id")).toBeTruthy();
    expect(mocks.verifyApiKey).toHaveBeenCalledWith("key-full");
    expect(mocks.getSession).not.toHaveBeenCalled();
  });

  it("still accepts a bearer session token", async () => {
    const response = await initialize({
      authorization: "Bearer session-token",
    });

    expect(response.status).toBe(200);
    expect(mocks.getSession).toHaveBeenCalledTimes(1);
  });

  it("refuses an unknown key without trying it as a session", async () => {
    const response = await initialize({ "x-api-key": "not-a-key" });

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: "invalid_token" });
    expect(mocks.getSession).not.toHaveBeenCalled();
  });

  it("refuses a malformed Bearer header even with a valid x-api-key", async () => {
    const response = await initialize({
      authorization: "Bearer",
      "x-api-key": "key-full",
    });

    expect(response.status).toBe(401);
  });

  it("keeps a session bound to the key that opened it", async () => {
    const opened = await initialize({ "x-api-key": "key-full" });
    const sessionId = opened.headers.get("mcp-session-id") ?? "";

    const borrowed = await mcpRoutes.request("/mcp", {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "x-api-key": "key-read",
        "mcp-session-id": sessionId,
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    });

    // Same owner, other key: its permissions must not be widened.
    expect(borrowed.status).toBe(404);
  });

  it("calls the API with the caller's key, so its permissions apply", async () => {
    const apiFetch = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        Response.json({ user: { id: "key-owner" } }),
    );
    vi.stubGlobal("fetch", apiFetch);

    const response = await whoamiCall({ "x-api-key": "key-read" });

    expect(response.status).toBe(200);
    expect(apiFetch).toHaveBeenCalled();
    for (const [, init] of apiFetch.mock.calls) {
      expect(new Headers(init?.headers).get("authorization")).toBe(
        "Bearer key-read",
      );
    }
  });
});
