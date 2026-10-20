import {
  type AiInstanceConfig,
  hasLocalEndpoint,
  modelForTier,
} from "./instance-config";
import type { DataTier, ModelTier, ProviderId } from "./types";
import type { WorkspaceAiPolicy } from "./workspace-settings";

// The Model Router (B4): pure rules deciding where a call may go.
//
// Data tiers come from the entities in context: anything from a restricted
// project makes the call `restricted`, other workspace data `private`, and
// only published content or no workspace data `public`. The instance sets a
// destination per tier (restricted: blocked, local or cloud; private: local
// or cloud); local-only mode (instance or workspace) sends everything to the
// local endpoint. A workspace can only tighten what the instance allows.

export type AiDestination = {
  /** "local": the operator's own endpoint; "cloud": the configured provider. */
  kind: "local" | "cloud";
  provider: ProviderId;
  model: string;
  apiKey: string;
  /** OpenAI-compatible base URL (empty for Anthropic and fake). */
  baseUrl: string;
  /** Private addresses allowed (the local endpoint only). */
  allowPrivate: boolean;
  /** The key belongs to the workspace, not the instance. */
  workspaceKey: boolean;
};

export type RouteDecision =
  | { ok: true; destination: AiDestination; redact: boolean }
  | {
      ok: false;
      code: "AI_ROUTE_BLOCKED" | "AI_NOT_CONFIGURED";
      message: string;
    };

const SEVERITY: Record<DataTier, number> = {
  public: 0,
  private: 1,
  restricted: 2,
};

/** The most sensitive tier among the context's items (default private). */
export function dataTierOf(
  tiers: readonly DataTier[],
  declared?: DataTier,
): DataTier {
  let result: DataTier = declared ?? (tiers.length ? "public" : "private");
  for (const tier of tiers) {
    if (SEVERITY[tier] > SEVERITY[result]) result = tier;
  }
  return result;
}

/** Where data of this tier may go under the instance and workspace policy. */
export function allowedTarget(
  dataTier: DataTier,
  instance: AiInstanceConfig,
  workspace: Pick<WorkspaceAiPolicy, "localOnly">,
): "local" | "cloud" | "blocked" {
  if (dataTier === "restricted" && instance.route.restricted === "blocked") {
    return "blocked";
  }
  if (instance.localOnly || workspace.localOnly) return "local";
  if (dataTier === "restricted") {
    return instance.route.restricted === "cloud" ? "cloud" : "local";
  }
  if (dataTier === "private") return instance.route.private;
  return "cloud";
}

const NO_MODELS: Record<ModelTier, string> = {
  fast: "",
  balanced: "",
  deep: "",
};

function cloudDestination(
  instance: AiInstanceConfig,
  workspaceKey: { provider: ProviderId; apiKey: string } | null,
  tier: ModelTier,
): AiDestination | { code: "AI_NOT_CONFIGURED"; message: string } {
  const provider = workspaceKey?.provider ?? instance.provider;
  // A workspace key for another provider than the instance's uses that
  // provider's default models, since the instance's names belong to its own.
  const models = provider === instance.provider ? instance.models : NO_MODELS;
  const model = modelForTier(provider, models, tier);
  const base = {
    kind: "cloud" as const,
    provider,
    model,
    allowPrivate: false,
    workspaceKey: Boolean(workspaceKey),
  };
  if (provider === "fake") {
    return { ...base, apiKey: "", baseUrl: "" };
  }
  if (provider === "anthropic") {
    const apiKey = workspaceKey?.apiKey || instance.anthropicApiKey;
    if (!apiKey) {
      return {
        code: "AI_NOT_CONFIGURED",
        message: "No Anthropic API key is set",
      };
    }
    return { ...base, apiKey, baseUrl: "" };
  }
  if (!instance.openai.baseUrl) {
    return {
      code: "AI_NOT_CONFIGURED",
      message: "No OpenAI-compatible base URL is set",
    };
  }
  if (!model) {
    return { code: "AI_NOT_CONFIGURED", message: "No model is set" };
  }
  return {
    ...base,
    apiKey: workspaceKey?.apiKey || instance.openai.apiKey,
    baseUrl: instance.openai.baseUrl,
  };
}

export function routeAiCall(input: {
  instance: AiInstanceConfig;
  workspace: WorkspaceAiPolicy;
  /** The workspace's opened own key, if any. */
  workspaceApiKey: string | null;
  dataTier: DataTier;
  tier: ModelTier;
}): RouteDecision {
  const { instance, workspace, dataTier, tier } = input;
  const target = allowedTarget(dataTier, instance, workspace);

  if (target === "blocked") {
    return {
      ok: false,
      code: "AI_ROUTE_BLOCKED",
      message: "Data from restricted projects may not be sent to AI models",
    };
  }

  if (target === "local") {
    if (!hasLocalEndpoint(instance)) {
      return instance.localOnly || workspace.localOnly
        ? {
            ok: false,
            code: "AI_NOT_CONFIGURED",
            message: "Local-only mode is on, but no local model is set up",
          }
        : {
            ok: false,
            code: "AI_ROUTE_BLOCKED",
            message:
              "This data may only go to a local model, and none is set up",
          };
    }
    return {
      ok: true,
      redact: false,
      destination: {
        kind: "local",
        provider: "openai_compatible",
        model: instance.local.model,
        apiKey: instance.local.apiKey,
        baseUrl: instance.local.baseUrl,
        allowPrivate: true,
        workspaceKey: false,
      },
    };
  }

  const workspaceKey =
    instance.allowWorkspaceKeys && input.workspaceApiKey && workspace.provider
      ? { provider: workspace.provider, apiKey: input.workspaceApiKey }
      : null;
  const destination = cloudDestination(instance, workspaceKey, tier);
  if ("code" in destination) return { ok: false, ...destination };
  return {
    ok: true,
    destination,
    redact: instance.redaction || workspace.redactPii,
  };
}
