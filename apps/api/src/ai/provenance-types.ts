// The stored AI provenance of a piece of content (a task description, a
// comment, a page). Kept in its own module so database/schema.ts can import
// the type without pulling in the gateway.

export type AiProvenance = {
  /** "assist": a person accepted AI-written text; "agent": an agent wrote it. */
  source: "assist" | "agent";
  /** The AI feature that wrote it (ai_usage.feature), when known. */
  feature: string | null;
  /** The model that wrote it, from the usage ledger, when known. */
  model: string | null;
  agentId: string | null;
  agentName: string | null;
  /** Who accepted the text, or whom the agent acted for. */
  requestedById: string | null;
  generatedAt: string;
  /** The last person who changed the text since, if anyone. */
  editedById: string | null;
  editedByName: string | null;
  editedAt: string | null;
};
