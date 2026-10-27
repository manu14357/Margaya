import { afterEach, describe, expect, it, vi } from "vitest";
import mcpRoutes, { mcpWellKnownRoutes } from "../../apps/api/src/mcp";
import { isMargayaResource } from "../../apps/api/src/mcp/metadata";
import { createModernMcpHandler } from "../../apps/api/src/mcp/modern";
import {
  mcpToolOutputSchema,
  structuredOf,
} from "../../apps/api/src/mcp/output";

// MCP 2026-07-28 conformance of the HTTP server: version negotiation on both
// the stateless and the handshake path, structured tool output with output
// schemas, and the OAuth discovery documents.

vi.mock("../../apps/api/src/auth", () => ({
  auth: { api: { getSession: vi.fn(async () => ({ user: { id: "u1" } })) } },
}));

vi.mock("../../apps/api/src/utils/verify-api-key", () => ({
  verifyApiKey: vi.fn(async () => null),
}));

const MODERN = "2026-07-28";

function modernRequest(
  method: string,
  id: number,
  params: Record<string, unknown> = {},
  version = MODERN,
): Request {
  const name = method === "tools/call" ? String(params.name) : undefined;
  return new Request("http://mcp.test/mcp", {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      authorization: "Bearer test-token",
      "content-type": "application/json",
      "mcp-method": method,
      "mcp-protocol-version": version,
      ...(name ? { "mcp-name": name } : {}),
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id,
      method,
      params: {
        ...params,
        _meta: {
          "io.modelcontextprotocol/protocolVersion": version,
          "io.modelcontextprotocol/clientInfo": { name: "t", version: "1" },
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    }),
  });
}

type Rpc = {
  result?: Record<string, unknown>;
  error?: { code: number; message: string; data?: Record<string, unknown> };
};

async function rpc(response: Response): Promise<Rpc> {
  const text = await response.text();
  const data = text
    .split("\n")
    .find((line) => line.startsWith("data: "))
    ?.slice(6);
  return JSON.parse(data ?? text) as Rpc;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("MCP protocol version negotiation", () => {
  it("answers server/discover with the supported versions, modern first era included", async () => {
    const handler = createModernMcpHandler("test-token", "http://api.test");
    const body = await rpc(
      await handler.fetch(modernRequest("server/discover", 1)),
    );
    expect(body.error).toBeUndefined();
    const versions = body.result?.supportedVersions as string[];
    expect(versions).toContain(MODERN);
    // Identity travels in the result (2026-07-28 servers identify themselves).
    expect(JSON.stringify(body.result)).toContain("margaya-mcp");
    expect(body.result?.capabilities).toHaveProperty("tools");
  });

  it("refuses an unsupported version with the versions it does support", async () => {
    const response = await mcpRoutes.request(
      modernRequest("tools/list", 2, {}, "2099-01-01"),
    );
    const body = await rpc(response);
    expect(body.error?.code).toBe(-32022);
    expect(JSON.stringify(body.error?.data)).toContain(MODERN);
  });

  it("keeps the initialize handshake for 2025-era clients", async () => {
    const response = await mcpRoutes.request(
      new Request("http://mcp.test/mcp", {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          authorization: "Bearer test-token",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "initialize",
          params: {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: "old", version: "1" },
          },
        }),
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("mcp-session-id")).toBeTruthy();
    const body = await rpc(response);
    expect(body.result?.protocolVersion).toBe("2025-06-18");
  });
});

describe("MCP structured tool output", () => {
  it("wraps arrays as { items } and passes objects through", () => {
    expect(structuredOf([1, 2])).toEqual({ items: [1, 2] });
    expect(structuredOf({ id: "t1" })).toEqual({ id: "t1" });
    expect(structuredOf("text")).toBeUndefined();
    expect(structuredOf(null)).toBeUndefined();
  });

  it("declares loose output schemas only for stable shapes", () => {
    const schema = mcpToolOutputSchema("get_task");
    expect(
      schema?.safeParse({
        id: "t1",
        projectId: "p1",
        title: "T",
        status: "todo",
        priority: "low",
        extra: true,
      }).success,
    ).toBe(true);
    expect(mcpToolOutputSchema("search")).toBeUndefined();
  });

  it("lists output schemas and returns structuredContent beside the text", async () => {
    const task = {
      id: "t1",
      projectId: "p1",
      title: "Fix login",
      status: "todo",
      priority: "high",
      number: 4,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(task)),
    );
    const handler = createModernMcpHandler("test-token", "http://api.test");

    const list = await rpc(await handler.fetch(modernRequest("tools/list", 1)));
    const tools = list.result?.tools as Array<Record<string, unknown>>;
    const getTask = tools.find((tool) => tool.name === "get_task");
    expect(getTask?.outputSchema).toMatchObject({
      type: "object",
      required: expect.arrayContaining(["id", "title"]),
    });
    expect(getTask?.annotations).toMatchObject({ readOnlyHint: true });

    const call = await rpc(
      await handler.fetch(
        modernRequest("tools/call", 2, {
          name: "get_task",
          arguments: { taskId: "t1" },
        }),
      ),
    );
    expect(call.result?.isError).toBe(false);
    expect(call.result?.structuredContent).toEqual(task);
    const content = call.result?.content as Array<{ text: string }>;
    expect(JSON.parse(content[0]?.text ?? "")).toEqual(task);
  });

  it("keeps errors as text without structured content", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 404 })),
    );
    const handler = createModernMcpHandler("test-token", "http://api.test");
    const call = await rpc(
      await handler.fetch(
        modernRequest("tools/call", 3, {
          name: "get_task",
          arguments: { taskId: "missing" },
        }),
      ),
    );
    expect(call.result?.isError).toBe(true);
    expect(call.result?.structuredContent).toBeUndefined();
  });
});

describe("OAuth discovery for agents", () => {
  it("publishes protected resource metadata for MCP and A2A", async () => {
    for (const resource of ["mcp", "a2a"]) {
      const response = await mcpRoutes.request(
        `/.well-known/oauth-protected-resource/api/${resource}`,
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body.resource).toBe(`http://localhost:1337/api/${resource}`);
      expect(body.authorization_servers).toEqual(["http://localhost:1337/api"]);
      expect(body.bearer_methods_supported).toEqual(["header"]);
    }
  });

  it("advertises the iss authorization response parameter (RFC 9207)", async () => {
    const response = await mcpWellKnownRoutes("https://pm.example").request(
      "/.well-known/oauth-authorization-server/api",
    );
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.issuer).toBe("https://pm.example/api");
    expect(body.authorization_response_iss_parameter_supported).toBe(true);
  });

  it("accepts only Margaya resources as resource indicators (RFC 8707)", () => {
    expect(isMargayaResource("https://pm.example/api/mcp")).toBe(true);
    expect(isMargayaResource("https://pm.example/api/a2a/")).toBe(true);
    expect(isMargayaResource("https://pm.example")).toBe(true);
    expect(isMargayaResource("https://pm.example/api/mcp#x")).toBe(false);
    expect(isMargayaResource("https://other.example/graph")).toBe(false);
    expect(isMargayaResource("urn:not-a-url")).toBe(false);
  });

  it("rejects an authorization request naming a foreign resource", async () => {
    const query = new URLSearchParams({
      response_type: "code",
      client_id: "c1",
      redirect_uri: "http://127.0.0.1:9999/cb",
      code_challenge: "a".repeat(43),
      code_challenge_method: "S256",
      resource: "https://other.example/graph",
    });
    const response = await mcpRoutes.request(`/mcp/authorize?${query}`);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "invalid_request" });
  });

  it("rejects a token request naming a foreign resource", async () => {
    const response = await mcpRoutes.request("/mcp/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: "c",
        client_id: "c1",
        code_verifier: "v",
        redirect_uri: "http://127.0.0.1:9999/cb",
        resource: "https://other.example/graph",
      }).toString(),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_target" });
  });
});
