import { and, desc, eq, gte, type SQL } from "drizzle-orm";
import { currentAgentVia } from "../ai-agent/attribution";
import db from "../database";
import { aiUsageTable, userTable } from "../database/schema";
import { z } from "../openapi";
import { AI_FEATURES } from "./features";
import type { AiProvenance } from "./provenance-types";

export type { AiProvenance } from "./provenance-types";

// AI content labels (EU AI Act Article 50): text that AI wrote keeps a small
// provenance record on the row it was saved to (task.ai_provenance,
// activity.ai_provenance for comments, page.ai_provenance), so people see a
// label and machines read `aiProvenance` in API, webhook, export and MCP
// payloads.
//
// - An agent's write (a request made with a run key) is marked by the server.
// - A person who accepts AI-written text says so with `aiAssist` on the save.
//   It is a disclosure, not a permission, so the claim is taken as given; the
//   model comes from the caller's own recent usage-ledger row, when any.
// - A later change by a person keeps the record and names the editor, so the
//   label reads "Edited by X, originally AI-generated".

/** How far back the ledger is searched for the model of an accepted text. */
const MODEL_LOOKBACK_MS = 24 * 60 * 60 * 1000;

export const aiAssistInput = z
  .object({
    feature: z.enum(AI_FEATURES).openapi({
      description:
        "The AI feature that wrote the text, e.g. editor_assist, spec_draft, summarize, brief or retro.",
    }),
  })
  .strict()
  .optional()
  .openapi("AiAssistInput", {
    description:
      "Set when the saved text was written by AI and accepted by the caller: the content is labelled AI-generated (aiProvenance). Writes made by an agent are labelled without it.",
  });

export type AiAssistInput = z.infer<typeof aiAssistInput>;

export const aiProvenanceSchema = z
  .object({
    source: z.enum(["assist", "agent"]).openapi({
      description:
        "assist: a person accepted text an AI feature wrote. agent: an AI agent wrote it.",
    }),
    feature: z.string().nullable().openapi({
      description: "The AI feature that wrote it, when known.",
    }),
    model: z.string().nullable().openapi({
      description: "The model that wrote it, when known.",
    }),
    agentId: z.string().nullable(),
    agentName: z.string().nullable(),
    requestedById: z.string().nullable().openapi({
      description: "Who accepted the text, or whom the agent acted for.",
    }),
    generatedAt: z.string().openapi({ description: "ISO 8601 timestamp." }),
    editedById: z.string().nullable().openapi({
      description:
        "The last person who changed the text since it was generated, or null when nobody has.",
    }),
    editedByName: z.string().nullable(),
    editedAt: z.string().nullable(),
  })
  .openapi("AiProvenance", {
    description:
      "Machine-readable AI provenance (EU AI Act Article 50): present when AI wrote this content. Null means no AI wrote it.",
  });

/** The response field: nullable, and optional where a read omits it. */
export const aiProvenanceField = z
  .union([aiProvenanceSchema, z.null()])
  .optional()
  .openapi({
    description:
      "Set when AI wrote this content (EU AI Act Article 50 marking); null when a person did.",
  });

async function latestModel(where: SQL[]) {
  const [row] = await db
    .select({ model: aiUsageTable.model })
    .from(aiUsageTable)
    .where(
      and(
        ...where,
        eq(aiUsageTable.status, "ok"),
        gte(aiUsageTable.createdAt, new Date(Date.now() - MODEL_LOOKBACK_MS)),
      ),
    )
    .orderBy(desc(aiUsageTable.createdAt))
    .limit(1);
  return row?.model ?? null;
}

/**
 * The provenance of a write in flight: an agent's (from the run key), a
 * person's accepted AI text (`assist`), or null for a person's own text.
 */
export async function aiWriteProvenance(input: {
  /** Narrows the ledger lookup; optional for callers that lack it. */
  workspaceId?: string;
  userId: string;
  assist?: AiAssistInput;
  now?: Date;
}): Promise<AiProvenance | null> {
  const generatedAt = (input.now ?? new Date()).toISOString();
  const workspaceFilter = input.workspaceId
    ? [eq(aiUsageTable.workspaceId, input.workspaceId)]
    : [];
  const via = currentAgentVia();
  if (via) {
    return {
      source: "agent",
      feature: "agent_run",
      model: await latestModel([
        ...workspaceFilter,
        eq(aiUsageTable.runId, via.runId),
      ]).catch(() => null),
      agentId: via.agentId,
      agentName: via.agentName,
      requestedById: via.onBehalfOf,
      generatedAt,
      editedById: null,
      editedByName: null,
      editedAt: null,
    };
  }
  if (!input.assist) return null;
  return {
    source: "assist",
    feature: input.assist.feature,
    model: await latestModel([
      ...workspaceFilter,
      eq(aiUsageTable.userId, input.userId),
      eq(aiUsageTable.feature, input.assist.feature),
    ]).catch(() => null),
    agentId: null,
    agentName: null,
    requestedById: input.userId,
    generatedAt,
    editedById: null,
    editedByName: null,
    editedAt: null,
  };
}

/** `existing` marked as last changed by a person. */
export function markHumanEdit(
  existing: AiProvenance,
  editor: { id: string; name: string | null },
  now: Date = new Date(),
): AiProvenance {
  return {
    ...existing,
    editedById: editor.id,
    editedByName: editor.name,
    editedAt: now.toISOString(),
  };
}

async function userName(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ name: userTable.name })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1);
  return row?.name ?? null;
}

/**
 * The provenance to store after a save of AI-labellable content:
 * - unchanged text keeps what it had;
 * - text AI wrote now gets a fresh record;
 * - a person's change to AI-written text keeps the record and names them;
 * - anything else stays null.
 *
 * Returns undefined when the stored value should not be touched.
 */
export async function nextAiProvenance(input: {
  existing: AiProvenance | null;
  changed: boolean;
  workspaceId?: string;
  userId: string;
  assist?: AiAssistInput;
  now?: Date;
}): Promise<AiProvenance | null | undefined> {
  if (!input.changed) return undefined;
  const written = await aiWriteProvenance(input);
  if (written) return written;
  if (!input.existing) return undefined;
  return markHumanEdit(
    input.existing,
    { id: input.userId, name: await userName(input.userId) },
    input.now,
  );
}

type AgentViaShape = {
  agentId?: unknown;
  agentName?: unknown;
  onBehalfOf?: unknown;
};

/**
 * A comment's provenance. Agent comments written before the column existed
 * carry only `eventData.via`; they read as agent-written too.
 */
export function commentAiProvenance(row: {
  aiProvenance?: AiProvenance | null;
  eventData?: unknown;
  createdAt: Date;
}): AiProvenance | null {
  if (row.aiProvenance) return row.aiProvenance;
  const via =
    row.eventData && typeof row.eventData === "object"
      ? ((row.eventData as { via?: AgentViaShape }).via ?? null)
      : null;
  if (!via || typeof via.agentId !== "string") return null;
  return {
    source: "agent",
    feature: "agent_run",
    model: null,
    agentId: via.agentId,
    agentName: typeof via.agentName === "string" ? via.agentName : null,
    requestedById: typeof via.onBehalfOf === "string" ? via.onBehalfOf : null,
    generatedAt: row.createdAt.toISOString(),
    editedById: null,
    editedByName: null,
    editedAt: null,
  };
}
