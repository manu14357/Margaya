import { afterEach, describe, expect, it, vi } from "vitest";
import mcpRoutes from "../../apps/api/src/mcp";
import {
  cacheTtlMs,
  clearClientMetadataCache,
  isClientMetadataUrl,
  parseClientMetadata,
  resolveClientMetadata,
} from "../../apps/api/src/mcp/client-metadata";
import { authorizationServerMetadata } from "../../apps/api/src/mcp/metadata";
import {
  clientCanConfirm,
  createModernMcpHandler,
  needsConfirmation,
} from "../../apps/api/src/mcp/modern";
import {
  type AgentRunJson,
  decodeTaskId,
  encodeTaskId,
  runToTask,
  TASKS_EXTENSION,
} from "../../apps/api/src/mcp/tasks";

const authMocks = vi.hoisted(() => ({
  getSession: vi.fn(async () => ({ user: { id: "test-user" } })),
}));

vi.mock("../../apps/api/src/auth", () => ({
  auth: { api: { getSession: authMocks.getSession } },
}));

vi.mock("../../apps/api/src/utils/verify-api-key", () => ({
  verifyApiKey: vi.fn(async () => null),
}));

const protocolVersion = "2026-07-28";

function modernRequest(
  method: string,
  id: number,
  params: Record<string, unknown> = {},
  capabilities: Record<string, unknown> = {},
): Request {
  const name =
    method === "tools/call"
      ? String(params.name)
      : typeof params.taskId === "string"
        ? params.taskId
        : undefined;
  return new Request("http://mcp.test/mcp", {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      authorization: "Bearer test-token",
      "content-type": "application/json",
      "mcp-method": method,
      "mcp-protocol-version": protocolVersion,
      ...(name ? { "mcp-name": name } : {}),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params: {
        ...params,
        _meta: {
          "io.modelcontextprotocol/protocolVersion": protocolVersion,
          "io.modelcontextprotocol/clientInfo": { name: "t", version: "1" },
          "io.modelcontextprotocol/clientCapabilities": capabilities,
        },
      },
    }),
  });
}

async function rpc(response: Response) {
  const text = await response.text();
  const data = text
    .split("\n")
    .find((line) => line.startsWith("data: "))
    ?.slice(6);
  return JSON.parse(data ?? text) as {
    result?: Record<string, unknown> & {
      content?: Array<{ text: string }>;
      capabilities?: Record<string, unknown>;
    };
    error?: { code: number; message: string };
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  clearClientMetadataCache();
});

describe("Client ID Metadata Documents", () => {
  const url = "https://client.example/oauth/metadata.json";
  const doc = {
    client_id: url,
    client_name: "Example client",
    redirect_uris: ["http://127.0.0.1:3000/callback"],
    token_endpoint_auth_method: "none",
  };

  it("recognises only https URLs with a path, in normal form", () => {
    expect(isClientMetadataUrl(url)).toBe(true);
    expect(isClientMetadataUrl("https://client.example/")).toBe(false);
    expect(isClientMetadataUrl("http://client.example/m.json")).toBe(false);
    expect(isClientMetadataUrl("https://u:p@client.example/m.json")).toBe(
      false,
    );
    expect(isClientMetadataUrl("https://client.example/m.json#x")).toBe(false);
    expect(isClientMetadataUrl("https://client.example/a/../m.json")).toBe(
      false,
    );
    expect(isClientMetadataUrl("3f1c0b9e-uuid")).toBe(false);
  });

  it("accepts a document that names itself and lists its redirects", () => {
    expect(parseClientMetadata(url, JSON.stringify(doc))).toEqual({
      clientId: url,
      clientName: "Example client",
      redirectUris: ["http://127.0.0.1:3000/callback"],
      metadataHost: "client.example",
    });
  });

  it("rejects a mismatched client_id, secrets, bad redirects and bad JSON", () => {
    const parse = (value: unknown) =>
      parseClientMetadata(url, JSON.stringify(value));
    expect(() => parse({ ...doc, client_id: `${url}?x` })).toThrow();
    expect(() => parse({ ...doc, client_secret: "s" })).toThrow();
    expect(() =>
      parse({ ...doc, redirect_uris: ["javascript:alert(1)"] }),
    ).toThrow();
    expect(() => parse({ ...doc, redirect_uris: [] })).toThrow();
    expect(() => parse({ ...doc, client_name: undefined })).toThrow();
    expect(() =>
      parse({ ...doc, token_endpoint_auth_method: "private_key_jwt" }),
    ).toThrow();
    expect(() => parseClientMetadata(url, "{not json")).toThrow();
  });

  it("caches by Cache-Control within bounds", () => {
    expect(cacheTtlMs(null)).toBe(5 * 60 * 1000);
    expect(cacheTtlMs("max-age=5")).toBe(60 * 1000);
    expect(cacheTtlMs("public, max-age=600")).toBe(600 * 1000);
    expect(cacheTtlMs("max-age=999999")).toBe(24 * 60 * 60 * 1000);
    expect(cacheTtlMs("no-store")).toBe(60 * 1000);
  });

  it("fetches without redirects, once, and refuses private destinations", async () => {
    vi.stubEnv("MARGAYA_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS", "true");
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(init?.redirect).toBe("error");
        return new Response(JSON.stringify(doc), {
          headers: { "content-type": "application/json" },
        });
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(resolveClientMetadata(url)).resolves.toMatchObject({
      clientId: url,
      metadataHost: "client.example",
    });
    await resolveClientMetadata(url);
    expect(fetchMock).toHaveBeenCalledOnce();

    vi.unstubAllEnvs();
    clearClientMetadataCache();
    await expect(
      resolveClientMetadata("https://127.0.0.1/metadata.json"),
    ).rejects.toThrow("destination not allowed");
  });

  it("refuses oversized and non-JSON documents", async () => {
    vi.stubEnv("MARGAYA_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS", "true");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("x".repeat(6000), {
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    await expect(resolveClientMetadata(url)).rejects.toThrow("too large");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("<html>", { headers: { "content-type": "text/html" } }),
      ),
    );
    await expect(resolveClientMetadata(url)).rejects.toThrow("not JSON");
  });

  it("is advertised next to dynamic registration", () => {
    const metadata = authorizationServerMetadata("https://m.example");
    expect(metadata.client_id_metadata_document_supported).toBe(true);
    expect(metadata.registration_endpoint).toBe(
      "https://m.example/api/mcp/register",
    );
  });
});

const run = (overrides: Partial<AgentRunJson> = {}): AgentRunJson => ({
  id: "run1",
  status: "running",
  agent: { name: "Planner" },
  createdAt: "2026-11-13T10:00:00.000Z",
  startedAt: "2026-11-13T10:00:01.000Z",
  finishedAt: null,
  steps: [],
  ...overrides,
});

describe("MCP Tasks extension over agent runs", () => {
  it("round-trips task ids and refuses anything else", () => {
    const id = encodeTaskId("ws1", "run1");
    expect(decodeTaskId(id)).toEqual({ workspaceId: "ws1", runId: "run1" });
    expect(decodeTaskId("agent-run.ws1")).toBeNull();
    expect(decodeTaskId("agent-run.ws1.run1.x")).toBeNull();
    expect(decodeTaskId("agent-run.ws/1.run1")).toBeNull();
    expect(decodeTaskId(42)).toBeNull();
  });

  it("maps run states to task states", () => {
    expect(runToTask("ws1", run({ status: "queued" })).status).toBe("working");
    expect(runToTask("ws1", run()).status).toBe("working");
    expect(runToTask("ws1", run({ status: "cancelled" })).status).toBe(
      "cancelled",
    );
    const done = runToTask(
      "ws1",
      run({ status: "succeeded", outputSummary: "Filed 2 tasks." }),
    );
    expect(done).toMatchObject({
      status: "completed",
      result: {
        content: [{ type: "text", text: "Filed 2 tasks." }],
        isError: false,
      },
    });
    // A failed run completes with isError: failed is for JSON-RPC errors.
    expect(
      runToTask("ws1", run({ status: "failed", error: "TIME_LIMIT" })),
    ).toMatchObject({ status: "completed", result: { isError: true } });
  });

  it("asks for approvals the caller may decide, as elicitations", () => {
    const pending = (canDecide: boolean) =>
      run({
        status: "awaiting_approval",
        steps: [
          {
            id: "s1",
            kind: "tool",
            toolName: "delete_task",
            change: { taskLabel: "WEB-1 Fix login" },
            approval: { id: "ap1", status: "pending", canDecide },
          },
        ],
      });
    const mine = runToTask("ws1", pending(true));
    expect(mine.status).toBe("input_required");
    expect(
      Object.keys((mine as { inputRequests: object }).inputRequests),
    ).toEqual(["approval:ap1"]);
    expect(runToTask("ws1", pending(false)).status).toBe("working");
    const asking = runToTask(
      "ws1",
      run({
        status: "needs_input",
        question: { text: "Which environment?", options: ["staging"] },
      }),
    );
    expect(asking).toMatchObject({
      status: "input_required",
      inputRequests: { answer: { params: { message: "Which environment?" } } },
    });
  });

  it("advertises the extension in server/discover", async () => {
    const handler = createModernMcpHandler("test-token", "http://api.test");
    const body = await rpc(
      await handler.fetch(modernRequest("server/discover", 1)),
    );
    expect(body.result?.capabilities).toMatchObject({
      extensions: { [TASKS_EXTENSION]: {} },
    });
  });

  it("run_agent returns a task handle to a client with the extension", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push(`${init?.method ?? "GET"} ${String(input)}`);
        if (init?.method === "POST")
          return Response.json({ id: "run1", status: "queued" });
        return Response.json(run({ status: "queued", startedAt: null }));
      }),
    );
    const handler = createModernMcpHandler("test-token", "http://api.test");
    const args = {
      workspaceId: "ws1",
      agentId: "a1",
      taskId: "t1",
      prompt: "Plan it",
    };
    const withTasks = await rpc(
      await handler.fetch(
        modernRequest(
          "tools/call",
          1,
          { name: "run_agent", arguments: args },
          { extensions: { [TASKS_EXTENSION]: {} } },
        ),
      ),
    );
    expect(withTasks.result).toMatchObject({
      resultType: "task",
      taskId: "agent-run.ws1.run1",
      status: "working",
      ttlMs: null,
    });
    expect(calls).toEqual([
      "POST http://api.test/api/ai/agents/a1/runs",
      "GET http://api.test/api/ai/agents/runs/run1?workspaceId=ws1",
    ]);

    calls.length = 0;
    const plain = await rpc(
      await handler.fetch(
        modernRequest("tools/call", 2, { name: "run_agent", arguments: args }),
      ),
    );
    expect(plain.result?.resultType).toBe("complete");
    expect(plain.result?.content?.[0]?.text).toContain('"id": "run1"');
    expect(calls).toEqual(["POST http://api.test/api/ai/agents/a1/runs"]);
  });

  it("serves tasks/get and decides approvals through tasks/update", async () => {
    const calls: Array<{ method: string; url: string; body?: unknown }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        calls.push({
          method: init?.method ?? "GET",
          url,
          body: init?.body ? JSON.parse(String(init.body)) : undefined,
        });
        if (url.includes("/runs/run1?")) {
          return Response.json(
            run({
              status: "awaiting_approval",
              steps: [
                {
                  id: "s1",
                  kind: "tool",
                  toolName: "delete_task",
                  change: null,
                  approval: { id: "ap1", status: "pending", canDecide: true },
                },
              ],
            }),
          );
        }
        if (url.includes("/runs/gone?"))
          return new Response("nope", { status: 404 });
        return Response.json({ id: "ap1", status: "approved" });
      }),
    );
    const got = await rpc(
      await mcpRoutes.request(
        modernRequest("tasks/get", 1, { taskId: "agent-run.ws1.run1" }),
      ),
    );
    expect(got.result).toMatchObject({
      resultType: "complete",
      status: "input_required",
      inputRequests: { "approval:ap1": { method: "elicitation/create" } },
    });

    calls.length = 0;
    const updated = await rpc(
      await mcpRoutes.request(
        modernRequest("tasks/update", 2, {
          taskId: "agent-run.ws1.run1",
          inputResponses: {
            "approval:ap1": { action: "accept", content: { approve: true } },
            "approval:someone-else": {
              action: "accept",
              content: { approve: true },
            },
          },
        }),
      ),
    );
    expect(updated.result).toEqual({ resultType: "complete" });
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      "GET http://127.0.0.1:1337/api/ai/agents/runs/run1?workspaceId=ws1",
      "POST http://127.0.0.1:1337/api/ai/agents/approvals/ap1/approve",
    ]);
    expect(calls[1]?.body).toEqual({ workspaceId: "ws1" });

    const unknown = await rpc(
      await mcpRoutes.request(
        modernRequest("tasks/get", 3, { taskId: "agent-run.ws1.gone" }),
      ),
    );
    expect(unknown.error).toMatchObject({
      code: -32602,
      message: "Unknown task",
    });
    const malformed = await rpc(
      await mcpRoutes.request(modernRequest("tasks/get", 4, { taskId: "x" })),
    );
    expect(malformed.error?.code).toBe(-32602);
  });
});

describe("MRTR confirmations for delete and bulk tools", () => {
  it("chooses deletes and bulk replacements only", () => {
    expect(needsConfirmation("delete_task")).toBe(true);
    expect(needsConfirmation("remove_task_recurrence")).toBe(true);
    expect(needsConfirmation("update_module_tasks")).toBe(true);
    expect(needsConfirmation("update_task_status")).toBe(false);
    expect(needsConfirmation("get_task")).toBe(false);
  });

  it("detects form elicitation in the request's capabilities", () => {
    const extra = (caps: unknown) => ({
      mcpReq: {
        envelope: { "io.modelcontextprotocol/clientCapabilities": caps },
      },
    });
    expect(clientCanConfirm(extra({ elicitation: {} }))).toBe(true);
    expect(clientCanConfirm(extra({ elicitation: { form: {} } }))).toBe(true);
    expect(clientCanConfirm(extra({ elicitation: { url: {} } }))).toBe(false);
    expect(clientCanConfirm(extra({}))).toBe(false);
    expect(clientCanConfirm(undefined)).toBe(false);
  });

  it("asks before deleting, then deletes only on an accepted yes", async () => {
    const apiFetch = vi.fn(async () => Response.json({ id: "task-1" }));
    vi.stubGlobal("fetch", apiFetch);
    const handler = createModernMcpHandler("test-token", "http://api.test");
    const caps = { elicitation: { form: {} } };
    const call = (id: number, extra: Record<string, unknown> = {}) =>
      handler
        .fetch(
          modernRequest(
            "tools/call",
            id,
            { name: "delete_task", arguments: { taskId: "task-1" }, ...extra },
            caps,
          ),
        )
        .then(rpc);

    const first = await call(1);
    expect(first.result).toMatchObject({
      resultType: "input_required",
      inputRequests: { confirm: { method: "elicitation/create" } },
    });
    expect(apiFetch).not.toHaveBeenCalled();

    const declined = await call(2, {
      inputResponses: {
        confirm: { action: "accept", content: { confirm: false } },
      },
    });
    expect(declined.result).toMatchObject({ isError: true });
    expect(apiFetch).not.toHaveBeenCalled();

    const confirmed = await call(3, {
      inputResponses: {
        confirm: { action: "accept", content: { confirm: true } },
      },
    });
    expect(confirmed.result?.isError).toBeFalsy();
    expect(apiFetch).toHaveBeenCalledOnce();
  });

  it("does not ask a client without elicitation", async () => {
    const apiFetch = vi.fn(async () => Response.json({ id: "task-1" }));
    vi.stubGlobal("fetch", apiFetch);
    const handler = createModernMcpHandler("test-token", "http://api.test");
    const body = await rpc(
      await handler.fetch(
        modernRequest("tools/call", 1, {
          name: "delete_task",
          arguments: { taskId: "task-1" },
        }),
      ),
    );
    expect(body.result?.resultType).toBe("complete");
    expect(apiFetch).toHaveBeenCalledOnce();
  });
});
