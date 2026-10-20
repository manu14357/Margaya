import type { Context } from "hono";
import {
  assertProjectInScope,
  projectDataTier,
  resolveAiScope,
} from "../ai/context";
import { aiCompleteJson } from "../ai/gateway";
import { buildSystemPrompt, wrapUntrusted } from "../ai/prompt";
import { userLocale } from "../ai-translate/locale";
import {
  type CandidateLabel,
  similarContextItems,
  similarTasks,
  workspaceLabels,
} from "./candidates";

// Live label suggestions while a task is being written (create dialog):
// the draft's title and description, the workspace labels and the labels
// of similar existing tasks. Read-only: the person adds a label with one
// click, through the form. No labels in the workspace means no model call.

export const DRAFT_LABEL_INSTRUCTIONS = `You suggest labels for a task someone is writing in a project tracker.
You get the draft, the workspace's labels by reference (L1, L2, …) and existing tasks that may be similar, with their labels.
Rules:
- Suggest only labels from the list, by their reference exactly. At most 3, best first.
- Suggest a label only when the draft clearly fits it, or similar tasks about the same thing carry it. Otherwise return an empty list.
- Never suggest a label the draft already has.
- Each suggestion has a reason: one plain sentence of at most 15 words a teammate can check, such as "Similar tasks WEB-3 and WEB-9 carry this label".`;

export const DRAFT_LABEL_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["labels"],
  properties: {
    labels: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["ref", "reason"],
        properties: { ref: { type: "string" }, reason: { type: "string" } },
      },
    },
  },
};

const MAX_SUGGESTIONS = 3;

export type DraftLabelSuggestion = {
  labelId: string;
  name: string;
  color: string;
  reason: string | null;
};

/**
 * Pure: the model's references mapped to real labels, without duplicates,
 * labels the draft already has, or anything unknown.
 */
export function resolveDraftLabels(
  raw: unknown,
  labels: ReadonlyMap<string, CandidateLabel>,
  existingIds: ReadonlySet<string>,
): DraftLabelSuggestion[] {
  const list =
    raw && typeof raw === "object" && Array.isArray((raw as Raw).labels)
      ? ((raw as Raw).labels as unknown[])
      : [];
  const seen = new Set<string>();
  const out: DraftLabelSuggestion[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const { ref, reason } = entry as Raw;
    if (typeof ref !== "string") continue;
    const label = labels.get(ref.trim().toUpperCase());
    if (!label || seen.has(label.id) || existingIds.has(label.id)) continue;
    seen.add(label.id);
    const text =
      typeof reason === "string" ? reason.replace(/\s+/g, " ").trim() : "";
    out.push({
      labelId: label.id,
      name: label.name,
      color: label.color,
      reason: text ? text.slice(0, 200) : null,
    });
    if (out.length >= MAX_SUGGESTIONS) break;
  }
  return out;
}

type Raw = Record<string, unknown>;

/** POST /ai/triage/labels */
export async function suggestDraftLabels(
  c: Context,
  input: {
    projectId: string;
    title: string;
    description?: string;
    labelIds?: string[];
    locale?: string;
  },
): Promise<{ labels: DraftLabelSuggestion[] }> {
  const workspaceId = c.get("workspaceId") as string;
  const userId = c.get("userId") as string;
  const scope = await resolveAiScope(c);
  assertProjectInScope(scope, input.projectId);

  const all = await workspaceLabels(workspaceId);
  if (all.length === 0) return { labels: [] };
  const existing = new Set(input.labelIds ?? []);
  const table = new Map(all.map((label, i) => [`L${i + 1}`, label]));
  const description = input.description?.trim().slice(0, 4000) ?? "";
  const similar = (
    await similarTasks(scope, { id: "", title: input.title, description })
  ).slice(0, 8);

  const { value } = await aiCompleteJson<unknown>({
    workspaceId,
    userId,
    feature: "triage",
    tier: "fast",
    context: similarContextItems(scope, similar),
    projectIds: [input.projectId],
    dataTier: projectDataTier(scope, input.projectId),
    system: buildSystemPrompt({
      instructions: DRAFT_LABEL_INSTRUCTIONS,
      locale: input.locale ?? (await userLocale(userId)),
    }),
    messages: [
      {
        role: "user",
        content: [
          "The draft:",
          wrapUntrusted({
            source: "draft",
            text: [
              `Title: ${input.title}`,
              description ? `Description:\n${description}` : null,
            ]
              .filter(Boolean)
              .join("\n"),
          }),
          "Labels the draft already has:",
          wrapUntrusted({
            source: "current-labels",
            text:
              all
                .filter((label) => existing.has(label.id))
                .map((label) => label.name)
                .join(", ") || "(none)",
          }),
          "Workspace labels (reference: name):",
          wrapUntrusted({
            source: "labels",
            text: [...table]
              .map(([ref, label]) => `${ref}: ${label.name}`)
              .join("\n"),
          }),
          "Existing tasks that may be similar (key: title | labels):",
          wrapUntrusted({
            source: "similar-tasks",
            text:
              similar
                .map(
                  (item) =>
                    `${item.key}: ${item.title} | labels: ${item.labelNames.join(", ") || "none"}`,
                )
                .join("\n") || "(none)",
            maxChars: 6000,
          }),
          "Return the suggestions as JSON.",
        ].join("\n\n"),
      },
    ],
    jsonSchema: DRAFT_LABEL_JSON_SCHEMA,
    maxTokens: 800,
    effort: "low",
  });
  return { labels: resolveDraftLabels(value, table, existing) };
}
