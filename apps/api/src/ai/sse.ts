import type { Context } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "../openapi";
import { AiError, isAiError } from "./errors";
import type { AiResult, AiStream } from "./gateway";
import { getAiInstanceConfig } from "./instance-config";

// Server-Sent Events for chat-like AI routes, with a JSON fallback.
//
// Events, in order:
//   meta      { provider, model, tier, dataTier, destination, ...extra }
//   reasoning { text }                       (zero or more, before the answer)
//   delta     { text }                       (many)
//   tool_call { id, name, input }            (zero or more)
//   done      { stop, usage, costMicros, model, reasoningMs, ...final }
//   error     { code, message }              (instead of done)
//
// A client that sends `Accept: application/json` (or `?stream=false`) gets
// one JSON body instead: { text, toolCalls, stop, usage, costMicros, meta,
// reasoningMs, ...extra, ...final }. Closing the connection cancels the
// model call.
//
// Reasoning: the first `reasoning` event says the model started thinking.
// Its text is only sent when the instance shows reasoning (ai.showReasoning);
// otherwise every event's text is empty and only the duration is shared.
// Reasoning is never stored or logged.

export const AI_STREAM_EVENTS = [
  "meta",
  "reasoning",
  "delta",
  "tool_call",
  "done",
  "error",
] as const;

/** Whether the client asked for a stream (the default) or JSON. */
export function wantsAiStream(c: Context): boolean {
  if (c.req.query("stream") === "false") return false;
  const accept = c.req.header("accept") ?? "";
  if (accept.includes("text/event-stream")) return true;
  return !accept.includes("application/json");
}

type StreamOptions = {
  /** Sent with `meta` (and in the JSON body), e.g. citations. */
  extra?: Record<string, unknown>;
  /**
   * Runs after the model finished, before `done`; its fields go into
   * `done` (and the JSON body). Use it to validate or post-process.
   */
  finalize?: (
    result: AiResult,
  ) => Promise<Record<string, unknown> | void> | Record<string, unknown> | void;
  /** Send reasoning text; default: the instance setting ai.showReasoning. */
  showReasoning?: boolean;
};

function errorBody(error: unknown) {
  if (isAiError(error)) return error.toJSON();
  return { code: "AI_PROVIDER_ERROR", message: "The AI request failed" };
}

/**
 * A refusal or an answer cut off before any visible text (a reasoning model
 * that spent the whole budget thinking) is an error, not an empty answer.
 */
export function assertAnswered(result: AiResult): void {
  if (result.stop === "refusal" && !result.text) {
    throw new AiError("AI_REFUSED", "The AI model declined this request");
  }
  if (
    result.stop === "max_tokens" &&
    !result.text.trim() &&
    result.toolCalls.length === 0
  ) {
    throw new AiError(
      "AI_PROVIDER_ERROR",
      "The AI model ran out of room before answering. Try a shorter question.",
    );
  }
}

/** Answers the request with the AI stream (or its JSON fallback). */
export async function respondWithAi(
  c: Context,
  stream: AiStream,
  options: StreamOptions = {},
): Promise<Response> {
  const meta = { ...stream.meta, ...options.extra };

  if (!wantsAiStream(c)) {
    try {
      for await (const _delta of stream.deltas) {
        // Drain into the result.
      }
      const result = await stream.result;
      assertAnswered(result);
      const final = (await options.finalize?.(result)) ?? {};
      return c.json(
        {
          text: result.text,
          toolCalls: result.toolCalls,
          stop: result.stop,
          usage: result.usage,
          costMicros: result.costMicros,
          reasoningMs: result.reasoningMs ?? null,
          // The configured model name (what the admin set), as in `meta`.
          meta,
          ...options.extra,
          ...final,
        },
        200,
      );
    } catch (error) {
      if (isAiError(error)) throw error;
      throw new AiError("AI_PROVIDER_ERROR", "The AI request failed");
    }
  }

  const showReasoning =
    options.showReasoning ?? getAiInstanceConfig().showReasoning;
  c.header("Cache-Control", "no-store");
  c.header("X-Accel-Buffering", "no");
  return streamSSE(c, async (sse) => {
    sse.onAbort(() => stream.cancel());
    await sse.writeSSE({ event: "meta", data: JSON.stringify(meta) });
    let thinking = false;
    try {
      for await (const delta of stream.deltas) {
        if (delta.type === "reasoning") {
          const text = showReasoning ? delta.text : "";
          if (thinking && !text) continue;
          thinking = true;
          await sse.writeSSE({
            event: "reasoning",
            data: JSON.stringify({ text }),
          });
        } else if (delta.type === "text") {
          await sse.writeSSE({
            event: "delta",
            data: JSON.stringify({ text: delta.text }),
          });
        } else if (delta.type === "tool_call") {
          await sse.writeSSE({
            event: "tool_call",
            data: JSON.stringify(delta.call),
          });
        }
      }
      const result = await stream.result;
      assertAnswered(result);
      const final = (await options.finalize?.(result)) ?? {};
      await sse.writeSSE({
        event: "done",
        data: JSON.stringify({
          stop: result.stop,
          usage: result.usage,
          costMicros: result.costMicros,
          model: result.meta.model,
          reasoningMs: result.reasoningMs ?? null,
          ...final,
        }),
      });
    } catch (error) {
      await sse.writeSSE({
        event: "error",
        data: JSON.stringify(errorBody(error)),
      });
    }
  });
}

/**
 * OpenAPI for an AI streaming route: SSE, or JSON with `Accept:
 * application/json`. Pass the JSON fallback's extra fields, if any.
 */
export function aiStreamResponse(
  description: string,
  extra: z.ZodRawShape = {},
) {
  return {
    description: `${description} Streams Server-Sent Events (meta, reasoning, delta, tool_call, done or error); send Accept: application/json or ?stream=false for one JSON body instead.`,
    content: {
      "text/event-stream": {
        schema: z.string().openapi({
          description:
            "Events: meta {provider, model, tier, dataTier, destination}, reasoning {text} (the model is thinking; text only when the instance shows reasoning, else empty), delta {text}, tool_call {id, name, input}, done {stop, usage, costMicros, model, reasoningMs}, error {code, message}.",
        }),
      },
      "application/json": {
        schema: z.object({
          text: z.string(),
          toolCalls: z.array(
            z.object({
              id: z.string(),
              name: z.string(),
              input: z.record(z.string(), z.unknown()),
            }),
          ),
          stop: z.enum([
            "end_turn",
            "max_tokens",
            "tool_use",
            "refusal",
            "other",
          ]),
          usage: z.object({
            input: z.number().int(),
            output: z.number().int(),
            cacheRead: z.number().int(),
            cacheWrite: z.number().int(),
          }),
          costMicros: z.number().int(),
          reasoningMs: z.number().int().nullable().openapi({
            description:
              "How long the model thought before answering, in milliseconds; null when it did not think visibly.",
          }),
          meta: z.record(z.string(), z.unknown()),
          ...extra,
        }),
      },
    },
  };
}

/** The JSON error body of every AI failure (`code` maps to ai:errors.*). */
export const aiErrorSchema = z
  .object({
    code: z.enum([
      "AI_DISABLED",
      "AI_NOT_CONFIGURED",
      "AI_ROUTE_BLOCKED",
      "AI_BUDGET_EXCEEDED",
      "AI_RATE_LIMITED",
      "AI_REFUSED",
      "AI_PROVIDER_ERROR",
    ]),
    message: z.string(),
  })
  .openapi("AiError");

export function aiErrorResponse(description: string) {
  return {
    description,
    content: { "application/json": { schema: aiErrorSchema } },
  };
}
