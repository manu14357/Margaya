// Every AI feature name the ledger (ai_usage.feature) knows. Usage pages
// group by it and the web translates it with `ai:features.<name>`. A new AI
// feature adds its name here (and that translation) before its first call.

export const AI_FEATURES = [
  // Settings: "Test connection" (instance and workspace).
  "connection_test",
  // B5: "Ask" over workspace knowledge.
  "ask",
  // B6: summaries, editor block actions, drafts, duplicate check, build.
  "summarize",
  "editor_assist",
  "spec_draft",
  "duplicate_check",
  "talk_to_build",
  // Build mode in chat: actions proposed from a request.
  "build_chat",
  // B7, B8: triage, translate-on-read, stakeholder briefs.
  "triage",
  "translate",
  "brief",
  // Draft with AI on a project status update.
  "project_update",
  // C: agents and the rule compiler.
  "agent_run",
  "rule_compiler",
  "capture",
  // C4: the brief of a coding-agent handoff.
  "coding_handoff",
  // D: estimates, retrospectives, personal brief.
  "estimate",
  "retro",
  "my_brief",
  // Natural-language task filters and the inbox digest.
  "nl_filter",
  "inbox_digest",
  // Embeddings for retrieval.
  "embedding",
  // Server speech-to-text for the chat composer.
  "speech",
] as const;

export type AiFeature = (typeof AI_FEATURES)[number];

export function isAiFeature(value: string): value is AiFeature {
  return (AI_FEATURES as readonly string[]).includes(value);
}
