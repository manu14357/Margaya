import { assertPublicDestination } from "../utils/assert-public-destination";
import { withoutOutboundTelemetry } from "../utils/sensitive-outbound";

// A minimal MCP client over Streamable HTTP (JSON-RPC 2.0 POSTed to one
// URL; the answer comes back as JSON or as a server-sent event stream):
// initialize → notifications/initialized → tools/list → tools/call. It
// only ever talks to public addresses (the webhook SSRF guard, checked on
// every connection), never follows redirects, caps every response and
// gives up after a timeout. Connector URLs and headers may carry
// credentials, so nothing here is logged or traced.

export const MCP_PROTOCOL_VERSION = "2025-06-18";
export const MAX_RESPONSE_BYTES = 512 * 1024;
const CONNECT_TIMEOUT_MS = 10_000;
const CALL_TIMEOUT_MS = 30_000;
const MAX_LIST_PAGES = 3;
export const MAX_TOOLS_PER_CONNECTOR = 30;

export type McpErrorCode =
  | "DESTINATION"
  | "TIMEOUT"
  | "NETWORK"
  | "HTTP"
  | "TOO_LARGE"
  | "PROTOCOL"
  | "RPC";

/** A failure with a stable code; the message never holds remote text. */
export class McpError extends Error {
  constructor(
    readonly code: McpErrorCode,
    readonly status?: number,
  ) {
    super(`MCP ${code}${status ? ` (HTTP ${status})` : ""}`);
    this.name = "McpError";
  }
}

export type McpTool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** The server says the tool only reads (annotations.readOnlyHint). */
  readOnly: boolean;
};

export type McpEndpoint = {
  url: string;
  /** Extra request headers (the connector's auth header). */
  headers?: Record<string, string>;
};

type RpcMessage = {
  jsonrpc?: string;
  id?: number | string | null;
  result?: unknown;
  error?: { code?: number; message?: string };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** The JSON-RPC answer to `id` among parsed messages, or null. */
function answerOf(messages: unknown[], id: number): RpcMessage | null {
  for (const message of messages) {
    if (
      isRecord(message) &&
      message.id === id &&
      ("result" in message || "error" in message)
    ) {
      return message as RpcMessage;
    }
  }
  return null;
}

/** Complete events of an SSE text and the unfinished rest. */
export function splitSseEvents(text: string): {
  events: string[];
  rest: string;
} {
  const normalized = text.replace(/\r\n?/g, "\n");
  const parts = normalized.split("\n\n");
  const rest = parts.pop() ?? "";
  const events = parts.flatMap((block) => {
    const data = block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""));
    return data.length > 0 ? [data.join("\n")] : [];
  });
  return { events, rest };
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * The answer to request `id` from a whole response body: a JSON object, a
 * JSON batch, or an event stream. Throws PROTOCOL when it isn't there.
 */
export function parseRpcResponse(
  body: string,
  contentType: string,
  id: number,
): RpcMessage {
  let messages: unknown[] = [];
  if (contentType.includes("text/event-stream")) {
    const { events, rest } = splitSseEvents(`${body}\n\n`);
    messages = [...events, rest].flatMap(parseJson);
  } else {
    const parsed = parseJson(body);
    messages = Array.isArray(parsed) ? parsed : [parsed];
  }
  const answer = answerOf(messages, id);
  if (!answer) throw new McpError("PROTOCOL");
  return answer;
}

/** The tools of a tools/list result, cleaned and capped. */
export function toolsFromList(result: unknown): {
  tools: McpTool[];
  nextCursor: string | null;
} {
  if (!isRecord(result) || !Array.isArray(result.tools)) {
    throw new McpError("PROTOCOL");
  }
  const tools: McpTool[] = [];
  for (const raw of result.tools) {
    if (!isRecord(raw) || typeof raw.name !== "string") continue;
    const name = raw.name.trim();
    if (!name || name.length > 128) continue;
    const schema = isRecord(raw.inputSchema) ? raw.inputSchema : {};
    const annotations = isRecord(raw.annotations) ? raw.annotations : {};
    tools.push({
      name,
      description:
        typeof raw.description === "string"
          ? raw.description.slice(0, 1_000)
          : "",
      inputSchema: { ...schema, type: "object" },
      readOnly: annotations.readOnlyHint === true,
    });
  }
  return {
    tools,
    nextCursor:
      typeof result.nextCursor === "string" && result.nextCursor
        ? result.nextCursor
        : null,
  };
}

/** A tools/call result as text: text parts joined, others named. */
export function toolResultText(result: unknown): {
  text: string;
  isError: boolean;
} {
  if (!isRecord(result)) throw new McpError("PROTOCOL");
  const parts: string[] = [];
  if (Array.isArray(result.content)) {
    for (const item of result.content) {
      if (!isRecord(item)) continue;
      if (item.type === "text" && typeof item.text === "string") {
        parts.push(item.text);
      } else if (item.type === "resource" && isRecord(item.resource)) {
        const text = item.resource.text;
        if (typeof text === "string") parts.push(text);
      } else if (typeof item.type === "string") {
        parts.push(`[${item.type}]`);
      }
    }
  }
  if (parts.length === 0 && result.structuredContent !== undefined) {
    parts.push(JSON.stringify(result.structuredContent));
  }
  return { text: parts.join("\n\n"), isError: result.isError === true };
}

async function readCapped(
  response: Response,
  done: (text: string) => boolean,
): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  try {
    while (true) {
      const { done: end, value } = await reader.read();
      if (end) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new McpError("TOO_LARGE");
      text += decoder.decode(value, { stream: true });
      // An event stream may stay open after the answer: stop at it.
      if (done(text)) break;
    }
    return text + decoder.decode();
  } finally {
    void reader.cancel().catch(() => {});
  }
}

/** One MCP session with a server; open with `connect`. */
export class McpConnection {
  private nextId = 1;
  private sessionId: string | null = null;
  private protocolVersion = MCP_PROTOCOL_VERSION;

  private constructor(private readonly endpoint: McpEndpoint) {}

  /** Checks the destination, then initializes a session. */
  static async connect(endpoint: McpEndpoint): Promise<McpConnection> {
    try {
      await assertPublicDestination(endpoint.url, "Connector");
    } catch {
      throw new McpError("DESTINATION");
    }
    const connection = new McpConnection(endpoint);
    const result = await connection.request(
      "initialize",
      {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "Margaya", version: "1.0.0" },
      },
      CONNECT_TIMEOUT_MS,
    );
    if (isRecord(result) && typeof result.protocolVersion === "string") {
      connection.protocolVersion = result.protocolVersion.slice(0, 32);
    }
    await connection.notify("notifications/initialized");
    return connection;
  }

  private headers(): Headers {
    const headers = new Headers({
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "user-agent": "Margaya MCP client",
      "mcp-protocol-version": this.protocolVersion,
    });
    for (const [name, value] of Object.entries(this.endpoint.headers ?? {})) {
      headers.set(name, value);
    }
    if (this.sessionId) headers.set("mcp-session-id", this.sessionId);
    return headers;
  }

  private async post(
    body: unknown,
    timeoutMs: number,
    read: (response: Response) => Promise<unknown>,
  ): Promise<unknown> {
    const signal = AbortSignal.timeout(timeoutMs);
    try {
      const response = await withoutOutboundTelemetry(() =>
        fetch(this.endpoint.url, {
          method: "POST",
          headers: this.headers(),
          body: JSON.stringify(body),
          redirect: "error",
          signal,
        }),
      );
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        throw new McpError("HTTP", response.status);
      }
      const session = response.headers.get("mcp-session-id");
      if (session && !this.sessionId && /^[\x21-\x7e]{1,200}$/.test(session)) {
        this.sessionId = session;
      }
      return await read(response);
    } catch (error) {
      if (error instanceof McpError) throw error;
      if (signal.aborted) throw new McpError("TIMEOUT");
      throw new McpError("NETWORK");
    }
  }

  private async notify(method: string): Promise<void> {
    await this.post({ jsonrpc: "2.0", method }, CONNECT_TIMEOUT_MS, (r) => {
      void r.body?.cancel().catch(() => {});
      return Promise.resolve(null);
    });
  }

  async request(
    method: string,
    params: Record<string, unknown>,
    timeoutMs = CALL_TIMEOUT_MS,
  ): Promise<unknown> {
    const id = this.nextId++;
    const answer = (await this.post(
      { jsonrpc: "2.0", id, method, params },
      timeoutMs,
      async (response) => {
        const type = response.headers.get("content-type") ?? "";
        const stream = type.includes("text/event-stream");
        const body = await readCapped(response, (text) => {
          if (!stream) return false;
          const { events } = splitSseEvents(text);
          return answerOf(events.map(parseJson), id) !== null;
        });
        return parseRpcResponse(body, type, id);
      },
    )) as RpcMessage;
    if (answer.error) throw new McpError("RPC");
    return answer.result;
  }

  /** The server's tools (at most MAX_TOOLS_PER_CONNECTOR). */
  async listTools(): Promise<McpTool[]> {
    const tools: McpTool[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < MAX_LIST_PAGES; page++) {
      const result = await this.request(
        "tools/list",
        cursor ? { cursor } : {},
        CONNECT_TIMEOUT_MS,
      );
      const parsed = toolsFromList(result);
      tools.push(...parsed.tools);
      cursor = parsed.nextCursor;
      if (!cursor || tools.length >= MAX_TOOLS_PER_CONNECTOR) break;
    }
    return tools.slice(0, MAX_TOOLS_PER_CONNECTOR);
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ text: string; isError: boolean }> {
    return toolResultText(
      await this.request("tools/call", { name, arguments: args }),
    );
  }
}
