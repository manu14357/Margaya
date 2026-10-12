import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../apps/api/src/index";
import { resetTestDatabase } from "./helpers/database";

type App = ReturnType<typeof createApp>["app"];
const protocolVersion = "2026-07-28";

async function ownerWithApiKey(app: App) {
  const signUp = await app.request("/api/auth/sign-up/email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: "key-owner@example.com",
      password: "correct horse battery staple",
      name: "Key Owner",
    }),
  });
  expect(signUp.status).toBe(200);
  const { user } = (await signUp.json()) as { user: { id: string } };
  const cookie = signUp.headers
    .getSetCookie()
    .map((setCookie) => setCookie.split(";")[0])
    .join("; ");

  const created = await app.request("/api/auth/api-key/create", {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ name: "mcp" }),
  });
  expect(created.status, await created.clone().text()).toBe(200);
  const { key } = (await created.json()) as { key: string };
  return { userId: user.id, key };
}

function whoami(app: App, headers: Record<string, string>) {
  return app.request("/api/mcp", {
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
          "io.modelcontextprotocol/clientInfo": { name: "it", version: "1" },
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    }),
  });
}

async function toolText(response: Response) {
  const text = await response.text();
  const data = text
    .split("\n")
    .find((line) => line.startsWith("data: "))
    ?.slice(6);
  const body = JSON.parse(data ?? text) as {
    result: { content: Array<{ text: string }> };
  };
  return body.result.content.map((part) => part.text).join("\n");
}

describe("API integration: who an API key is", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("get-session names the key's owner for a Bearer API key", async () => {
    const { app } = createApp();
    const { userId, key } = await ownerWithApiKey(app);

    for (const headers of [
      { authorization: `Bearer ${key}` },
      { "x-api-key": key },
    ]) {
      const response = await app.request("/api/auth/get-session", {
        headers,
      });
      expect(response.status).toBe(200);
      const session = (await response.json()) as { user: { id: string } };
      expect(session?.user.id, JSON.stringify(headers)).toBe(userId);
    }
  });

  it("the MCP whoami tool names the key's owner", async () => {
    const { app } = createApp();
    const { userId, key } = await ownerWithApiKey(app);
    // The tools call the API over HTTP; route those calls into this app.
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
      app.request(new Request(input, init)),
    );

    for (const headers of [
      { authorization: `Bearer ${key}` },
      { "x-api-key": key },
    ]) {
      const response = await whoami(app, headers);
      expect(response.status).toBe(200);
      expect(await toolText(response), JSON.stringify(headers)).toContain(
        userId,
      );
    }
  });
});
