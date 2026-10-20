import { and, eq, isNull } from "drizzle-orm";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import {
  type AiContextItem,
  assertProjectInScope,
  projectDataTier,
  resolveAiScope,
} from "../ai/context";
import { aiStream } from "../ai/gateway";
import { buildSystemPrompt, wrapUntrusted } from "../ai/prompt";
import { respondWithAi, wantsAiStream } from "../ai/sse";
import { userLocale } from "../ai-translate/locale";
import db from "../database";
import { aiBriefTable, pageTable } from "../database/schema";
import { assertProjectFeatureEnabled } from "../project/features";
import {
  type BriefFacts,
  type BriefTaskRef,
  citableTasks,
  computeBriefFacts,
  resolveBriefScope,
} from "./facts";
import type { BriefAudience, BriefScopeType } from "./types";

// Stakeholder briefs (B8): a status brief for a cycle, module or project,
// written by the model ONLY from facts computed in facts.ts, with every
// task cited by key. Each generation keeps its facts (not its text) so the
// next brief can say what changed since the last one that was shared.

export const BRIEF_INSTRUCTIONS = `You write a short status brief about one cycle, module or project for a stated audience.
Rules:
- Use ONLY the facts given. Never calculate, estimate or round numbers or dates yourself: copy them exactly as given. Leave out anything the facts don't cover.
- Cite every task you mention with its key in square brackets, such as [WEB-12]. Mention only tasks listed in the facts.
- Write Markdown: a short summary paragraph, then the sections "Progress", "Changes since the last brief" (only when a previous brief is given), "Risks", "Forecast" and "Next steps", each with a few short bullets. Translate the section names into the answer language.
- When a forecast is missing or has too little history, say so plainly instead of guessing.
- Audience "team": concrete and practical. Audience "leadership": outcomes, risks and dates first; at most the three most important tasks per section. Audience "client": customer-safe; outcomes only, no internal process, no blame and no names of people.`;

const AUDIENCE_NOTES: Record<BriefAudience, string> = {
  team: "Audience: team.",
  leadership: "Audience: leadership.",
  client: "Audience: client (customer-safe).",
};

function taskLines(tasks: readonly BriefTaskRef[], total: number): string {
  const lines = tasks.map((task) => `[${task.key}] ${task.title}`);
  if (total > tasks.length) lines.push(`(and ${total - tasks.length} more)`);
  return lines.join("\n") || "(none)";
}

/** Numbers come from code; task titles are workspace text (untrusted). */
export function briefPrompt(
  facts: BriefFacts,
  audience: BriefAudience,
): string {
  const scopeLabel = `${facts.scope.type} "${facts.scope.name}"`;
  const dates = [
    facts.scope.startDate ? `starts ${facts.scope.startDate}` : null,
    facts.scope.endDate ? `ends ${facts.scope.endDate}` : null,
  ]
    .filter(Boolean)
    .join(", ");
  const c = facts.counts;
  const numbers = [
    AUDIENCE_NOTES[audience],
    `Scope: ${scopeLabel}${dates ? ` (${dates})` : ""}.`,
    `Facts as of ${facts.generatedAt.slice(0, 10)}; changes counted since ${facts.since.slice(0, 10)}${facts.previous ? " (the previous brief)" : " (no previous brief: the last 7 days)"}.`,
    `Tasks: ${c.total} in total; ${c.completed} completed, ${c.started} in progress, ${c.unstarted} not started, ${c.backlog} in backlog, ${c.cancelled} cancelled. Progress: ${facts.percent}% complete.${facts.truncated ? " (Only the first tasks were counted.)" : ""}`,
    `Completed since then: ${facts.completed.total}. Added since then: ${facts.added.total}. Removed since then: ${facts.removed.total}.`,
  ];
  if (facts.previous) {
    numbers.push(
      `Previous brief (${facts.previous.sharedAt.slice(0, 10)}): progress ${facts.previous.percent}%, forecast P85 ${facts.previous.forecastP85 ?? "none"}.`,
    );
  }
  const f = facts.forecast;
  numbers.push(
    !f
      ? "Forecast: unavailable."
      : f.status === "ok"
        ? `Forecast (Monte Carlo on past throughput): ${f.remaining} open tasks; 50% likely done by ${f.p50 ?? "beyond the horizon"}, 85% by ${f.p85 ?? "beyond the horizon"}, 95% by ${f.p95 ?? "beyond the horizon"}${f.probabilityByEnd === null ? "" : `; ${f.probabilityByEnd}% chance to finish by the end date`}.`
        : f.status === "complete"
          ? "Forecast: no open tasks remain."
          : "Forecast: not enough completed work yet to forecast.",
  );
  const riskText =
    facts.risks.length === 0
      ? "(none)"
      : facts.risks
          .map(
            (risk) =>
              `${risk.kind} (${risk.severity}, ${risk.total} task(s)): ${risk.tasks.map((task) => `[${task.key}] ${task.title}`).join("; ") || "-"}`,
          )
          .join("\n");
  const block = (source: string, text: string) =>
    wrapUntrusted({ source, text, maxChars: 8000 });
  return [
    numbers.join("\n"),
    "Completed since then:",
    block("completed", taskLines(facts.completed.tasks, facts.completed.total)),
    "Added since then:",
    block("added", taskLines(facts.added.tasks, facts.added.total)),
    "Removed since then:",
    block("removed", taskLines(facts.removed.tasks, facts.removed.total)),
    "In progress:",
    block(
      "in-progress",
      taskLines(facts.inProgress.tasks, facts.inProgress.total),
    ),
    "Risks (computed):",
    block("risks", riskText),
    "Write the brief.",
  ].join("\n\n");
}

/** What the answer may cite, for the web to link [KEY] markers. */
function citations(facts: BriefFacts, workspaceId: string) {
  return citableTasks(facts).map((task) => ({
    key: task.key,
    taskId: task.id,
    title: task.title,
    url: `/dashboard/workspace/${workspaceId}/project/${task.projectId}/task/${task.id}`,
  }));
}

/** POST /ai/brief */
export async function generateBrief(
  c: Context,
  input: {
    scopeType: BriefScopeType;
    scopeId: string;
    audience: BriefAudience;
    locale?: string;
  },
) {
  const workspaceId = c.get("workspaceId") as string;
  const userId = c.get("userId") as string;
  const scope = await resolveBriefScope(
    workspaceId,
    input.scopeType,
    input.scopeId,
  );
  const aiScope = await resolveAiScope(c);
  // 404 for a project the caller can't see; AI_DISABLED for AI-off ones.
  assertProjectInScope(aiScope, scope.projectId);
  if (!aiScope.can.readTasks) {
    throw new HTTPException(403, { message: "Insufficient permissions" });
  }
  if (scope.type !== "project") {
    await assertProjectFeatureEnabled(
      scope.projectId,
      scope.type === "cycle" ? "cycles" : "modules",
    );
  }
  if (input.audience === "client" && scope.restricted) {
    throw new HTTPException(403, {
      message: "Client briefs can't be made for restricted projects",
    });
  }

  const { facts, snapshot } = await computeBriefFacts(scope, userId);
  // One unshared draft per person and scope: a new one replaces it.
  await db
    .delete(aiBriefTable)
    .where(
      and(
        eq(aiBriefTable.scopeType, scope.type),
        eq(aiBriefTable.scopeId, scope.id),
        eq(aiBriefTable.createdBy, userId),
        isNull(aiBriefTable.sharedAt),
      ),
    );
  const [brief] = await db
    .insert(aiBriefTable)
    .values({
      workspaceId,
      projectId: scope.projectId,
      scopeType: scope.type,
      scopeId: scope.id,
      audience: input.audience,
      facts: snapshot,
      createdBy: userId,
    })
    .returning({ id: aiBriefTable.id });
  if (!brief)
    throw new HTTPException(500, { message: "Couldn't save the brief" });

  const context: AiContextItem[] = [
    {
      kind: "project",
      id: scope.projectId,
      projectId: scope.projectId,
      title: scope.name,
      url: "",
      source: `${scope.type}:${scope.name}`,
      author: null,
      text: "",
      dataTier: projectDataTier(aiScope, scope.projectId),
    },
  ];
  const locale = input.locale ?? (await userLocale(userId));
  const stream = await aiStream({
    workspaceId,
    userId,
    feature: "brief",
    tier: "balanced",
    context,
    system: buildSystemPrompt({ instructions: BRIEF_INSTRUCTIONS, locale }),
    messages: [{ role: "user", content: briefPrompt(facts, input.audience) }],
    maxTokens: 4000,
    effort: "low",
  });
  const extra = {
    briefId: brief.id,
    facts,
    citations: citations(facts, workspaceId),
  };
  // Streams carry the facts in `meta` (shown while the text arrives); the
  // JSON fallback has them at the top level.
  return wantsAiStream(c)
    ? respondWithAi(c, stream, { extra })
    : respondWithAi(c, stream, { finalize: () => extra });
}

/** POST /ai/brief/{id}/share: the next brief diffs against this one. */
export async function shareBrief(
  briefId: string,
  userId: string,
  pageId: string | null,
) {
  const [brief] = await db
    .select({
      id: aiBriefTable.id,
      projectId: aiBriefTable.projectId,
      createdBy: aiBriefTable.createdBy,
      sharedAt: aiBriefTable.sharedAt,
    })
    .from(aiBriefTable)
    .where(eq(aiBriefTable.id, briefId))
    .limit(1);
  if (!brief || brief.createdBy !== userId) {
    throw new HTTPException(404, { message: "Brief not found" });
  }
  if (pageId) {
    const [page] = await db
      .select({ projectId: pageTable.projectId })
      .from(pageTable)
      .where(eq(pageTable.id, pageId))
      .limit(1);
    if (!page || page.projectId !== brief.projectId) {
      throw new HTTPException(400, {
        message: "The page must belong to the brief's project",
      });
    }
  }
  const sharedAt = brief.sharedAt ?? new Date();
  await db
    .update(aiBriefTable)
    .set({ sharedAt, ...(pageId ? { pageId } : {}) })
    .where(eq(aiBriefTable.id, briefId));
  return { id: briefId, sharedAt: sharedAt.toISOString(), pageId };
}
