import { createHash, randomBytes } from "node:crypto";
import type { APIRequestContext, APIResponse } from "@playwright/test";
import { expectJson } from "./api-kit";

// A minimal Streamable HTTP MCP client for /api/mcp (2025-era, sessionful)
// and the PKCE OAuth flow that issues its bearer tokens. LOCAL TESTING ONLY.

export const MCP_PROTOCOL_VERSION = "2025-03-26";

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id?: number;
  result?: Record<string, unknown>;
  error?: { code: number; message: string };
};

export type ToolResult = {
  content: { type: string; text: string }[];
  isError?: boolean;
};

/** Parse a JSON or SSE (`event: message` / `data: {...}`) MCP response body. */
export function parseMcpBody(text: string): JsonRpcResponse[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    const parsed = JSON.parse(trimmed) as JsonRpcResponse | JsonRpcResponse[];
    return Array.isArray(parsed) ? parsed : [parsed];
  }
  return trimmed
    .split(/\r?\n/)
    .filter((line) => line.startsWith("data:"))
    .map((line) => JSON.parse(line.slice(5).trim()) as JsonRpcResponse);
}

export class McpHttpClient {
  sessionId: string | undefined;
  private nextId = 1;

  constructor(
    private readonly ctx: APIRequestContext,
    private readonly authorization: Record<string, string>,
  ) {}

  post(body: unknown): Promise<APIResponse> {
    return this.ctx.post("/api/mcp", {
      headers: {
        ...this.authorization,
        Accept: "application/json, text/event-stream",
        "Content-Type": "application/json",
        ...(this.sessionId ? { "mcp-session-id": this.sessionId } : {}),
      },
      data: body,
    });
  }

  async request(method: string, params: Record<string, unknown> = {}) {
    const id = this.nextId++;
    const response = await this.post({ jsonrpc: "2.0", id, method, params });
    const text = await response.text();
    if (!response.ok()) {
      throw new Error(
        `MCP ${method} answered ${response.status()}: ${text.slice(0, 300)}`,
      );
    }
    const sessionId = response.headers()["mcp-session-id"];
    if (sessionId) this.sessionId = sessionId;
    const message = parseMcpBody(text).find((entry) => entry.id === id);
    if (!message)
      throw new Error(
        `MCP ${method}: no response for id ${id}: ${text.slice(0, 300)}`,
      );
    if (message.error)
      throw new Error(`MCP ${method} error: ${message.error.message}`);
    return message.result ?? {};
  }

  async notify(method: string, params: Record<string, unknown> = {}) {
    const response = await this.post({ jsonrpc: "2.0", method, params });
    if (response.status() >= 400) {
      throw new Error(
        `MCP ${method} answered ${response.status()}: ${await response.text()}`,
      );
    }
  }

  async initialize() {
    const result = await this.request("initialize", {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "margaya-e2e", version: "1.0.0" },
    });
    await this.notify("notifications/initialized");
    return result as {
      protocolVersion: string;
      serverInfo: { name: string; version: string };
      capabilities: Record<string, unknown>;
    };
  }

  async listTools() {
    const result = (await this.request("tools/list")) as {
      tools: { name: string; description?: string }[];
    };
    return result.tools;
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<ToolResult> {
    return (await this.request("tools/call", {
      name,
      arguments: args,
    })) as ToolResult;
  }

  /** Call a tool and parse its JSON text payload, failing on tool errors. */
  async callToolJson<T>(
    name: string,
    args: Record<string, unknown>,
  ): Promise<T> {
    const result = await this.callTool(name, args);
    const text = result.content.map((part) => part.text).join("");
    if (result.isError)
      throw new Error(`Tool ${name} failed: ${text.slice(0, 300)}`);
    return JSON.parse(text) as T;
  }

  async close() {
    if (!this.sessionId) return;
    await this.ctx.delete("/api/mcp", {
      headers: { ...this.authorization, "mcp-session-id": this.sessionId },
    });
  }
}

export function pkcePair() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

/**
 * Run the MCP OAuth 2.1 flow as the signed-in user of `ctx`: register a
 * public client, authorize with PKCE, approve on the consent endpoint and
 * exchange the code. Returns the bearer token.
 */
export async function mcpOAuthToken(
  anonymous: APIRequestContext,
  signedIn: APIRequestContext,
  redirectUri = "http://127.0.0.1:9/callback",
): Promise<string> {
  const client = await expectJson<{ client_id: string }>(
    await anonymous.post("/api/mcp/register", {
      data: { redirect_uris: [redirectUri], client_name: "Margaya e2e" },
    }),
  );
  const { verifier, challenge } = pkcePair();
  const authorize = await anonymous.get("/api/mcp/authorize", {
    params: {
      response_type: "code",
      client_id: client.client_id,
      redirect_uri: redirectUri,
      code_challenge: challenge,
      code_challenge_method: "S256",
      state: "e2e-state",
    },
    maxRedirects: 0,
  });
  const consentUrl = new URL(authorize.headers().location ?? "");
  const requestId = consentUrl.searchParams.get("request_id") ?? "";
  const decision = await expectJson<{ redirect: string }>(
    await signedIn.post(`/api/mcp/authorize/request/${requestId}`, {
      data: { approved: true },
    }),
  );
  const code = new URL(decision.redirect).searchParams.get("code") ?? "";
  const token = await expectJson<{ access_token: string }>(
    await anonymous.post("/api/mcp/token", {
      form: {
        grant_type: "authorization_code",
        code,
        client_id: client.client_id,
        code_verifier: verifier,
        redirect_uri: redirectUri,
      },
    }),
  );
  return token.access_token;
}
