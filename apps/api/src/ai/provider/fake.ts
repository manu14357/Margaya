import { createHash } from "node:crypto";
import { AiError } from "../errors";
import type {
  AiProvider,
  ChatDelta,
  ChatRequest,
  ChatToolCall,
  StopReason,
} from "../types";

// A deterministic provider for development, tests and e2e: no network, no
// key. The same request always gives the same answer and token counts.
//
// - Plain requests answer "[fake:<model>] " followed by the last user text.
// - With a JSON schema, the answer is a minimal value matching it.
// - Markers in the last user text steer it: `[[fake:refuse]]` refuses,
//   `[[fake:error]]` fails like a provider outage,
//   `[[fake:tool:<name> <json>]]` calls a tool, and with a JSON schema
//   `[[fake:json <json>]]` answers that JSON (a separate server, as in e2e,
//   can't be scripted any other way).
// - Tests may script answers with `setFakeResponder`.

export type FakeReply = {
  /** Streamed as reasoning deltas before the answer. */
  reasoning?: string;
  text?: string;
  toolCalls?: ChatToolCall[];
  stop?: StopReason;
};

type Responder = (request: ChatRequest) => FakeReply | null | undefined;

let responder: Responder | null = null;

/** Scripts the fake provider's answers (tests); null restores the default. */
export function setFakeResponder(next: Responder | null): void {
  responder = next;
}

function lastUserText(request: ChatRequest): string {
  for (let i = request.messages.length - 1; i >= 0; i--) {
    const message = request.messages[i];
    if (message?.role !== "user") continue;
    if (typeof message.content === "string") return message.content;
    return message.content
      .map((block) =>
        block.type === "text"
          ? block.text
          : block.type === "tool_result"
            ? block.content
            : "",
      )
      .join("\n");
  }
  return "";
}

/** A minimal value matching a JSON schema (first enum value, required keys). */
export function sampleForSchema(schema: unknown, depth = 0): unknown {
  if (!schema || typeof schema !== "object" || depth > 8) return null;
  const s = schema as Record<string, unknown>;
  if (Array.isArray(s.enum) && s.enum.length > 0) return s.enum[0];
  if ("const" in s) return s.const;
  const type = Array.isArray(s.type) ? s.type[0] : s.type;
  switch (type) {
    case "object": {
      const properties = (s.properties ?? {}) as Record<string, unknown>;
      const required = Array.isArray(s.required)
        ? (s.required as string[])
        : Object.keys(properties);
      const out: Record<string, unknown> = {};
      for (const key of required) {
        out[key] = sampleForSchema(properties[key], depth + 1);
      }
      return out;
    }
    case "array":
      return [];
    case "string":
      return "fake";
    case "integer":
    case "number":
      return 0;
    case "boolean":
      return false;
    case "null":
      return null;
    default:
      if (Array.isArray(s.anyOf) && s.anyOf.length > 0) {
        return sampleForSchema(s.anyOf[0], depth + 1);
      }
      return null;
  }
}

/** About four characters per token, like real tokenizers on English. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function requestText(request: ChatRequest): string {
  return [
    ...request.system,
    ...request.messages.map((message) =>
      typeof message.content === "string"
        ? message.content
        : JSON.stringify(message.content),
    ),
  ].join("\n");
}

function defaultReply(request: ChatRequest): FakeReply {
  const text = lastUserText(request);
  if (text.includes("[[fake:error]]")) {
    throw new AiError("AI_PROVIDER_ERROR", "The AI provider failed");
  }
  if (text.includes("[[fake:refuse]]")) return { text: "", stop: "refusal" };
  const tool = /\[\[fake:tool:([A-Za-z0-9_-]+)\s*(\{.*?\})?\]\]/s.exec(text);
  if (tool?.[1]) {
    let input: Record<string, unknown> = {};
    try {
      input = tool[2] ? (JSON.parse(tool[2]) as Record<string, unknown>) : {};
    } catch {
      input = {};
    }
    return {
      text: "",
      toolCalls: [{ id: `fake_call_${tool[1]}`, name: tool[1], input }],
      stop: "tool_use",
    };
  }
  if (request.jsonSchema) {
    const scripted = /\[\[fake:json\s*(\{.*\})\s*\]\]/s.exec(text)?.[1];
    return {
      text: scripted ?? JSON.stringify(sampleForSchema(request.jsonSchema)),
    };
  }
  return { text: `[fake:${request.model}] ${text.slice(0, 400)}`.trim() };
}

/** Deterministic unit vector for a text (embeddings in tests). */
export function fakeEmbedding(text: string, dimensions = 16): number[] {
  const digest = createHash("sha256").update(text).digest();
  const vector = Array.from(
    { length: dimensions },
    (_, i) => ((digest[i % digest.length] ?? 0) - 128) / 128,
  );
  const norm = Math.hypot(...vector) || 1;
  return vector.map((value) => value / norm);
}

export function createFakeProvider(): AiProvider {
  return {
    id: "fake",
    async *stream(request, signal): AsyncIterable<ChatDelta> {
      const reply = responder?.(request) ?? defaultReply(request);
      const text = reply.text ?? "";
      for (const piece of reply.reasoning?.match(/\S+\s*|\s+/g) ?? []) {
        yield { type: "reasoning", text: request.reasoning ? piece : "" };
      }
      // Word-sized chunks, so streaming code paths are exercised.
      for (const piece of text.match(/\S+\s*|\s+/g) ?? []) {
        if (signal.aborted) throw signal.reason ?? new Error("aborted");
        yield { type: "text", text: piece };
      }
      for (const call of reply.toolCalls ?? []) {
        yield { type: "tool_call", call };
      }
      yield {
        type: "usage",
        model: request.model,
        usage: {
          input: estimateTokens(requestText(request)),
          output: estimateTokens(
            text + JSON.stringify(reply.toolCalls ?? []).replace(/^\[\]$/, ""),
          ),
          cacheRead: 0,
          cacheWrite: 0,
        },
      };
      yield {
        type: "stop",
        reason:
          reply.stop ?? (reply.toolCalls?.length ? "tool_use" : "end_turn"),
      };
    },
    async embed(texts) {
      return texts.map((text) => fakeEmbedding(text));
    },
  };
}
