import type { client } from "@margaya/libs";
import type { InferRequestType } from "hono/client";

// AI content labels (EU AI Act Article 50). The API stores who or what wrote
// a task description, comment or page as `aiProvenance`; the web shows it as
// a label and tells the API when a save carries text the person accepted
// from an AI feature (`aiAssist`).

/** An AI feature name the API accepts in `aiAssist`. */
export type AiAssistFeature = NonNullable<
  InferRequestType<
    (typeof client)["activity"]["comment"]["$post"]
  >["json"]["aiAssist"]
>["feature"];

export type AiAssist = { feature: AiAssistFeature };

/** The API's AiProvenance. */
export type AiProvenance = {
  source: "assist" | "agent";
  feature: string | null;
  model: string | null;
  agentId: string | null;
  agentName: string | null;
  requestedById: string | null;
  generatedAt: string;
  editedById: string | null;
  editedByName: string | null;
  editedAt: string | null;
};

/** Keys of editors whose next save carries accepted AI text. */
export const aiTextKeys = {
  taskDescription: (taskId: string) => `task-description:${taskId}`,
};

// Text accepted from AI, per editor, until the save that carries it
// succeeds. The editors save on a debounce, so the mark is set when the
// text is accepted and read when the save is sent.
const pending = new Map<string, AiAssistFeature>();

/** The editor at `key` now holds text written by `feature`. */
export function markAiText(key: string, feature: AiAssistFeature): void {
  pending.set(key, feature);
}

/** The `aiAssist` for the next save of `key`, if AI text is waiting. */
export function pendingAiAssist(key: string): AiAssist | undefined {
  const feature = pending.get(key);
  return feature ? { feature } : undefined;
}

/** The save carrying the AI text went through (or the text was dropped). */
export function clearAiText(key: string): void {
  pending.delete(key);
}

/** For tests. */
export function resetAiTextMarks(): void {
  pending.clear();
}

/** Static i18n keys for the feature that wrote the text, when known. */
const FEATURE_KEYS: Record<string, string> = {
  ask: "ai:features.ask",
  summarize: "ai:features.summarize",
  editor_assist: "ai:features.editor_assist",
  spec_draft: "ai:features.spec_draft",
  talk_to_build: "ai:features.talk_to_build",
  // Build in chat has no usage-page name of its own.
  build_chat: "ai:features.talk_to_build",
  brief: "ai:features.brief",
  retro: "ai:features.retro",
  agent_run: "ai:features.agent_run",
  capture: "ai:features.capture",
  translate: "ai:features.translate",
  my_brief: "ai:features.my_brief",
  project_update: "ai:features.project_update",
};

export function aiFeatureKey(feature: string | null): string | null {
  return feature ? (FEATURE_KEYS[feature] ?? null) : null;
}

/** The provenance from an API response field that may be absent. */
export function provenanceOf(value: unknown): AiProvenance | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<AiProvenance>;
  if (record.source !== "assist" && record.source !== "agent") return null;
  if (typeof record.generatedAt !== "string") return null;
  return record as AiProvenance;
}
