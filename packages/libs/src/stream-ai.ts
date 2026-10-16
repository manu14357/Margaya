// Streaming helper for the API's AI routes. The typed Hono client can't read
// Server-Sent Events, so AI streams go through this one documented helper
// instead of a parallel request layer: same base URL, credentials and window
// header as `client`, and the same event names the API sends (ai/sse.ts).

export type AiStreamMeta = {
  provider: string;
  model: string;
  tier: string;
  dataTier: string;
  destination: string;
  [key: string]: unknown;
};

export type AiStreamDone = {
  stop: "end_turn" | "max_tokens" | "tool_use" | "refusal" | "other";
  usage: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
  };
  costMicros: number;
  model: string;
  [key: string]: unknown;
};

export type AiStreamError = { code: string; message: string; status?: number };

export type AiToolCallEvent = {
  id: string;
  name: string;
  input: Record<string, unknown>;
};

export type AiStreamHandlers = {
  onMeta?: (meta: AiStreamMeta) => void;
  onDelta?: (text: string) => void;
  onToolCall?: (call: AiToolCallEvent) => void;
  onDone?: (done: AiStreamDone) => void;
  onError?: (error: AiStreamError) => void;
  /** Any other event a route sends, e.g. `progress`. */
  onEvent?: (event: string, data: unknown) => void;
};

export type AiStreamOptions = AiStreamHandlers & {
  /** The API base URL, as the typed client uses (ends with /api). */
  apiUrl: string;
  /** Path under the API, e.g. "/ai/ask". */
  path: string;
  body: unknown;
  windowId?: string;
  signal?: AbortSignal;
};

/** Parses one SSE block ("event: x\ndata: y"). */
export function parseSseBlock(
  block: string,
): { event: string; data: string } | null {
  let event = "message";
  const data: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  return data.length > 0 ? { event, data: data.join("\n") } : null;
}

function errorFromBody(status: number, text: string): AiStreamError {
  try {
    const body = JSON.parse(text) as { code?: unknown; message?: unknown };
    if (typeof body.code === "string") {
      return {
        code: body.code,
        message: typeof body.message === "string" ? body.message : "",
        status,
      };
    }
  } catch {
    // Plain-text errors (permissions, validation).
  }
  return { code: `HTTP_${status}`, message: text, status };
}

/**
 * POSTs to an AI route and dispatches its events. Resolves with the full
 * text when the stream ends (also after an `error` event, which the
 * handler receives). Abort with `signal` to cancel the model call.
 */
export async function streamAi(options: AiStreamOptions): Promise<string> {
  const response = await fetch(`${options.apiUrl}${options.path}`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      Accept: "text/event-stream",
      ...(options.windowId ? { "X-Margaya-Window-Id": options.windowId } : {}),
    },
    body: JSON.stringify(options.body),
    signal: options.signal,
  });
  if (!response.ok || !response.body) {
    options.onError?.(errorFromBody(response.status, await response.text()));
    return "";
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  const dispatch = (block: string) => {
    const parsed = parseSseBlock(block);
    if (!parsed) return;
    let data: unknown;
    try {
      data = JSON.parse(parsed.data);
    } catch {
      return;
    }
    switch (parsed.event) {
      case "meta":
        options.onMeta?.(data as AiStreamMeta);
        break;
      case "delta": {
        const delta = (data as { text?: string }).text ?? "";
        text += delta;
        options.onDelta?.(delta);
        break;
      }
      case "tool_call":
        options.onToolCall?.(data as AiToolCallEvent);
        break;
      case "done":
        options.onDone?.(data as AiStreamDone);
        break;
      case "error":
        options.onError?.(data as AiStreamError);
        break;
      default:
        options.onEvent?.(parsed.event, data);
    }
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let boundary = /\r?\n\r?\n/.exec(buffer);
      while (boundary) {
        dispatch(buffer.slice(0, boundary.index));
        buffer = buffer.slice(boundary.index + boundary[0].length);
        boundary = /\r?\n\r?\n/.exec(buffer);
      }
    }
    if (buffer.trim()) dispatch(buffer);
  } finally {
    reader.releaseLock();
  }
  return text;
}
