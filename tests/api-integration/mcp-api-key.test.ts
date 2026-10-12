import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import db, { schema } from "../../apps/api/src/database";
import { createApp } from "../../apps/api/src/index";
import { resetTestDatabase } from "./helpers/database";
import { createWorkspaceMember } from "./helpers/fixtures";

async function insertApiKey(
  userId: string,
  key: string,
  overrides: Partial<typeof schema.apikeyTable.$inferInsert> = {},
) {
  await db.insert(schema.apikeyTable).values({
    referenceId: userId,
    userId,
    key: createHash("sha256").update(key).digest("base64url"),
    name: "mcp key",
    createdAt: new Date(),
    updatedAt: new Date(),
    enabled: true,
    ...overrides,
  });
}

function initialize(
  app: ReturnType<typeof createApp>["app"],
  headers: Record<string, string>,
) {
  return app.request("/api/mcp", {
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
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "api-key-integration", version: "1" },
      },
    }),
  });
}

describe("API integration: API keys on /api/mcp", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("opens an MCP session with an API key, as Bearer or x-api-key", async () => {
    const { user } = await createWorkspaceMember();
    await insertApiKey(user.id, "mcp-integration-key");
    const { app } = createApp();

    for (const headers of [
      { authorization: "Bearer mcp-integration-key" },
      { "x-api-key": "mcp-integration-key" },
    ]) {
      const response = await initialize(app, headers);
      expect(response.status, JSON.stringify(headers)).toBe(200);
      expect(response.headers.get("mcp-session-id")).toBeTruthy();
    }
  });

  it("refuses disabled, expired and unknown keys", async () => {
    const { user } = await createWorkspaceMember();
    await insertApiKey(user.id, "disabled-key", { enabled: false });
    await insertApiKey(user.id, "expired-key", {
      expiresAt: new Date(Date.now() - 60_000),
    });
    const { app } = createApp();

    for (const key of ["disabled-key", "expired-key", "unknown-key"]) {
      const response = await initialize(app, {
        authorization: `Bearer ${key}`,
      });
      expect(response.status, key).toBe(401);
    }
  });
});
