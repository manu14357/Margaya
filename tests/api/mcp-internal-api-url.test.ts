import { afterEach, describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  getSession: vi.fn(async () => ({ user: { id: "test-user" } })),
}));

vi.mock("../../apps/api/src/auth", () => ({
  auth: { api: { getSession: authMocks.getSession } },
}));

// Test tokens are not API keys; the key lookup would otherwise hit a database.
vi.mock("../../apps/api/src/utils/verify-api-key", () => ({
  verifyApiKey: vi.fn(async () => null),
}));

// Each test re-imports the MCP routes (their URLs are read at import), so
// keep what URL handling doesn't use out of that graph: the OAuth stores and
// with them the database schema, the event bus, and dotenv-mono, which would
// load the developer's .env (it can define MARGAYA_INTERNAL_API_URL) into a
// test that relies on that variable being unset.
vi.mock("dotenv-mono", () => ({ config: () => {} }));
vi.mock("../../apps/api/src/mcp/controllers/oauth-consent", () => ({
  beginMcpAuthorization: vi.fn(),
  decideMcpAuthorizationRequest: vi.fn(),
  getMcpAuthorizationRequest: vi.fn(),
  registerMcpClient: vi.fn(),
}));
vi.mock("../../apps/api/src/mcp/oauth", () => ({ exchangeCode: vi.fn() }));

const protocolVersion = "2026-07-28";

function toolRequest() {
  return new Request("http://public.test:5273/mcp", {
    method: "POST",
    headers: {
      accept: "application/json, text/event-stream",
      authorization: "Bearer test-token",
      "content-type": "application/json",
      "mcp-method": "tools/call",
      "mcp-name": "whoami",
      "mcp-protocol-version": protocolVersion,
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
            name: "margaya-internal-url-test",
            version: "1.0.0",
          },
          "io.modelcontextprotocol/clientCapabilities": {},
        },
      },
    }),
  });
}

async function loadMcpRoutes(internalApiUrl?: string) {
  vi.stubEnv("MARGAYA_API_URL", "http://public.test:5273/api");
  vi.stubEnv("MARGAYA_INTERNAL_API_URL", internalApiUrl);
  vi.resetModules();
  return (await import("../../apps/api/src/mcp")).default;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
  authMocks.getSession.mockClear();
});

// Every test re-imports the whole MCP route graph after resetModules, which
// takes seconds on its own and outruns the default timeout under suite load.
describe("MCP API URLs", { timeout: 30_000 }, () => {
  it("advertises the public URL while fetching tools through the internal URL", async () => {
    const apiFetch = vi.fn(async () =>
      Response.json({ user: { id: "test-user" } }),
    );
    vi.stubGlobal("fetch", apiFetch);
    const mcpRoutes = await loadMcpRoutes();

    const metadataResponse = await mcpRoutes.request(
      "/.well-known/oauth-authorization-server/api",
    );
    const metadata = (await metadataResponse.json()) as {
      issuer: string;
      authorization_endpoint: string;
    };

    expect(metadata).toMatchObject({
      issuer: "http://public.test:5273/api",
      authorization_endpoint: "http://public.test:5273/api/mcp/authorize",
    });

    const toolResponse = await mcpRoutes.request(toolRequest());

    expect(toolResponse.status).toBe(200);
    expect(apiFetch).toHaveBeenCalledOnce();
    expect(String(apiFetch.mock.calls[0]?.[0])).toBe(
      "http://127.0.0.1:1337/api/auth/get-session",
    );
  });

  it.each(["http://api.internal:1337/api/", "http://api.internal:1337/"])(
    "uses the configured internal URL %s without duplicate slashes",
    async (internalApiUrl) => {
      const apiFetch = vi.fn(async () =>
        Response.json({ user: { id: "test-user" } }),
      );
      vi.stubGlobal("fetch", apiFetch);
      const mcpRoutes = await loadMcpRoutes(internalApiUrl);

      const toolResponse = await mcpRoutes.request(toolRequest());

      expect(toolResponse.status).toBe(200);
      expect(apiFetch).toHaveBeenCalledOnce();
      expect(String(apiFetch.mock.calls[0]?.[0])).toBe(
        "http://api.internal:1337/api/auth/get-session",
      );
    },
  );
});
