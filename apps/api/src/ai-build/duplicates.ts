import { eq, inArray } from "drizzle-orm";
import type { Context } from "hono";
import {
  type AiContextItem,
  filterToScope,
  projectDataTier,
  renderContext,
  resolveAiScopeFor,
} from "../ai/context";
import { aiCompleteJson } from "../ai/gateway";
import { buildSystemPrompt, truncateText, wrapUntrusted } from "../ai/prompt";
import { semanticSimilarTasks } from "../ai-memory/semantic-search";
import db from "../database";
import { taskTable, userTable } from "../database/schema";
import { findSimilarTasks } from "../task/similar-tasks";
import { workspacePermissionChecker } from "../utils/require-workspace-permission";

// Duplicate check on create, AI layer: the full-text candidates (the same
// ones the non-AI hint shows) are re-ranked by a fast model, which keeps
// likely duplicates and related work with a short reason. With no
// candidates there is no model call at all.

const DUPLICATE_INSTRUCTIONS = `Your job: decide whether a task someone is about to create duplicates existing tasks.
You get the draft and a few candidate tasks found by text search. For each candidate, judge:
- "duplicate": very likely the same piece of work, even if worded differently;
- "related": overlapping or closely connected work, but not the same;
- "different": not meaningfully related.
Give each a reason of at most 12 words that names what is the same or different (for example "same login bug, different wording"). Use each candidate's key exactly as given.`;

const DUPLICATE_JSON_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: ["matches"],
  properties: {
    matches: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "verdict", "reason"],
        properties: {
          key: { type: "string" },
          verdict: {
            type: "string",
            enum: ["duplicate", "related", "different"],
          },
          reason: { type: "string" },
        },
      },
    },
  },
};

const CANDIDATES = 8;
/** Room for semantic neighbours the full-text candidates missed. */
const SEMANTIC_EXTRA = 4;

type Verdict = "duplicate" | "related";

/** Keeps the model's duplicate and related verdicts for known candidates. */
export function rankDuplicateVerdicts<T extends { key: string }>(
  candidates: readonly T[],
  raw: unknown,
): (T & { verdict: Verdict; reason: string })[] {
  const matches =
    raw && typeof raw === "object" && Array.isArray((raw as Raw).matches)
      ? ((raw as Raw).matches as unknown[])
      : [];
  const byKey = new Map(
    candidates.map((candidate) => [candidate.key.toUpperCase(), candidate]),
  );
  const seen = new Set<string>();
  const out: (T & { verdict: Verdict; reason: string })[] = [];
  for (const match of matches) {
    if (!match || typeof match !== "object") continue;
    const { key, verdict, reason } = match as Raw;
    if (typeof key !== "string") continue;
    const candidate = byKey.get(key.trim().toUpperCase());
    if (!candidate || seen.has(candidate.key)) continue;
    if (verdict !== "duplicate" && verdict !== "related") continue;
    seen.add(candidate.key);
    out.push({
      ...candidate,
      verdict,
      reason: typeof reason === "string" ? reason.trim().slice(0, 200) : "",
    });
  }
  // Duplicates first; within a verdict, the model's order.
  return out.sort(
    (a, b) =>
      Number(b.verdict === "duplicate") - Number(a.verdict === "duplicate"),
  );
}

type Raw = Record<string, unknown>;

export async function checkDuplicates(
  c: Context,
  input: { projectId: string; title: string; description?: string },
) {
  const workspaceId = c.get("workspaceId") as string;
  const userId = c.get("userId") as string;
  const can = await workspacePermissionChecker(c);
  const [{ tasks: lexical }, semantic] = await Promise.all([
    findSimilarTasks({
      projectId: input.projectId,
      workspaceId,
      userId,
      text: input.title,
      can,
      limit: CANDIDATES,
    }),
    // Worded differently but alike, when the workspace has semantic search (D1).
    semanticSimilarTasks({
      projectId: input.projectId,
      workspaceId,
      userId,
      text: [input.title, input.description?.trim()]
        .filter(Boolean)
        .join("\n\n"),
      can,
      limit: CANDIDATES,
    }),
  ]);
  const seen = new Set(lexical.map((task) => task.id));
  const candidates = [
    ...lexical,
    ...semantic.filter((task) => !seen.has(task.id)),
  ].slice(0, CANDIDATES + SEMANTIC_EXTRA);
  if (candidates.length === 0) return { tasks: [] };

  const scope = await resolveAiScopeFor({ workspaceId, userId, can });
  const rows = await db
    .select({
      id: taskTable.id,
      projectId: taskTable.projectId,
      description: taskTable.description,
    })
    .from(taskTable)
    .where(
      inArray(
        taskTable.id,
        candidates.map((candidate) => candidate.id),
      ),
    );
  const descriptions = new Map(rows.map((row) => [row.id, row]));
  const items: AiContextItem[] = filterToScope(
    scope,
    candidates.map((candidate) => {
      const row = descriptions.get(candidate.id);
      return {
        kind: "task" as const,
        id: candidate.id,
        projectId: row?.projectId ?? input.projectId,
        title: `${candidate.key} ${candidate.title}`,
        url: `/dashboard/workspace/${workspaceId}/project/${input.projectId}/task/${candidate.id}`,
        source: `task:${candidate.key}`,
        author: null,
        text: [
          `Key: ${candidate.key}`,
          `Title: ${candidate.title}`,
          `Status: ${candidate.status}`,
          row?.description
            ? `Description:\n${truncateText(row.description, 1500)}`
            : null,
        ]
          .filter(Boolean)
          .join("\n"),
        dataTier: projectDataTier(scope, input.projectId),
      };
    }),
  );
  if (items.length === 0) return { tasks: [] };

  const [user] = await db
    .select({ locale: userTable.locale })
    .from(userTable)
    .where(eq(userTable.id, userId))
    .limit(1);
  const draft = wrapUntrusted({
    source: "draft",
    text: [
      `Title: ${input.title}`,
      input.description?.trim()
        ? `Description:\n${truncateText(input.description.trim(), 2000)}`
        : null,
    ]
      .filter(Boolean)
      .join("\n"),
  });

  const { value } = await aiCompleteJson<unknown>({
    workspaceId,
    userId,
    feature: "duplicate_check",
    tier: "fast",
    context: items,
    projectIds: [input.projectId],
    system: buildSystemPrompt({
      instructions: DUPLICATE_INSTRUCTIONS,
      locale: user?.locale ?? null,
    }),
    messages: [
      {
        role: "user",
        content: `The draft task:\n${draft}\n\nCandidates:\n${renderContext(items, { maxChars: 20_000 })}`,
      },
    ],
    jsonSchema: DUPLICATE_JSON_SCHEMA,
    maxTokens: 2048,
  });

  const inScope = new Set(items.map((item) => item.id));
  return {
    tasks: rankDuplicateVerdicts(
      candidates.filter((candidate) => inScope.has(candidate.id)),
      value,
    ).map(({ id, key, title, status, verdict, reason }) => ({
      id,
      key,
      title,
      status,
      verdict,
      reason,
    })),
  };
}
