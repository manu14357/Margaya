// Provider-neutral shapes for every model call (ai/gateway.ts). Adapters in
// ai/provider/ translate them to and from each provider's wire format.

export const MODEL_TIERS = ["fast", "balanced", "deep"] as const;
/** fast: classify, rewrite; balanced: most features; deep: agents, plans. */
export type ModelTier = (typeof MODEL_TIERS)[number];

export const DATA_TIERS = ["public", "private", "restricted"] as const;
/**
 * How sensitive the data in a call is (ai/router.ts): `restricted` holds
 * content from restricted projects, `private` any other workspace data,
 * `public` only what is already published or contains no workspace data.
 */
export type DataTier = (typeof DATA_TIERS)[number];

export type ProviderId = "anthropic" | "openai_compatible" | "fake";

/** Thinking depth and spend; mapped to each provider's nearest control. */
export type Effort = "low" | "medium" | "high";

export type ChatRole = "user" | "assistant";

export type ChatToolCall = {
  id: string;
  name: string;
  input: Record<string, unknown>;
};

/** Image types every vision adapter accepts (Anthropic and OpenAI-style). */
export const CHAT_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;
/** GIF is accepted by both too; only Ask attachments send it (no metadata to strip). */
export type ChatImageType = (typeof CHAT_IMAGE_TYPES)[number] | "image/gif";

export type ChatContent =
  | { type: "text"; text: string }
  /**
   * A base64 image (user turns only). Callers validate type and size and
   * strip metadata first (ai-capture/images.ts); the gateway never redacts
   * images, so they always count as at least private data.
   */
  | { type: "image"; mediaType: ChatImageType; data: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | {
      type: "tool_result";
      toolUseId: string;
      content: string;
      isError?: boolean;
    };

export type ChatMessage = {
  role: ChatRole;
  content: string | ChatContent[];
};

export type ChatTool = {
  name: string;
  description: string;
  /** JSON Schema of the input; `additionalProperties: false` for strict. */
  inputSchema: Record<string, unknown>;
};

/** What an adapter receives: provider-neutral, already redacted. */
export type ChatRequest = {
  model: string;
  /** Stable instructions first (cached), volatile ones after. */
  system: string[];
  messages: ChatMessage[];
  tools?: ChatTool[];
  maxTokens: number;
  effort?: Effort;
  /** JSON Schema the final text must match, where the provider supports it. */
  jsonSchema?: Record<string, unknown>;
  /**
   * Ask for readable reasoning (Anthropic: a thinking summary). Without it
   * providers still report that the model is thinking, with empty text.
   */
  reasoning?: boolean;
};

export type TokenUsage = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

export type StopReason =
  | "end_turn"
  | "max_tokens"
  | "tool_use"
  | "refusal"
  | "other";

/**
 * One normalized streaming event. `reasoning` is the model's thinking (may
 * be empty text: "thinking, nothing to show"); it is never stored or logged.
 */
export type ChatDelta =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "tool_call"; call: ChatToolCall }
  | { type: "usage"; usage: TokenUsage; model?: string }
  | { type: "stop"; reason: StopReason };

export type AiProvider = {
  id: ProviderId;
  /** Streams one model turn. Must honor `signal`. */
  stream(request: ChatRequest, signal: AbortSignal): AsyncIterable<ChatDelta>;
  /** Text embeddings, when the provider offers them. */
  embed?(texts: string[], signal: AbortSignal): Promise<number[][]>;
};

export function emptyUsage(): TokenUsage {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
}
