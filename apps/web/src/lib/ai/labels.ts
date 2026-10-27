// Static i18n keys for AI vocabulary that comes from the API as names.

export const AI_FEATURE_KEYS: Record<string, string> = {
  connection_test: "ai:features.connection_test",
  ask: "ai:features.ask",
  summarize: "ai:features.summarize",
  editor_assist: "ai:features.editor_assist",
  spec_draft: "ai:features.spec_draft",
  duplicate_check: "ai:features.duplicate_check",
  talk_to_build: "ai:features.talk_to_build",
  triage: "ai:features.triage",
  translate: "ai:features.translate",
  brief: "ai:features.brief",
  agent_run: "ai:features.agent_run",
  rule_compiler: "ai:features.rule_compiler",
  capture: "ai:features.capture",
  coding_handoff: "ai:features.coding_handoff",
  estimate: "ai:features.estimate",
  retro: "ai:features.retro",
  my_brief: "ai:features.my_brief",
  embedding: "ai:features.embedding",
};

export const AI_PROVIDER_KEYS = {
  anthropic: "ai:providers.anthropic",
  openai_compatible: "ai:providers.openai_compatible",
  fake: "ai:providers.fake",
} as const;

export type AiProviderId = keyof typeof AI_PROVIDER_KEYS;

export const AI_DESTINATION_KEYS = {
  cloud: "ai:destinations.cloud",
  local: "ai:destinations.local",
} as const;

export const AI_TIER_KEYS = {
  fast: "ai:tiers.fast",
  balanced: "ai:tiers.balanced",
  deep: "ai:tiers.deep",
} as const;

export const AI_TIER_HINT_KEYS = {
  fast: "ai:tiers.fastHint",
  balanced: "ai:tiers.balancedHint",
  deep: "ai:tiers.deepHint",
} as const;

export const AI_ROUTE_KEYS = {
  blocked: "ai:instance.routeBlocked",
  local: "ai:instance.routeLocal",
  cloud: "ai:instance.routeCloud",
} as const;
