import type { Env } from "../instance-settings/catalog";
import type { InstanceSettingsSnapshot } from "../instance-settings/resolve";
import { getInstanceSettings } from "../instance-settings/snapshot";
import type { ModelTier, ProviderId } from "./types";

// The instance's AI settings (catalog group "ai") as one typed object. The
// environment locks values exactly as for other instance settings.

export type RestrictedRoute = "blocked" | "local" | "cloud";
export type PrivateRoute = "local" | "cloud";

export type AiInstanceConfig = {
  enabled: boolean;
  /** The configured cloud provider ("fake" only where allowed). */
  provider: ProviderId;
  /** The fake provider may be selected on this server. */
  fakeAllowed: boolean;
  anthropicApiKey: string;
  openai: { baseUrl: string; apiKey: string };
  /** Configured model names per tier; empty uses the provider default. */
  models: Record<ModelTier, string>;
  /** The operator's own OpenAI-compatible endpoint, if any. */
  local: { baseUrl: string; model: string; apiKey: string };
  /** Every call goes to the local endpoint. */
  localOnly: boolean;
  route: { restricted: RestrictedRoute; private: PrivateRoute };
  redaction: boolean;
  /** Recorded: the provider agreement includes zero data retention. */
  zeroRetention: boolean;
  /**
   * Keep agent request text and model output in the run log (off: counts
   * and metadata only). Workspace Ask history has its own opt-in.
   */
  storePrompts: boolean;
  allowWorkspaceKeys: boolean;
  embeddings: { baseUrl: string; model: string; apiKey: string };
  /** Send reasoning text to the asker (the duration is always sent). */
  showReasoning: boolean;
  /** Let local reasoning models think ("on") or ask them not to ("off"). */
  localThinking: "off" | "on";
  webSearch: {
    provider: WebSearchProvider;
    /** SearXNG base URL. */
    url: string;
    /** Brave or Tavily key. */
    apiKey: string;
  };
  /** OpenAI-compatible speech-to-text endpoint. */
  speech: {
    format: "openai" | "fish";
    baseUrl: string;
    model: string;
    apiKey: string;
  };
};

export type WebSearchProvider = "off" | "searxng" | "brave" | "tavily";

/** Default Claude models per tier. */
export const ANTHROPIC_DEFAULT_MODELS: Record<ModelTier, string> = {
  fast: "claude-haiku-5-5",
  balanced: "claude-sonnet-5-5",
  deep: "claude-opus-5-5",
};

/**
 * The fake provider answers deterministically without a network call. It
 * exists for development and tests, so production servers refuse it unless
 * MARGAYA_AI_ALLOW_FAKE=true.
 */
export function fakeProviderAllowed(env: Env = process.env): boolean {
  return env.NODE_ENV !== "production" || env.MARGAYA_AI_ALLOW_FAKE === "true";
}

function str(snapshot: InstanceSettingsSnapshot, key: string): string {
  const value = snapshot.settings[key]?.value;
  return typeof value === "string" ? value.trim() : "";
}

function flag(snapshot: InstanceSettingsSnapshot, key: string): boolean {
  return snapshot.settings[key]?.value === true;
}

export function aiInstanceConfigOf(
  snapshot: InstanceSettingsSnapshot,
  env: Env = process.env,
): AiInstanceConfig {
  const fakeAllowed = fakeProviderAllowed(env);
  const configured = str(snapshot, "ai.provider");
  const provider: ProviderId =
    configured === "openai_compatible"
      ? "openai_compatible"
      : configured === "fake" && fakeAllowed
        ? "fake"
        : "anthropic";
  const restricted = str(snapshot, "ai.route.restricted");
  return {
    enabled: flag(snapshot, "ai.enabled"),
    provider,
    fakeAllowed,
    anthropicApiKey: str(snapshot, "ai.anthropic.apiKey"),
    openai: {
      baseUrl: str(snapshot, "ai.openai.baseUrl"),
      apiKey: str(snapshot, "ai.openai.apiKey"),
    },
    models: {
      fast: str(snapshot, "ai.models.fast"),
      balanced: str(snapshot, "ai.models.balanced"),
      deep: str(snapshot, "ai.models.deep"),
    },
    local: {
      baseUrl: str(snapshot, "ai.local.baseUrl"),
      model: str(snapshot, "ai.local.model"),
      apiKey: str(snapshot, "ai.local.apiKey"),
    },
    localOnly: flag(snapshot, "ai.localOnly"),
    route: {
      restricted:
        restricted === "blocked" || restricted === "cloud"
          ? restricted
          : "local",
      private:
        str(snapshot, "ai.route.private") === "local" ? "local" : "cloud",
    },
    redaction: flag(snapshot, "ai.redaction.enabled"),
    zeroRetention: flag(snapshot, "ai.zeroRetention"),
    storePrompts: flag(snapshot, "ai.retention.storePrompts"),
    allowWorkspaceKeys: flag(snapshot, "ai.allowWorkspaceKeys"),
    embeddings: {
      baseUrl: str(snapshot, "ai.embeddings.baseUrl"),
      model: str(snapshot, "ai.embeddings.model"),
      apiKey: str(snapshot, "ai.embeddings.apiKey"),
    },
    showReasoning: flag(snapshot, "ai.showReasoning"),
    localThinking: str(snapshot, "ai.local.thinking") === "on" ? "on" : "off",
    webSearch: {
      provider: webSearchProviderOf(str(snapshot, "ai.webSearch.provider")),
      url: str(snapshot, "ai.webSearch.url"),
      apiKey: str(snapshot, "ai.webSearch.apiKey"),
    },
    speech: {
      format: str(snapshot, "ai.speech.format") === "fish" ? "fish" : "openai",
      baseUrl: str(snapshot, "ai.speech.baseUrl"),
      model: str(snapshot, "ai.speech.model"),
      apiKey: str(snapshot, "ai.speech.apiKey"),
    },
  };
}

function webSearchProviderOf(value: string): WebSearchProvider {
  return value === "searxng" || value === "brave" || value === "tavily"
    ? value
    : "off";
}

/** Whether web search has a provider with what it needs (URL or key). */
export function webSearchConfigured(config: AiInstanceConfig): boolean {
  const { provider, url, apiKey } = config.webSearch;
  if (provider === "searxng") return Boolean(url);
  if (provider === "brave" || provider === "tavily") return Boolean(apiKey);
  return false;
}

/** Whether server speech-to-text is set up. */
export function speechConfigured(config: AiInstanceConfig): boolean {
  // Fish Audio's ASR takes no model.
  return Boolean(
    config.speech.baseUrl &&
      (config.speech.format === "fish" || config.speech.model),
  );
}

/** The instance AI settings in effect now. */
export function getAiInstanceConfig(): AiInstanceConfig {
  return aiInstanceConfigOf(getInstanceSettings());
}

/**
 * The model for a tier: the configured name, else another configured tier
 * (a local server often has one model), else the provider default.
 */
export function modelForTier(
  provider: ProviderId,
  models: Record<ModelTier, string>,
  tier: ModelTier,
): string {
  const configured =
    models[tier] || models.balanced || models.fast || models.deep || "";
  if (models[tier]) return models[tier];
  if (provider === "anthropic") return ANTHROPIC_DEFAULT_MODELS[tier];
  if (provider === "fake") return `fake-${tier}`;
  return configured;
}

/** Whether the local endpoint is set up. */
export function hasLocalEndpoint(config: AiInstanceConfig): boolean {
  return Boolean(config.local.baseUrl && config.local.model);
}
