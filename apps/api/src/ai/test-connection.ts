import { createRateLimiter } from "../utils/rate-limit";
import { AiError, isAiError } from "./errors";
import { providerFor } from "./gateway";
import { type AiInstanceConfig, hasLocalEndpoint } from "./instance-config";
import { costMicros } from "./pricing";
import { type AiDestination, routeAiCall } from "./router";
import { emptyUsage, type TokenUsage } from "./types";
import { recordAiUsage } from "./usage";
import type { WorkspaceAiPolicy } from "./workspace-settings";

// "Test connection": one tiny call that proves the key, endpoint and model
// work. It goes through the router like any call (with public data), so it
// also shows where the workspace's calls would go. Failures answer 200 with
// ok false and a curated message; provider text is never returned.

export const aiTestLimiter = createRateLimiter({
  name: "ai-test-connection",
  windowSeconds: 60,
  max: 10,
});

export type AiTestResult = {
  ok: boolean;
  code: string | null;
  message: string | null;
  provider: string | null;
  model: string | null;
  destination: "cloud" | "local" | null;
  latencyMs: number | null;
};

function failure(error: unknown, destination?: AiDestination): AiTestResult {
  const known = isAiError(error)
    ? error
    : new AiError("AI_PROVIDER_ERROR", "The AI provider failed");
  return {
    ok: false,
    code: known.code,
    message: known.message,
    provider: destination?.provider ?? null,
    model: destination?.model ?? null,
    destination: destination?.kind ?? null,
    latencyMs: null,
  };
}

/** Pick the destination: the routed one, or the local endpoint on request. */
function destinationFor(input: {
  instance: AiInstanceConfig;
  workspace: WorkspaceAiPolicy;
  workspaceApiKey: string | null;
  target?: "cloud" | "local";
}): AiDestination {
  if (input.target === "local") {
    if (!hasLocalEndpoint(input.instance)) {
      throw new AiError("AI_NOT_CONFIGURED", "No local model is set up");
    }
    return {
      kind: "local",
      provider: "openai_compatible",
      model: input.instance.local.model,
      apiKey: input.instance.local.apiKey,
      baseUrl: input.instance.local.baseUrl,
      allowPrivate: true,
      workspaceKey: false,
    };
  }
  const route = routeAiCall({
    instance:
      input.target === "cloud"
        ? { ...input.instance, localOnly: false }
        : input.instance,
    workspace:
      input.target === "cloud"
        ? { ...input.workspace, localOnly: false }
        : input.workspace,
    workspaceApiKey: input.workspaceApiKey,
    dataTier: "public",
    tier: "fast",
  });
  if (!route.ok) throw new AiError(route.code, route.message);
  return route.destination;
}

export async function testAiConnection(input: {
  instance: AiInstanceConfig;
  workspace: WorkspaceAiPolicy;
  workspaceApiKey: string | null;
  target?: "cloud" | "local";
  /** Record the call in this workspace's ledger. */
  ledger?: { workspaceId: string; userId: string };
}): Promise<AiTestResult> {
  let destination: AiDestination;
  try {
    destination = destinationFor(input);
  } catch (error) {
    return failure(error);
  }
  const provider = providerFor(destination);
  const startedAt = performance.now();
  let usage: TokenUsage = emptyUsage();
  let model = destination.model;
  let result: AiTestResult;
  try {
    let text = "";
    for await (const delta of provider.stream(
      {
        model: destination.model,
        system: ["Reply with the single word OK."],
        messages: [{ role: "user", content: "Connection test. Reply OK." }],
        maxTokens: 64,
        effort: "low",
      },
      AbortSignal.timeout(30_000),
    )) {
      if (delta.type === "text") text += delta.text;
      if (delta.type === "usage") {
        usage = delta.usage;
        model = delta.model ?? model;
      }
    }
    result = {
      ok: true,
      code: null,
      message: text.trim().slice(0, 40) || null,
      provider: destination.provider,
      model,
      destination: destination.kind,
      latencyMs: Math.round(performance.now() - startedAt),
    };
  } catch (error) {
    result = failure(error, destination);
  }
  if (input.ledger) {
    await recordAiUsage({
      workspaceId: input.ledger.workspaceId,
      userId: input.ledger.userId,
      feature: "connection_test",
      provider: destination.provider,
      model,
      tier: "fast",
      dataTier: "public",
      status: result.ok ? "ok" : "error",
      usage,
      costMicros: costMicros(model, usage),
      durationMs: performance.now() - startedAt,
    }).catch(() => {});
  }
  return result;
}
