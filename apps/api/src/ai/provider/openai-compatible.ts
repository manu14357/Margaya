import { assertPublicDestination } from "../../utils/assert-public-destination";
import { AiError } from "../errors";
import type {
  AiProvider,
  ChatContent,
  ChatDelta,
  ChatRequest,
  StopReason,
  TokenUsage,
} from "../types";
import { modelTokenFilter } from "./model-tokens";

// One adapter for every server that speaks the OpenAI chat completions
// protocol: OpenAI, Azure OpenAI, OpenRouter, LiteLLM, vLLM, LM Studio and
// Ollama. The base URL includes the version path, e.g.
// https://api.openai.com/v1 or http://ollama:11434/v1. Only the operator's
// local endpoint may resolve to a private address.

const MAX_ERROR_BODY = 2048;

export type OpenAiCompatibleOptions = {
  baseUrl: string;
  apiKey?: string;
  /** Allow loopback and private addresses (the local endpoint only). */
  allowPrivate: boolean;
  timeoutMs?: number;
  /** Model for embeddings, when this endpoint serves them. */
  embeddingModel?: string;
  /**
   * Ask the server to skip the model's thinking phase (vLLM / Qwen
   * `chat_template_kwargs.enable_thinking`). Only for local endpoints:
   * hosted OpenAI rejects unknown fields.
   */
  disableThinking?: boolean;
  /** Injected in tests. */
  fetchImpl?: typeof fetch;
};

type OpenAiUserPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

type OpenAiMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string | OpenAiUserPart[] }
  | {
      role: "assistant";
      content: string | null;
      tool_calls?: {
        id: string;
        type: "function";
        function: { name: string; arguments: string };
      }[];
    }
  | { role: "tool"; tool_call_id: string; content: string };

function textOf(content: string | ChatContent[]): string {
  if (typeof content === "string") return content;
  return content
    .filter(
      (block): block is { type: "text"; text: string } => block.type === "text",
    )
    .map((block) => block.text)
    .join("\n");
}

/** The request body; exported for tests. */
export function openAiBody(request: ChatRequest) {
  const messages: OpenAiMessage[] = [];
  // Many compatible servers (Ollama cloud models, older vLLM) accept
  // response_format but don't enforce it, so the schema is also stated.
  const system = request.jsonSchema
    ? [
        ...request.system,
        `Answer with only one JSON object that matches this JSON Schema, with no other text and no code fences:\n${JSON.stringify(request.jsonSchema)}`,
      ]
    : request.system;
  if (system.length > 0) {
    messages.push({ role: "system", content: system.join("\n\n") });
  }
  for (const message of request.messages) {
    if (typeof message.content === "string") {
      messages.push({ role: message.role, content: message.content });
      continue;
    }
    if (message.role === "assistant") {
      const calls = message.content.filter(
        (block) => block.type === "tool_use",
      );
      messages.push({
        role: "assistant",
        content: textOf(message.content) || null,
        ...(calls.length > 0
          ? {
              tool_calls: calls.map((call) => ({
                id: call.id,
                type: "function" as const,
                function: {
                  name: call.name,
                  arguments: JSON.stringify(call.input ?? {}),
                },
              })),
            }
          : {}),
      });
      continue;
    }
    for (const block of message.content) {
      if (block.type === "tool_result") {
        messages.push({
          role: "tool",
          tool_call_id: block.toolUseId,
          content: block.content,
        });
      }
    }
    const text = textOf(message.content);
    const images = message.content.flatMap((block) =>
      block.type === "image"
        ? [
            {
              type: "image_url" as const,
              image_url: {
                url: `data:${block.mediaType};base64,${block.data}`,
              },
            },
          ]
        : [],
    );
    if (images.length > 0) {
      // Vision models take content parts; images first, then the text.
      messages.push({
        role: "user",
        content: [
          ...images,
          ...(text ? [{ type: "text" as const, text }] : []),
        ],
      });
    } else if (text) {
      messages.push({ role: "user", content: text });
    }
  }
  return {
    model: request.model,
    messages,
    max_tokens: request.maxTokens,
    stream: true,
    stream_options: { include_usage: true },
    ...(request.tools?.length
      ? {
          tools: request.tools.map((tool) => ({
            type: "function",
            function: {
              name: tool.name,
              description: tool.description,
              parameters: { type: "object", ...tool.inputSchema },
            },
          })),
        }
      : {}),
    ...(request.jsonSchema
      ? {
          response_format: {
            type: "json_schema",
            json_schema: { name: "result", schema: request.jsonSchema },
          },
        }
      : {}),
  };
}

function endpoint(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${path}`;
}

function statusError(status: number, body = ""): AiError {
  // vLLM serves chat without tool calling unless started with a tool-call
  // parser; agents can't work then. A fixed message, never the body itself.
  if (status === 400 && /tool[ _-]?(choice|call)/i.test(body)) {
    return new AiError(
      "AI_NOT_CONFIGURED",
      "The AI server does not accept tool calls, which agents need. Start it with tool calling enabled (vLLM: --enable-auto-tool-choice --tool-call-parser <parser for the model>)",
    );
  }
  if (status === 401 || status === 403) {
    return new AiError(
      "AI_NOT_CONFIGURED",
      "The AI endpoint rejected the API key",
    );
  }
  if (status === 404) {
    return new AiError(
      "AI_NOT_CONFIGURED",
      "The AI endpoint or model was not found",
    );
  }
  if (status === 429) {
    return new AiError("AI_RATE_LIMITED", "The AI endpoint is rate limiting", {
      retryAfterSeconds: 30,
    });
  }
  return new AiError("AI_PROVIDER_ERROR", `The AI endpoint failed (${status})`);
}

function finishReason(reason: string | null | undefined): StopReason {
  if (reason === "stop") return "end_turn";
  if (reason === "length") return "max_tokens";
  if (reason === "tool_calls" || reason === "function_call") return "tool_use";
  if (reason === "content_filter") return "refusal";
  return "other";
}

/** Splits an SSE body into the JSON of each `data:` line. */
async function* sseData(
  body: ReadableStream<Uint8Array>,
): AsyncIterable<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        const line = buffer.slice(0, newline).replace(/\r$/, "");
        buffer = buffer.slice(newline + 1);
        if (line.startsWith("data:")) {
          const data = line.slice(5).trim();
          if (data === "[DONE]") return;
          if (data) yield data;
        }
        newline = buffer.indexOf("\n");
      }
    }
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/**
 * Splits `<think>…</think>` blocks out of streamed text, including tags split
 * across chunks: `push` returns the visible text, and the thinking goes to
 * `takeReasoning()` (never into the answer). Reasoning models may send one
 * even when asked not to. Exported for tests.
 */
export function thinkFilter() {
  const OPEN = "<think>";
  const CLOSE = "</think>";
  let inside = false;
  let pending = "";
  let reasoning = "";
  return {
    push(chunk: string): string {
      pending += chunk;
      let out = "";
      for (;;) {
        if (inside) {
          const end = pending.indexOf(CLOSE);
          if (end === -1) {
            // Keep only a possible partial closing tag.
            const keep = Math.min(pending.length, CLOSE.length - 1);
            reasoning += pending.slice(0, pending.length - keep);
            pending = pending.slice(pending.length - keep);
            return out;
          }
          reasoning += pending.slice(0, end);
          pending = pending.slice(end + CLOSE.length).replace(/^\s+/, "");
          inside = false;
          continue;
        }
        const start = pending.indexOf(OPEN);
        if (start !== -1) {
          out += pending.slice(0, start);
          pending = pending.slice(start + OPEN.length);
          inside = true;
          continue;
        }
        // Hold back a tail that could be the start of an opening tag.
        let keep = 0;
        for (let n = Math.min(OPEN.length - 1, pending.length); n > 0; n--) {
          if (OPEN.startsWith(pending.slice(-n))) {
            keep = n;
            break;
          }
        }
        out += pending.slice(0, pending.length - keep);
        pending = pending.slice(pending.length - keep);
        return out;
      }
    },
    /** Thinking text seen since the last call (an unclosed block too). */
    takeReasoning(): string {
      const text = reasoning;
      reasoning = "";
      return text;
    },
    /** Whether a <think> block is open (the model is thinking). */
    get thinking(): boolean {
      return inside;
    },
    flush(): string {
      const rest = inside ? "" : pending;
      if (inside) reasoning += pending;
      pending = "";
      return rest;
    },
  };
}

type StreamChunk = {
  model?: string;
  choices?: {
    delta?: {
      content?: string | null;
      // Reasoning text, by server: vLLM and DeepSeek send
      // `reasoning_content`, Ollama and OpenRouter `reasoning`.
      reasoning?: string | null;
      reasoning_content?: string | null;
      tool_calls?: {
        index: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }[];
    };
    finish_reason?: string | null;
  }[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_tokens_details?: { cached_tokens?: number };
  } | null;
};

export function createOpenAiCompatibleProvider(
  options: OpenAiCompatibleOptions,
): AiProvider {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 10 * 60 * 1000;

  async function post(path: string, body: unknown, signal: AbortSignal) {
    const url = endpoint(options.baseUrl, path);
    if (!options.allowPrivate) {
      try {
        await assertPublicDestination(url, "AI endpoint");
      } catch {
        throw new AiError(
          "AI_NOT_CONFIGURED",
          "The AI endpoint must be a public address",
        );
      }
    }
    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(options.apiKey
            ? { authorization: `Bearer ${options.apiKey}` }
            : {}),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
        redirect: "error",
      });
    } catch (error) {
      if (signal.aborted) throw error;
      throw new AiError("AI_PROVIDER_ERROR", "The AI endpoint is unreachable");
    }
    if (!response.ok) {
      // Drain a little so the connection can be reused; never surface it.
      const text = await response
        .text()
        .then((text) => text.slice(0, MAX_ERROR_BODY))
        .catch(() => "");
      throw statusError(response.status, text);
    }
    return response;
  }

  return {
    id: "openai_compatible",
    async *stream(request, signal): AsyncIterable<ChatDelta> {
      const response = await post(
        "chat/completions",
        options.disableThinking
          ? {
              ...openAiBody(request),
              chat_template_kwargs: { enable_thinking: false },
            }
          : openAiBody(request),
        signal,
      );
      const visible = thinkFilter();
      // Tokens and tool calls a server printed as text instead of parsing.
      const tokens = modelTokenFilter();
      if (!response.body) {
        throw new AiError("AI_PROVIDER_ERROR", "The AI endpoint sent nothing");
      }
      const calls = new Map<
        number,
        { id: string; name: string; arguments: string }
      >();
      let usage: TokenUsage | null = null;
      let model: string | undefined;
      let reason: StopReason = "end_turn";
      for await (const data of sseData(response.body)) {
        let chunk: StreamChunk;
        try {
          chunk = JSON.parse(data) as StreamChunk;
        } catch {
          continue;
        }
        model = chunk.model ?? model;
        for (const choice of chunk.choices ?? []) {
          const thought =
            choice.delta?.reasoning_content ?? choice.delta?.reasoning ?? "";
          if (typeof thought === "string" && thought) {
            yield { type: "reasoning", text: thought };
          }
          const shown = choice.delta?.content
            ? visible.push(choice.delta.content)
            : "";
          const text = shown ? tokens.push(shown) : "";
          const tagged = visible.takeReasoning();
          if (tagged || (visible.thinking && choice.delta?.content)) {
            yield { type: "reasoning", text: tagged };
          }
          if (text) yield { type: "text", text };
          for (const call of choice.delta?.tool_calls ?? []) {
            const current = calls.get(call.index) ?? {
              id: "",
              name: "",
              arguments: "",
            };
            if (call.id) current.id = call.id;
            if (call.function?.name) current.name += call.function.name;
            if (call.function?.arguments) {
              current.arguments += call.function.arguments;
            }
            calls.set(call.index, current);
          }
          if (choice.finish_reason) reason = finishReason(choice.finish_reason);
        }
        if (chunk.usage) {
          usage = {
            input: chunk.usage.prompt_tokens ?? 0,
            output: chunk.usage.completion_tokens ?? 0,
            cacheRead: chunk.usage.prompt_tokens_details?.cached_tokens ?? 0,
            cacheWrite: 0,
          };
        }
      }
      const shownRest = visible.flush();
      const unclosed = visible.takeReasoning();
      if (unclosed) yield { type: "reasoning", text: unclosed };
      const rest = (shownRest ? tokens.push(shownRest) : "") + tokens.flush();
      if (rest) yield { type: "text", text: rest };
      for (const [index, call] of [...calls.entries()].sort(
        (a, b) => a[0] - b[0],
      )) {
        let input: Record<string, unknown> = {};
        try {
          const parsed: unknown = JSON.parse(call.arguments || "{}");
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            input = parsed as Record<string, unknown>;
          }
        } catch {
          // Truncated or invalid arguments: the caller validates the input.
        }
        yield {
          type: "tool_call",
          call: { id: call.id || `call_${index}`, name: call.name, input },
        };
      }
      const written = tokens.takeCalls();
      for (const [index, call] of written.entries()) {
        yield {
          type: "tool_call",
          call: { id: `call_text_${index}`, ...call },
        };
      }
      if (written.length > 0 && reason === "end_turn") reason = "tool_use";
      yield {
        type: "usage",
        model,
        usage: usage ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      };
      yield { type: "stop", reason };
    },
    async embed(texts, signal) {
      if (!options.embeddingModel) {
        throw new AiError(
          "AI_NOT_CONFIGURED",
          "No embedding model is configured",
        );
      }
      const response = await post(
        "embeddings",
        { model: options.embeddingModel, input: texts },
        signal,
      );
      const body = (await response.json()) as {
        data?: { index: number; embedding: number[] }[];
      };
      return [...(body.data ?? [])]
        .sort((a, b) => a.index - b.index)
        .map((item) => item.embedding);
    },
  };
}
