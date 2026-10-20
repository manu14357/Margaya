import Anthropic from "@anthropic-ai/sdk";
import { AiError } from "../errors";
import type {
  AiProvider,
  ChatContent,
  ChatDelta,
  ChatMessage,
  ChatRequest,
  StopReason,
} from "../types";

// Claude through the official SDK. Every call streams (long outputs never
// hit HTTP timeouts) and the frozen first system block is cached. Thinking is
// left adaptive (its default on current models); depth is set with
// `output_config.effort`. Forced tool choice and assistant prefill are not
// used: current models reject them.

type BetaParams = Anthropic.Beta.Messages.MessageCreateParamsStreaming;
type BetaMessageParam = Anthropic.Beta.Messages.BetaMessageParam;
type BetaContentBlockParam = Anthropic.Beta.Messages.BetaContentBlockParam;

// Models that accept the server-side refusal fallback ("default" form):
// a declined request is retried on a suitable model inside the same call.
const SERVER_FALLBACK_MODELS = [
  "claude-fable-5-1",
  "claude-opus-5-5",
  "claude-opus-5",
  "claude-sonnet-5-5",
];
const SERVER_FALLBACK_BETA = "server-side-fallback-2026-07-01";

export function supportsServerFallback(model: string): boolean {
  return SERVER_FALLBACK_MODELS.includes(model);
}

// Models before adaptive thinking (Claude 3.x, Haiku 4.5, Sonnet and Opus
// 4.5 and older) reject `thinking: {type: "adaptive"}`.
const PRE_ADAPTIVE =
  /^claude-(3|haiku-4|sonnet-4-[05]\b|sonnet-4$|opus-4-[015]\b|opus-4$)/;

/** Whether a readable thinking summary may be requested from this model. */
export function supportsThinkingSummary(model: string): boolean {
  return model.startsWith("claude-") && !PRE_ADAPTIVE.test(model);
}

function contentBlock(block: ChatContent): BetaContentBlockParam {
  if (block.type === "text") return { type: "text", text: block.text };
  if (block.type === "image") {
    return {
      type: "image",
      source: { type: "base64", media_type: block.mediaType, data: block.data },
    };
  }
  if (block.type === "tool_use") {
    return {
      type: "tool_use",
      id: block.id,
      name: block.name,
      input: block.input as Record<string, unknown>,
    };
  }
  return {
    type: "tool_result",
    tool_use_id: block.toolUseId,
    content: block.content,
    ...(block.isError ? { is_error: true } : {}),
  };
}

function messageParam(message: ChatMessage): BetaMessageParam {
  return {
    role: message.role,
    content:
      typeof message.content === "string"
        ? message.content
        : message.content.map(contentBlock),
  };
}

/** The request body; exported for tests. */
export function anthropicParams(request: ChatRequest): BetaParams {
  const [stable, ...volatile] = request.system;
  const system = [
    ...(stable
      ? [
          {
            type: "text" as const,
            text: stable,
            cache_control: { type: "ephemeral" as const },
          },
        ]
      : []),
    ...volatile.map((text) => ({ type: "text" as const, text })),
  ];
  const outputConfig: NonNullable<BetaParams["output_config"]> = {};
  if (request.effort) outputConfig.effort = request.effort;
  if (request.jsonSchema) {
    outputConfig.format = { type: "json_schema", schema: request.jsonSchema };
  }
  const fallback = supportsServerFallback(request.model);
  return {
    model: request.model,
    max_tokens: request.maxTokens,
    stream: true,
    ...(system.length > 0 ? { system } : {}),
    messages: request.messages.map(messageParam),
    ...(request.tools?.length
      ? {
          tools: request.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            input_schema: {
              type: "object" as const,
              ...tool.inputSchema,
            },
          })),
          tool_choice: { type: "auto" as const },
        }
      : {}),
    ...(Object.keys(outputConfig).length > 0
      ? { output_config: outputConfig }
      : {}),
    // Thinking stays adaptive; asking for reasoning only makes its text
    // readable (a summary) instead of omitted.
    ...(request.reasoning && supportsThinkingSummary(request.model)
      ? {
          thinking: {
            type: "adaptive" as const,
            display: "summarized" as const,
          },
        }
      : {}),
    ...(fallback
      ? { betas: [SERVER_FALLBACK_BETA], fallbacks: "default" as const }
      : {}),
  };
}

function stopReason(reason: string | null | undefined): StopReason {
  if (reason === "end_turn" || reason === "stop_sequence") return "end_turn";
  if (reason === "max_tokens" || reason === "model_context_window_exceeded") {
    return "max_tokens";
  }
  if (reason === "tool_use") return "tool_use";
  if (reason === "refusal") return "refusal";
  return "other";
}

/** Maps SDK errors to AiErrors; provider text never leaves the server. */
export function anthropicError(error: unknown): unknown {
  if (error instanceof Anthropic.APIUserAbortError) return error;
  if (error instanceof Anthropic.AuthenticationError) {
    return new AiError(
      "AI_NOT_CONFIGURED",
      "The AI provider rejected the API key",
    );
  }
  if (error instanceof Anthropic.PermissionDeniedError) {
    return new AiError(
      "AI_NOT_CONFIGURED",
      "The API key may not use this model",
    );
  }
  if (error instanceof Anthropic.NotFoundError) {
    return new AiError("AI_NOT_CONFIGURED", "The AI model was not found");
  }
  if (error instanceof Anthropic.RateLimitError) {
    return new AiError("AI_RATE_LIMITED", "The AI provider is rate limiting", {
      retryAfterSeconds: 30,
    });
  }
  if (error instanceof Anthropic.BadRequestError) {
    return new AiError(
      "AI_PROVIDER_ERROR",
      "The AI provider refused the request",
    );
  }
  if (error instanceof Anthropic.APIError) {
    return new AiError("AI_PROVIDER_ERROR", "The AI provider failed");
  }
  return error;
}

export function createAnthropicProvider(options: {
  apiKey: string;
  /** Overall timeout per attempt, in milliseconds. */
  timeoutMs?: number;
}): AiProvider {
  const client = new Anthropic({
    apiKey: options.apiKey,
    maxRetries: 2,
    timeout: options.timeoutMs ?? 10 * 60 * 1000,
  });

  return {
    id: "anthropic",
    async *stream(request, signal): AsyncIterable<ChatDelta> {
      try {
        const stream = client.beta.messages.stream(anthropicParams(request), {
          signal,
        });
        for await (const event of stream) {
          if (event.type === "content_block_delta") {
            if (event.delta.type === "text_delta") {
              yield { type: "text", text: event.delta.text };
            } else if (event.delta.type === "thinking_delta") {
              yield { type: "reasoning", text: event.delta.thinking ?? "" };
            }
          } else if (
            event.type === "content_block_start" &&
            (event.content_block.type === "thinking" ||
              event.content_block.type === "redacted_thinking")
          ) {
            // Thinking started (its text may be omitted): time it.
            yield { type: "reasoning", text: "" };
          }
        }
        const message = await stream.finalMessage();
        for (const block of message.content) {
          if (block.type === "tool_use") {
            yield {
              type: "tool_call",
              call: {
                id: block.id,
                name: block.name,
                input: (block.input ?? {}) as Record<string, unknown>,
              },
            };
          }
        }
        yield {
          type: "usage",
          model: message.model,
          usage: {
            input: message.usage.input_tokens ?? 0,
            output: message.usage.output_tokens ?? 0,
            cacheRead: message.usage.cache_read_input_tokens ?? 0,
            cacheWrite: message.usage.cache_creation_input_tokens ?? 0,
          },
        };
        yield { type: "stop", reason: stopReason(message.stop_reason) };
      } catch (error) {
        throw anthropicError(error);
      }
    },
  };
}
