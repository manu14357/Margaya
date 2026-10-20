import * as Sentry from "@sentry/node";
import { and, eq, inArray } from "drizzle-orm";
import db from "../database";
import { projectTable } from "../database/schema";
import { createRateLimiter } from "../utils/rate-limit";
import type { AiContextItem } from "./context";
import {
  embeddingRoute,
  resolveEmbeddingDestination,
} from "./embedding-endpoint";
import { AiError } from "./errors";
import type { AiFeature } from "./features";
import { getAiInstanceConfig } from "./instance-config";
import { parseJsonAnswer } from "./json-answer";
import { costMicros } from "./pricing";
import { createAnthropicProvider } from "./provider/anthropic";
import { createFakeProvider } from "./provider/fake";
import { createOpenAiCompatibleProvider } from "./provider/openai-compatible";
import { createRedactor, type Redactor } from "./redact";
import { type AiDestination, dataTierOf, routeAiCall } from "./router";
import {
  type AiProvider,
  type ChatContent,
  type ChatDelta,
  type ChatMessage,
  type ChatRequest,
  type ChatTool,
  type ChatToolCall,
  type DataTier,
  type Effort,
  emptyUsage,
  type ModelTier,
  type StopReason,
  type TokenUsage,
} from "./types";
import { assertWithinBudget, recordAiUsage, type UsageStatus } from "./usage";
import { loadWorkspaceAi } from "./workspace-settings";

// The AI gateway: the ONE way to call a model. Every call
//   1. checks that AI is on (instance, workspace, every project in context),
//   2. decides the data tier and routes it (ai/router.ts, B4),
//   3. checks the workspace's monthly and the user's daily caps (B3),
//   4. limits concurrency and request rate,
//   5. optionally redacts PII for cloud calls and restores it in the answer,
//   6. streams the model's answer,
//   7. records an ai_usage row (counts only) and an optional OTel span.
// Preflight failures throw an AiError before anything is sent.

export type AiCallInput = {
  workspaceId: string;
  /** The person the call acts for; null only for system jobs. */
  userId: string | null;
  feature: AiFeature;
  /** Default "balanced". */
  tier?: ModelTier;
  /** What the prompt contains (decides data tier and project checks). */
  context?: readonly AiContextItem[];
  /** Raise the data tier above what `context` implies. */
  dataTier?: DataTier;
  /** Projects whose data is in the prompt but not in `context`. */
  projectIds?: readonly string[];
  /** From buildSystemPrompt(): [stable, volatile]. */
  system: string[];
  messages: ChatMessage[];
  tools?: ChatTool[];
  /** Default 4096. */
  maxTokens?: number;
  effort?: Effort;
  /** JSON Schema the answer must match (structured output). */
  jsonSchema?: Record<string, unknown>;
  signal?: AbortSignal;
  agentId?: string | null;
  runId?: string | null;
  /** Always use the instance's local model (an agent's provider override). */
  forceLocal?: boolean;
  /**
   * Ask the provider for readable reasoning text (Anthropic: a thinking
   * summary). Reasoning deltas stream either way; their text is never
   * stored or logged.
   */
  reasoning?: boolean;
};

export type AiCallMeta = {
  provider: AiDestination["provider"];
  model: string;
  tier: ModelTier;
  dataTier: DataTier;
  destination: AiDestination["kind"];
  /** How many values were redacted before the call. */
  redactions: number;
};

export type AiResult = {
  text: string;
  toolCalls: ChatToolCall[];
  stop: StopReason;
  usage: TokenUsage;
  costMicros: number;
  meta: AiCallMeta;
  /**
   * How long the model thought: from its first reasoning delta to its first
   * answer text (or the end). Null when it streamed no reasoning.
   */
  reasoningMs?: number | null;
};

export type AiStream = {
  meta: AiCallMeta;
  /** Text deltas (PII restored), tool calls, usage and the stop reason. */
  deltas: AsyncIterable<ChatDelta>;
  /** Settles once `deltas` has been fully read (or the call failed). */
  result: Promise<AiResult>;
  /** Stops the call; the ledger records it as cancelled. */
  cancel(): void;
};

// --- Limits ---

function envInt(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value >= 0 ? value : fallback;
}

const workspaceLimiter = createRateLimiter({
  name: "ai-workspace",
  windowSeconds: 60,
  max: () => envInt("MARGAYA_AI_WORKSPACE_RPM", 120),
});

const userLimiter = createRateLimiter({
  name: "ai-user",
  windowSeconds: 60,
  max: () => envInt("MARGAYA_AI_USER_RPM", 30),
});

const activeStreams = new Map<string, number>();

function acquireStreamSlot(userId: string | null): () => void {
  if (!userId) return () => {};
  const limit = envInt("MARGAYA_AI_USER_CONCURRENCY", 2);
  const current = activeStreams.get(userId) ?? 0;
  if (limit > 0 && current >= limit) {
    throw new AiError(
      "AI_RATE_LIMITED",
      "Wait for your other AI requests to finish",
      { retryAfterSeconds: 5 },
    );
  }
  activeStreams.set(userId, current + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = (activeStreams.get(userId) ?? 1) - 1;
    if (next <= 0) activeStreams.delete(userId);
    else activeStreams.set(userId, next);
  };
}

async function consumeRate(workspaceId: string, userId: string | null) {
  const checks: [typeof workspaceLimiter, string | null][] = [
    [workspaceLimiter, workspaceId],
    [userLimiter, userId],
  ];
  for (const [limiter, subject] of checks) {
    if (!subject) continue;
    const decision = await limiter.consume(subject);
    if (decision && !decision.allowed) {
      throw new AiError("AI_RATE_LIMITED", "Too many AI requests", {
        retryAfterSeconds: decision.retryAfter,
      });
    }
  }
}

// --- Output budget ---

/** Default extra output tokens for local models; see requestMaxTokens. */
export const LOCAL_REASONING_TOKENS = 4096;

/**
 * The max_tokens sent to the provider. Local reasoning models (Ollama cloud
 * models, Qwen 3.x, DeepSeek R1, MiniMax) think before answering, and those
 * hidden tokens count against max_tokens even when we ask them not to think,
 * so a feature's answer budget alone leaves them an empty or cut-off answer.
 * Local calls get reasoning headroom on top (MARGAYA_AI_LOCAL_REASONING_TOKENS,
 * 0 turns it off); hosted calls keep the feature's budget, which is also
 * what they bill.
 */
export function requestMaxTokens(
  requested: number,
  destination: Pick<AiDestination, "kind">,
): number {
  if (destination.kind !== "local") return requested;
  return (
    requested +
    envInt("MARGAYA_AI_LOCAL_REASONING_TOKENS", LOCAL_REASONING_TOKENS)
  );
}

// --- Providers ---

type ProviderFactory = (destination: AiDestination) => AiProvider;

const defaultFactory: ProviderFactory = (destination) => {
  if (destination.provider === "fake") return createFakeProvider();
  if (destination.provider === "anthropic") {
    return createAnthropicProvider({ apiKey: destination.apiKey });
  }
  return createOpenAiCompatibleProvider({
    baseUrl: destination.baseUrl,
    apiKey: destination.apiKey || undefined,
    allowPrivate: destination.allowPrivate,
    // Local reasoning models (Qwen 3.x on vLLM, Ollama) otherwise spend the
    // answer budget thinking out loud, so they are asked not to think unless
    // the instance turns local thinking on (ai.local.thinking).
    disableThinking:
      destination.kind === "local" &&
      getAiInstanceConfig().localThinking !== "on",
    // Only aiEmbed calls `embed`, and only with an embeddings destination,
    // whose model is the embedding model.
    embeddingModel: destination.model,
  });
};

let providerFactory: ProviderFactory = defaultFactory;

/** The provider for a routed destination (connection tests, embeddings). */
export function providerFor(destination: AiDestination): AiProvider {
  return providerFactory(destination);
}

/** Replaces how providers are built (tests); null restores the default. */
export function setAiProviderFactory(factory: ProviderFactory | null): void {
  providerFactory = factory ?? defaultFactory;
}

// --- Preflight ---

/** 403 AI_DISABLED unless every project exists, is live and has AI on. */
async function assertProjectsAllowAi(
  workspaceId: string,
  projectIds: readonly string[],
): Promise<void> {
  const ids = [...new Set(projectIds)];
  if (ids.length === 0) return;
  const rows = await db
    .select({
      id: projectTable.id,
      aiEnabled: projectTable.aiEnabled,
      deletedAt: projectTable.deletedAt,
    })
    .from(projectTable)
    .where(
      and(
        inArray(projectTable.id, ids),
        eq(projectTable.workspaceId, workspaceId),
      ),
    );
  const ok = new Set(
    rows.filter((row) => row.aiEnabled && !row.deletedAt).map((row) => row.id),
  );
  if (ids.some((id) => !ok.has(id))) {
    throw new AiError("AI_DISABLED", "AI is turned off for this project");
  }
}

type Prepared = {
  meta: AiCallMeta;
  provider: AiProvider;
  request: ChatRequest;
  redactor: Redactor | null;
  release: () => void;
};

async function prepare(input: AiCallInput): Promise<Prepared> {
  const instance = getAiInstanceConfig();
  if (!instance.enabled) {
    throw new AiError("AI_DISABLED", "AI is turned off on this server");
  }
  const workspace = await loadWorkspaceAi(input.workspaceId);
  if (!workspace.policy.enabled) {
    throw new AiError("AI_DISABLED", "AI is turned off for this workspace");
  }
  const context = input.context ?? [];
  // Also the workspace boundary: a project of another workspace fails here.
  await assertProjectsAllowAi(input.workspaceId, [
    ...(input.projectIds ?? []),
    ...context.flatMap((item) => (item.projectId ? [item.projectId] : [])),
  ]);

  const tier = input.tier ?? "balanced";
  // Images are never redacted or classified: they are at least private.
  const hasImages = input.messages.some(
    (message) =>
      typeof message.content !== "string" &&
      message.content.some((block) => block.type === "image"),
  );
  const dataTier = dataTierOf(
    [
      ...context.map((item) => item.dataTier),
      ...(hasImages ? (["private"] as const) : []),
    ],
    input.dataTier ?? "private",
  );
  const route = routeAiCall({
    instance,
    workspace: input.forceLocal
      ? { ...workspace.policy, localOnly: true }
      : workspace.policy,
    workspaceApiKey: workspace.apiKey,
    dataTier,
    tier,
  });
  if (!route.ok) throw new AiError(route.code, route.message);

  await assertWithinBudget({
    workspaceId: input.workspaceId,
    userId: input.userId,
    policy: workspace.policy,
  });
  await consumeRate(input.workspaceId, input.userId);
  const release = acquireStreamSlot(input.userId);

  try {
    const redactor = route.redact ? createRedactor() : null;
    const redactText = (text: string) =>
      redactor ? redactor.redact(text) : text;
    const redactContent = (block: ChatContent): ChatContent => {
      if (block.type === "text")
        return { ...block, text: redactText(block.text) };
      if (block.type === "tool_result") {
        return { ...block, content: redactText(block.content) };
      }
      return block;
    };
    const [stable = "", ...volatile] = input.system;
    const request: ChatRequest = {
      model: route.destination.model,
      // The first block is code-authored instructions; the rest may carry
      // request data, so it is redacted like the messages.
      system: [stable, ...volatile.map(redactText)].filter(Boolean),
      messages: input.messages.map((message) => ({
        role: message.role,
        content:
          typeof message.content === "string"
            ? redactText(message.content)
            : message.content.map(redactContent),
      })),
      tools: input.tools,
      maxTokens: requestMaxTokens(input.maxTokens ?? 4096, route.destination),
      effort: input.effort,
      jsonSchema: input.jsonSchema,
      reasoning: input.reasoning,
    };
    return {
      meta: {
        provider: route.destination.provider,
        model: route.destination.model,
        tier,
        dataTier,
        destination: route.destination.kind,
        redactions: redactor?.count ?? 0,
      },
      provider: providerFactory(route.destination),
      request,
      redactor,
      release,
    };
  } catch (error) {
    release();
    throw error;
  }
}

function restoreInput(
  redactor: Redactor | null,
  input: Record<string, unknown>,
): Record<string, unknown> {
  if (!redactor || redactor.count === 0) return input;
  try {
    return JSON.parse(redactor.restore(JSON.stringify(input))) as Record<
      string,
      unknown
    >;
  } catch {
    return input;
  }
}

function genAiSystem(provider: AiCallMeta["provider"]): string {
  return provider === "anthropic"
    ? "anthropic"
    : provider === "fake"
      ? "margaya.fake"
      : "openai";
}

// --- Public API ---

/**
 * Starts a streaming model call. Throws an AiError (an HTTPException)
 * during preflight; after that, failures surface while reading `deltas`.
 * Always read `deltas` to the end or call `cancel()`.
 */
export async function aiStream(input: AiCallInput): Promise<AiStream> {
  const prepared = await prepare(input);
  const { meta, provider, request, redactor, release } = prepared;
  const controller = new AbortController();
  const timeoutMs = envInt("MARGAYA_AI_TIMEOUT_MS", 10 * 60 * 1000);
  const signal = AbortSignal.any([
    controller.signal,
    AbortSignal.timeout(timeoutMs),
    ...(input.signal ? [input.signal] : []),
  ]);
  const startedAt = performance.now();
  const span = Sentry.startInactiveSpan({
    name: `chat ${meta.model}`,
    op: "gen_ai.chat",
    attributes: {
      "gen_ai.operation.name": "chat",
      "gen_ai.system": genAiSystem(meta.provider),
      "gen_ai.request.model": meta.model,
      "gen_ai.request.max_tokens": request.maxTokens,
      "margaya.ai.feature": input.feature,
      "margaya.ai.tier": meta.tier,
      "margaya.ai.data_tier": meta.dataTier,
      "margaya.ai.destination": meta.destination,
    },
  });

  let settle!: (result: AiResult) => void;
  let fail!: (error: unknown) => void;
  const result = new Promise<AiResult>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  // A caller that only awaits `deltas` must not see an unhandled rejection.
  result.catch(() => {});

  // A stream nobody reads must not hold a concurrency slot forever.
  let started = false;
  const idle = setTimeout(() => {
    if (!started) {
      controller.abort();
      release();
      span.end();
      fail(new AiError("AI_PROVIDER_ERROR", "The AI request was never read"));
    }
  }, 30_000);
  idle.unref?.();

  async function* run(): AsyncIterable<ChatDelta> {
    started = true;
    clearTimeout(idle);
    let text = "";
    const toolCalls: ChatToolCall[] = [];
    let usage = emptyUsage();
    let model = meta.model;
    let stop: StopReason = "other";
    let status: UsageStatus = "error";
    let failure: unknown = null;
    let reasoningStart: number | null = null;
    let answerStart: number | null = null;
    const restorer = redactor?.restoreStream() ?? null;
    try {
      for await (const delta of provider.stream(request, signal)) {
        if (delta.type === "text") {
          const out = restorer ? restorer.push(delta.text) : delta.text;
          text += out;
          if (out && answerStart === null) answerStart = performance.now();
          if (out) yield { type: "text", text: out };
        } else if (delta.type === "reasoning") {
          // Passed through only: reasoning is never kept in the result.
          if (answerStart !== null) continue;
          reasoningStart ??= performance.now();
          yield {
            type: "reasoning",
            text: redactor ? redactor.restore(delta.text) : delta.text,
          };
        } else if (delta.type === "tool_call") {
          const call = {
            ...delta.call,
            input: restoreInput(redactor, delta.call.input),
          };
          toolCalls.push(call);
          yield { type: "tool_call", call };
        } else if (delta.type === "usage") {
          usage = delta.usage;
          if (delta.model) model = delta.model;
          yield delta;
        } else {
          stop = delta.reason;
        }
      }
      if (restorer) {
        const rest = restorer.flush();
        if (rest) {
          text += rest;
          yield { type: "text", text: rest };
        }
      }
      status = stop === "refusal" ? "refused" : "ok";
      yield { type: "stop", reason: stop };
    } catch (error) {
      if (controller.signal.aborted || input.signal?.aborted) {
        status = "cancelled";
        failure = new AiError(
          "AI_PROVIDER_ERROR",
          "The AI request was cancelled",
        );
      } else if (error instanceof AiError) {
        failure = error;
      } else {
        // Provider errors may carry request details: log the kind only.
        console.error("AI provider call failed", {
          feature: input.feature,
          provider: meta.provider,
          model: meta.model,
          error: error instanceof Error ? error.name : "unknown",
        });
        failure = new AiError(
          "AI_PROVIDER_ERROR",
          signal.aborted
            ? "The AI provider timed out"
            : "The AI provider failed",
        );
      }
      throw failure;
    } finally {
      // A consumer that stops reading early cancels the call.
      if (status === "error" && failure === null) {
        status = "cancelled";
        controller.abort();
      }
      release();
      const cost = costMicros(model, usage);
      span.setAttributes({
        "gen_ai.response.model": model,
        "gen_ai.usage.input_tokens": usage.input,
        "gen_ai.usage.output_tokens": usage.output,
        "margaya.ai.status": status,
      });
      span.end();
      try {
        await recordAiUsage({
          workspaceId: input.workspaceId,
          userId: input.userId,
          agentId: input.agentId,
          runId: input.runId,
          feature: input.feature,
          provider: meta.provider,
          model,
          tier: meta.tier,
          dataTier: meta.dataTier,
          status,
          usage,
          costMicros: cost,
          durationMs: performance.now() - startedAt,
        });
      } catch (error) {
        console.error("Couldn't record AI usage", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      if (failure !== null || status === "cancelled") {
        fail(
          failure ??
            new AiError("AI_PROVIDER_ERROR", "The AI request was cancelled"),
        );
      } else {
        settle({
          text,
          toolCalls,
          stop,
          usage,
          costMicros: cost,
          meta: { ...meta, model },
          reasoningMs:
            reasoningStart === null
              ? null
              : Math.round((answerStart ?? performance.now()) - reasoningStart),
        });
      }
    }
  }

  return {
    meta,
    deltas: run(),
    result,
    cancel() {
      controller.abort();
      if (!started) {
        clearTimeout(idle);
        release();
        span.end();
        fail(new AiError("AI_PROVIDER_ERROR", "The AI request was cancelled"));
      }
    },
  };
}

/**
 * A non-streaming call: the whole answer at once. A refusal throws
 * AI_REFUSED (the provider declined; nothing to show). `onReasoning` sees
 * the model's reasoning deltas as they arrive (a route that streams its
 * thinking but needs the whole answer before it can respond).
 */
export async function aiComplete(
  input: AiCallInput,
  options: { onReasoning?: (text: string) => void | Promise<void> } = {},
): Promise<AiResult> {
  const stream = await aiStream(input);
  for await (const delta of stream.deltas) {
    // The result collects everything else.
    if (delta.type === "reasoning") await options.onReasoning?.(delta.text);
  }
  const result = await stream.result;
  if (result.stop === "refusal" && !result.text && !result.toolCalls.length) {
    throw new AiError("AI_REFUSED", "The AI model declined this request");
  }
  return result;
}

/**
 * aiComplete with a JSON answer parsed (pair it with `jsonSchema`). An
 * answer cut off at the token limit never parses into a partial value that
 * a caller could save: its object is unclosed, and the error says why.
 */
export async function aiCompleteJson<T>(
  input: AiCallInput & { jsonSchema: Record<string, unknown> },
  options: { onReasoning?: (text: string) => void | Promise<void> } = {},
): Promise<{ value: T; result: AiResult }> {
  const result = await aiComplete(input, options);
  const value = parseJsonAnswer(result.text);
  if (value === undefined) {
    throw new AiError(
      "AI_PROVIDER_ERROR",
      result.stop === "max_tokens"
        ? "The AI answer was too long and got cut off. Try a shorter text."
        : "The AI model did not answer in the expected format",
    );
  }
  return { value: value as T, result };
}

// --- Embeddings (D1) ---

export type AiEmbedInput = {
  workspaceId: string;
  /** The person searching; null for the background indexer. */
  userId: string | null;
  texts: string[];
  /** The most sensitive text in the batch (decides where it may go). */
  dataTier: DataTier;
  /** Projects whose content is in `texts` (each must have AI on). */
  projectIds?: readonly string[];
  feature?: AiFeature;
  signal?: AbortSignal;
};

export type AiEmbedResult = {
  vectors: number[][];
  model: string;
  dimensions: number;
  usage: TokenUsage;
  costMicros: number;
};

/** Rough token count for the ledger; embeddings endpoints rarely stream usage. */
function estimateEmbeddingTokens(texts: readonly string[]): number {
  return texts.reduce((sum, text) => sum + Math.ceil(text.length / 4), 0);
}

/**
 * Text embeddings through the instance's embeddings endpoint, with the same
 * enablement, routing, budget, redaction and ledger rules as model calls.
 * The background indexer (userId null) is paced by its own batches, so only
 * people's searches count against the request rate limits.
 */
export async function aiEmbed(input: AiEmbedInput): Promise<AiEmbedResult> {
  const instance = getAiInstanceConfig();
  if (!instance.enabled) {
    throw new AiError("AI_DISABLED", "AI is turned off on this server");
  }
  const workspace = await loadWorkspaceAi(input.workspaceId);
  if (!workspace.policy.enabled) {
    throw new AiError("AI_DISABLED", "AI is turned off for this workspace");
  }
  await assertProjectsAllowAi(input.workspaceId, input.projectIds ?? []);
  const destination = await resolveEmbeddingDestination(instance);
  if (!destination) {
    throw new AiError("AI_NOT_CONFIGURED", "No embeddings endpoint is set");
  }
  const route = embeddingRoute({
    destination,
    dataTier: input.dataTier,
    instance,
    workspace: workspace.policy,
  });
  if (!route.ok) throw new AiError(route.code, route.message);
  await assertWithinBudget({
    workspaceId: input.workspaceId,
    userId: input.userId,
    policy: workspace.policy,
  });
  if (input.userId) await consumeRate(input.workspaceId, input.userId);

  const provider = providerFactory(destination);
  if (!provider.embed) {
    throw new AiError(
      "AI_NOT_CONFIGURED",
      "The embeddings endpoint does not offer embeddings",
    );
  }
  const redactor = route.redact ? createRedactor() : null;
  // Placeholders are never restored: vectors carry no text back.
  const texts = input.texts.map((text) =>
    redactor ? redactor.redact(text) : text,
  );
  const timeoutMs = envInt("MARGAYA_AI_TIMEOUT_MS", 10 * 60 * 1000);
  const signal = AbortSignal.any([
    AbortSignal.timeout(Math.min(timeoutMs, 120_000)),
    ...(input.signal ? [input.signal] : []),
  ]);
  const usage: TokenUsage = {
    ...emptyUsage(),
    input: estimateEmbeddingTokens(texts),
  };
  const startedAt = performance.now();
  let status: UsageStatus = "error";
  try {
    const vectors = await provider.embed(texts, signal);
    const dimensions = vectors[0]?.length ?? 0;
    const valid =
      vectors.length === texts.length &&
      dimensions > 0 &&
      vectors.every(
        (vector) =>
          vector.length === dimensions &&
          vector.every((value) => Number.isFinite(value)),
      );
    if (!valid) {
      throw new AiError(
        "AI_PROVIDER_ERROR",
        "The embeddings endpoint returned unexpected vectors",
      );
    }
    status = "ok";
    return {
      vectors,
      model: destination.model,
      dimensions,
      usage,
      costMicros: costMicros(destination.model, usage),
    };
  } catch (error) {
    if (input.signal?.aborted) status = "cancelled";
    if (error instanceof AiError) throw error;
    // Provider errors may carry request details: log the kind only.
    console.error("AI embeddings call failed", {
      provider: destination.provider,
      model: destination.model,
      error: error instanceof Error ? error.name : "unknown",
    });
    throw new AiError(
      "AI_PROVIDER_ERROR",
      signal.aborted
        ? "The embeddings endpoint timed out"
        : "The embeddings endpoint failed",
    );
  } finally {
    try {
      await recordAiUsage({
        workspaceId: input.workspaceId,
        userId: input.userId,
        feature: input.feature ?? "embedding",
        provider: destination.provider,
        model: destination.model,
        tier: "fast",
        dataTier: input.dataTier,
        status,
        usage,
        costMicros: status === "ok" ? costMicros(destination.model, usage) : 0,
        durationMs: performance.now() - startedAt,
      });
    } catch (error) {
      console.error("Couldn't record AI usage", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/** Test hook: forget concurrency slots. */
export function resetAiGatewayState(): void {
  activeStreams.clear();
}
