import { eq } from "drizzle-orm";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { requireAiEnabled, requireAiUse } from "../ai/access";
import {
  type AiScope,
  assertProjectInScope,
  projectDataTier,
  resolveAiScope,
} from "../ai/context";
import { aiStream } from "../ai/gateway";
import { buildSystemPrompt, wrapUntrusted } from "../ai/prompt";
import {
  aiErrorResponse,
  aiStreamResponse,
  respondWithAi,
  wantsAiStream,
} from "../ai/sse";
import type { DataTier } from "../ai/types";
import { userLocale } from "../ai-translate/locale";
import db from "../database";
import { cycleTable } from "../database/schema";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  z,
} from "../openapi";
import { assertProjectFeatureEnabled } from "../project/features";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import {
  type EstimateSuggestionResult,
  getEstimateSuggestion,
} from "./calibration";
import {
  digestLine,
  INBOX_DIGEST_INSTRUCTIONS,
  loadInboxDigest,
} from "./inbox-digest";
import { computeMyBrief, type MyBrief } from "./my-brief";
import {
  estimateSuggestionSchema,
  insightCitationSchema,
  myBriefSchema,
  retroFactsSchema,
} from "./response";
import { computeRetroFacts, type RetroFacts, retroCitable } from "./retro";
import {
  estimateExplainBody,
  inboxDigestBody,
  myBriefSummaryBody,
  retroNarrativeBody,
} from "./schema";
import type { InsightTaskRef } from "./shared";

// The optional AI half of the planning insights: a short explanation of an
// estimate suggestion (feature "estimate"), a retrospective narrative with
// discussion questions (feature "retro") and a My brief summary (feature
// "my_brief"). The model only retells facts computed in this folder; it
// never computes a number (report 03, §5.4). Task titles are untrusted.

const TAGS = ["AI"];

export const ESTIMATE_INSTRUCTIONS = `You explain an estimate suggestion for one task in two or three short sentences.
Rules:
- Use ONLY the facts given. Never compute, round or invent numbers: copy them exactly.
- Say which value similar tasks usually had and how long they actually took, and mention one or two of the similar tasks by key in square brackets, such as [WEB-12].
- If the similar tasks disagree a lot, say the suggestion is uncertain.
- The person decides; do not tell them what to do. No headings, no lists.`;

export const RETRO_INSTRUCTIONS = `You write the narrative of a team retrospective for one cycle from a computed fact sheet.
Rules:
- Use ONLY the facts given. Never compute, estimate or round numbers or dates yourself: copy them exactly. Leave out anything the facts don't cover.
- Cite every task you mention with its key in square brackets, such as [WEB-12]. Mention only tasks listed in the facts.
- Talk about the team and the work, never about individual people: no blame, no praise of a person, no names.
- Write Markdown with two sections: "Summary" (one short paragraph on what happened, in plain words) and "Discussion questions" (3 to 5 open questions that help the team decide what to change, each tied to a fact). Translate the section names into the answer language.`;

export const MY_BRIEF_INSTRUCTIONS = `You write a person's short daily brief from a computed list of their work.
Rules:
- Use ONLY the facts given. Never compute or invent numbers, dates or tasks.
- At most five short sentences, addressed to the reader as "you": what needs attention first (overdue, due today, blocked), then mentions and notable changes.
- Cite tasks by key in square brackets, such as [WEB-12]. Mention only tasks listed in the facts.
- If nothing needs attention, say so in one sentence. No headings.`;

const taskUrl = (workspaceId: string, task: InsightTaskRef) =>
  `/dashboard/workspace/${workspaceId}/project/${task.projectId}/task/${task.id}`;

function citationsOf(workspaceId: string, tasks: readonly InsightTaskRef[]) {
  const seen = new Set<string>();
  return tasks.flatMap((task) => {
    if (!task.key || seen.has(task.key)) return [];
    seen.add(task.key);
    return [
      {
        key: task.key,
        taskId: task.id,
        title: task.title,
        url: taskUrl(workspaceId, task),
      },
    ];
  });
}

const block = (source: string, text: string) =>
  wrapUntrusted({ source, text: text || "(none)", maxChars: 8000 });

/** Streams with the facts in `meta`; the JSON fallback has them on top. */
function respond(
  c: Context,
  stream: Awaited<ReturnType<typeof aiStream>>,
  extra: Record<string, unknown>,
) {
  return wantsAiStream(c)
    ? respondWithAi(c, stream, { extra })
    : respondWithAi(c, stream, { finalize: () => extra });
}

// --- Estimate explanation ---

export function estimatePrompt(result: EstimateSuggestionResult): string {
  const suggestion = result.suggestion;
  const time = result.cycleTime;
  const facts = [
    `Estimate system: ${result.estimateType ?? "unknown"}.`,
    suggestion
      ? `Suggested value: ${suggestion.value} (${Math.round(suggestion.share * 100)}% of the weight of ${suggestion.matches} similar completed tasks).`
      : "No suggestion.",
    time
      ? `Actual cycle time of the similar tasks: ${time.min} to ${time.max} days, median ${time.median} days (${time.samples} measured).`
      : "Cycle time of the similar tasks: not measured.",
  ];
  const lines = result.similar.map(
    (task) =>
      `[${task.key}] ${task.title} — estimate ${task.value}; cycle time ${task.cycleTimeDays ?? "not measured"} days${task.sharedLabels.length > 0 ? `; shared labels: ${task.sharedLabels.join(", ")}` : ""}`,
  );
  return [
    facts.join("\n"),
    "Similar completed tasks:",
    block("similar-tasks", lines.join("\n")),
    "Explain the suggestion.",
  ].join("\n\n");
}

const estimateRoute = createRoute({
  method: "post",
  operationId: "aiExplainEstimate",
  path: "/estimate",
  tags: TAGS,
  summary: "Explain an estimate suggestion",
  description:
    "A short explanation of the computed estimate suggestion (GET /insight/estimate/project/{projectId}/suggestion), written only from its facts and citing the similar tasks by key. Needs ai:use and task:read on a visible project with AI and estimates on.",
  middleware: [
    workspaceAccess.fromBody(),
    requireAiUse,
    requireAiEnabled(),
    requireWorkspacePermission({ task: ["read"] }),
  ] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: estimateExplainBody } },
    },
  },
  responses: {
    200: aiStreamResponse("The explanation, with the suggestion it explains.", {
      suggestion: estimateSuggestionSchema,
      citations: z.array(insightCitationSchema),
    }),
    403: aiErrorResponse(
      "AI is off (AI_DISABLED), the data may not leave (AI_ROUTE_BLOCKED), estimates are off, or missing permissions",
    ),
    404: errorResponse("Project or task not found"),
    409: errorResponse(
      "Not enough similar tasks to suggest an estimate, or no AI provider is set up",
    ),
    429: aiErrorResponse("AI_BUDGET_EXCEEDED or AI_RATE_LIMITED"),
  },
});

// --- Retrospective narrative ---

const refLines = (tasks: readonly InsightTaskRef[], total: number) => {
  const lines = tasks.map((task) => `[${task.key}] ${task.title}`);
  if (total > tasks.length) lines.push(`(and ${total - tasks.length} more)`);
  return lines.join("\n");
};

export function retroPrompt(facts: RetroFacts): string {
  const c = facts.counts;
  const t = facts.cycleTime;
  const f = facts.forecast;
  const numbers = [
    `Cycle "${facts.cycle.name}" from ${facts.cycle.startDate} to ${facts.cycle.endDate} (${facts.cycle.status === "completed" ? "ended" : "still running; facts so far"}).`,
    `Committed at the start: ${c.committed} tasks; ${c.committedCompleted} of them done (say/do ${facts.sayDoPercent === null ? "not available" : `${facts.sayDoPercent}%`}). Completed in total: ${c.completed}.`,
    `Scope change: ${c.added} added during the cycle, ${c.removed} removed during the cycle.`,
    `Carry-over: ${c.carriedOver} moved to another cycle after the end; ${c.leftOpen} left open in the cycle.`,
    `Reopened after being completed: ${c.reopened}. Tasks with blockers: ${c.blocked}.`,
    facts.points
      ? `Estimate points: ${facts.points.committed} committed, ${facts.points.completed} completed.`
      : "Estimate points: not used.",
    t.samples > 0
      ? `Cycle time: median ${t.medianDays} days over ${t.samples} completed tasks${t.threshold === null ? "" : `; outliers are above ${t.threshold} days (${t.thresholdKind === "project_p85" ? "the project's 85th percentile" : "the cycle's own spread"})`}.`
      : "Cycle time: not measured.",
    f.p85
      ? `Forecast: the earliest shared forecast said 85% likely done by ${f.p85}; ${f.finishedOn ? `the committed work was finished on ${f.finishedOn}` : "the committed work was not all finished"}${f.met === null ? "" : f.met ? " (the forecast held)" : " (the forecast did not hold)"}.`
      : "Forecast: no forecast was saved for this cycle.",
  ];
  const outliers = t.outliers
    .map((task) => `[${task.key}] ${task.title} — ${task.days} days`)
    .join("\n");
  const blocked = facts.blocked
    .map(
      (entry) =>
        `[${entry.task.key}] ${entry.task.title} — blocked by ${[
          ...entry.blockers.map(
            (blocker) =>
              `[${blocker.key}] ${blocker.title}${blocker.open ? " (still open)" : " (done)"}`,
          ),
          ...(entry.hiddenBlockers > 0
            ? [`${entry.hiddenBlockers} task(s) in another project`]
            : []),
        ].join("; ")}`,
    )
    .join("\n");
  return [
    numbers.join("\n"),
    "Added during the cycle:",
    block("added", refLines(facts.added.tasks, facts.added.total)),
    "Removed during the cycle:",
    block("removed", refLines(facts.removed.tasks, facts.removed.total)),
    "Carried over:",
    block(
      "carried-over",
      refLines(facts.carriedOver.tasks, facts.carriedOver.total),
    ),
    "Left open:",
    block("left-open", refLines(facts.leftOpen.tasks, facts.leftOpen.total)),
    "Reopened:",
    block("reopened", refLines(facts.reopened.tasks, facts.reopened.total)),
    "Cycle-time outliers:",
    block("outliers", outliers),
    "Blocked tasks:",
    block("blocked", blocked),
    "Write the retrospective narrative and the discussion questions.",
  ].join("\n\n");
}

const retroRoute = createRoute({
  method: "post",
  operationId: "aiRetroNarrative",
  path: "/retro",
  tags: TAGS,
  summary: "Write a retrospective narrative",
  description:
    "A short narrative and 3 to 5 discussion questions for a cycle's retrospective, written only from the computed facts (GET /insight/retro/cycle/{cycleId}) and citing tasks by key. Team-level: never about individual people. Nothing is stored; save the result as a Page from the client. Needs ai:use, cycle:read, task:read and analytics:read on a visible project with AI and cycles on.",
  middleware: [
    workspaceAccess.fromBody(),
    requireAiUse,
    requireAiEnabled(),
    requireWorkspacePermission({
      cycle: ["read"],
      task: ["read"],
      analytics: ["read"],
    }),
  ] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: retroNarrativeBody } },
    },
  },
  responses: {
    200: aiStreamResponse("The narrative, with the facts it retells.", {
      facts: retroFactsSchema,
      citations: z.array(insightCitationSchema),
    }),
    403: aiErrorResponse(
      "AI is off (AI_DISABLED), the data may not leave (AI_ROUTE_BLOCKED), cycles are off, or missing permissions",
    ),
    404: errorResponse("Cycle not found"),
    409: errorResponse("The cycle has no dates, or no AI provider is set up"),
    429: aiErrorResponse("AI_BUDGET_EXCEEDED or AI_RATE_LIMITED"),
  },
});

// --- My brief summary ---

/** Only what AI may read: items of projects in the caller's AI scope. */
export function briefForAi(brief: MyBrief, scope: AiScope) {
  const keep = (projectId: string | null) =>
    projectId === null || scope.projectIds.has(projectId);
  const filter = <T>(
    list: { total: number; items: T[] },
    of: (item: T) => string | null,
  ) => {
    const items = list.items.filter((item) => keep(of(item)));
    return { total: items.length, items };
  };
  return {
    ...brief,
    dueToday: filter(brief.dueToday, (task) => task.projectId),
    overdue: filter(brief.overdue, (task) => task.projectId),
    mentions: filter(brief.mentions, (mention) => mention.projectId),
    blocked: filter(brief.blocked, (entry) => entry.task.projectId),
    following: filter(brief.following, (entry) => entry.task.projectId),
  };
}

export function myBriefPrompt(brief: MyBrief): string {
  const task = (item: { key: string; title: string; dueDate: string | null }) =>
    `[${item.key}] ${item.title}${item.dueDate ? ` (due ${item.dueDate.slice(0, 10)})` : ""}`;
  const counts = [
    `Today is ${brief.today} (${brief.timeZone}). Changes are counted since ${brief.since.slice(0, 16).replace("T", " ")} UTC.`,
    `Overdue: ${brief.overdue.total}. Due today: ${brief.dueToday.total}. Unread mentions: ${brief.mentions.total}. Blocked: ${brief.blocked.total}. Followed tasks with changes: ${brief.following.total}.`,
  ];
  return [
    counts.join("\n"),
    "Overdue:",
    block("overdue", brief.overdue.items.map(task).join("\n")),
    "Due today:",
    block("due-today", brief.dueToday.items.map(task).join("\n")),
    "Unread mentions:",
    block(
      "mentions",
      brief.mentions.items
        .map(
          (mention) =>
            `${mention.key ? `[${mention.key}] ` : ""}${mention.title}${mention.actorName ? ` (by ${mention.actorName})` : ""}`,
        )
        .join("\n"),
    ),
    "Blocked:",
    block(
      "blocked",
      brief.blocked.items
        .map(
          (entry) =>
            `${task(entry.task)} — waiting on ${[
              ...entry.blockers.map((b) => `[${b.key}] ${b.title}`),
              ...(entry.hiddenBlockers > 0
                ? [`${entry.hiddenBlockers} task(s) in another project`]
                : []),
            ].join("; ")}`,
        )
        .join("\n"),
    ),
    "Changes on followed tasks:",
    block(
      "following",
      brief.following.items
        .map(
          (entry) =>
            `${task(entry.task)} — ${entry.changes} change(s): ${entry.kinds.join(", ")}`,
        )
        .join("\n"),
    ),
    "Write the brief.",
  ].join("\n\n");
}

function briefCitable(brief: MyBrief): InsightTaskRef[] {
  const refs: InsightTaskRef[] = [];
  for (const task of [...brief.overdue.items, ...brief.dueToday.items]) {
    refs.push(task);
  }
  for (const entry of brief.blocked.items) refs.push(entry.task);
  for (const entry of brief.following.items) refs.push(entry.task);
  for (const mention of brief.mentions.items) {
    if (mention.taskId && mention.key && mention.projectId) {
      refs.push({
        id: mention.taskId,
        key: mention.key,
        title: mention.title,
        projectId: mention.projectId,
      });
    }
  }
  return refs;
}

const myBriefRoute = createRoute({
  method: "post",
  operationId: "aiMyBriefSummary",
  path: "/my-brief",
  tags: TAGS,
  summary: "Summarize my brief",
  description:
    "A few sentences over your computed brief (GET /insight/my-brief), citing tasks by key. Items of projects that AI may not read (AI off, or restricted and not included) are left out of the prompt. Needs ai:use and task:read.",
  middleware: [
    workspaceAccess.fromBody(),
    requireAiUse,
    requireAiEnabled(),
    requireWorkspacePermission({ task: ["read"] }),
  ] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: myBriefSummaryBody } },
    },
  },
  responses: {
    200: aiStreamResponse("The summary, with the brief it retells.", {
      brief: myBriefSchema,
      citations: z.array(insightCitationSchema),
    }),
    403: aiErrorResponse(
      "AI is off (AI_DISABLED), the data may not leave (AI_ROUTE_BLOCKED), or missing permissions",
    ),
    409: aiErrorResponse("No AI provider is set up (AI_NOT_CONFIGURED)"),
    429: aiErrorResponse("AI_BUDGET_EXCEEDED or AI_RATE_LIMITED"),
  },
});

const inboxDigestRoute = createRoute({
  method: "post",
  operationId: "aiInboxDigest",
  path: "/inbox-digest",
  tags: TAGS,
  summary: "Summarize my unread inbox",
  description:
    "A short digest of the caller's unread inbox notifications in the workspace (the newest 60), citing tasks by key. Notifications about projects AI may not read (AI off, or restricted and not included) and pages are left out. Nothing is marked read. Needs ai:use. Feature inbox_digest, fast tier.",
  middleware: [
    workspaceAccess.fromBody(),
    requireAiUse,
    requireAiEnabled(),
  ] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: inboxDigestBody } },
    },
  },
  responses: {
    200: aiStreamResponse("The digest, with what it covers.", {
      unread: z.number().int().openapi({
        description: "Unread notifications read for the digest.",
      }),
      included: z.number().int().openapi({
        description: "Of those, the ones AI could read.",
      }),
      citations: z.array(insightCitationSchema),
    }),
    403: aiErrorResponse(
      "AI is off (AI_DISABLED), the data may not leave (AI_ROUTE_BLOCKED), or missing permissions",
    ),
    409: aiErrorResponse("No AI provider is set up (AI_NOT_CONFIGURED)"),
    429: aiErrorResponse("AI_BUDGET_EXCEEDED or AI_RATE_LIMITED"),
  },
});

function tierOf(scope: AiScope, projectIds: Iterable<string>): DataTier {
  for (const id of projectIds) {
    if (projectDataTier(scope, id) === "restricted") return "restricted";
  }
  return "private";
}

const insightAi = apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(estimateRoute, async (c) => {
    const body = c.req.valid("json");
    const workspaceId = c.get("workspaceId");
    const userId = c.get("userId");
    const scope = await resolveAiScope(c);
    assertProjectInScope(scope, body.projectId);
    await assertProjectFeatureEnabled(body.projectId, "estimates");
    const result = await getEstimateSuggestion({
      userId,
      workspaceId,
      projectId: body.projectId,
      taskId: body.taskId,
      title: body.title,
    });
    if (result.status !== "ok") {
      throw new HTTPException(409, {
        message: "Not enough similar tasks to suggest an estimate",
      });
    }
    const locale = body.locale ?? (await userLocale(userId));
    const stream = await aiStream({
      workspaceId,
      userId,
      feature: "estimate",
      tier: "fast",
      projectIds: [body.projectId],
      dataTier: projectDataTier(scope, body.projectId),
      system: buildSystemPrompt({
        instructions: ESTIMATE_INSTRUCTIONS,
        locale,
      }),
      messages: [{ role: "user", content: estimatePrompt(result) }],
      maxTokens: 1000,
      effort: "low",
    });
    return respond(c, stream, {
      suggestion: result,
      citations: citationsOf(workspaceId, result.similar),
    });
  })
  .openapi(retroRoute, async (c) => {
    const body = c.req.valid("json");
    const workspaceId = c.get("workspaceId");
    const userId = c.get("userId");
    const [cycle] = await db
      .select({ projectId: cycleTable.projectId })
      .from(cycleTable)
      .where(eq(cycleTable.id, body.cycleId))
      .limit(1);
    if (!cycle) throw new HTTPException(404, { message: "Cycle not found" });
    const scope = await resolveAiScope(c);
    assertProjectInScope(scope, cycle.projectId);
    await assertProjectFeatureEnabled(cycle.projectId, "cycles");
    const facts = await computeRetroFacts({
      cycleId: body.cycleId,
      userId,
      workspaceId,
    });
    const locale = body.locale ?? (await userLocale(userId));
    const stream = await aiStream({
      workspaceId,
      userId,
      feature: "retro",
      tier: "balanced",
      projectIds: [cycle.projectId],
      dataTier: projectDataTier(scope, cycle.projectId),
      system: buildSystemPrompt({ instructions: RETRO_INSTRUCTIONS, locale }),
      messages: [{ role: "user", content: retroPrompt(facts) }],
      maxTokens: 4000,
      effort: "low",
    });
    return respond(c, stream, {
      facts,
      citations: citationsOf(workspaceId, retroCitable(facts)),
    });
  })
  .openapi(myBriefRoute, async (c) => {
    const body = c.req.valid("json");
    const workspaceId = c.get("workspaceId");
    const userId = c.get("userId");
    const scope = await resolveAiScope(c);
    const brief = briefForAi(
      await computeMyBrief({ userId, workspaceId }),
      scope,
    );
    const refs = briefCitable(brief);
    const projectIds = new Set(refs.map((ref) => ref.projectId));
    for (const mention of brief.mentions.items) {
      if (mention.projectId) projectIds.add(mention.projectId);
    }
    const locale = body.locale ?? (await userLocale(userId));
    const stream = await aiStream({
      workspaceId,
      userId,
      feature: "my_brief",
      tier: "fast",
      projectIds: [...projectIds],
      dataTier: tierOf(scope, projectIds),
      system: buildSystemPrompt({
        instructions: MY_BRIEF_INSTRUCTIONS,
        locale,
      }),
      messages: [{ role: "user", content: myBriefPrompt(brief) }],
      maxTokens: 1500,
      effort: "low",
    });
    return respond(c, stream, {
      brief,
      citations: citationsOf(workspaceId, refs),
    });
  })
  .openapi(inboxDigestRoute, async (c) => {
    const body = c.req.valid("json");
    const workspaceId = c.get("workspaceId");
    const userId = c.get("userId");
    const scope = await resolveAiScope(c);
    const { rows, unread } = await loadInboxDigest(scope);
    const projectIds = new Set(
      rows.flatMap((row) => (row.projectId ? [row.projectId] : [])),
    );
    const locale = body.locale ?? (await userLocale(userId));
    const stream = await aiStream({
      workspaceId,
      userId,
      feature: "inbox_digest",
      tier: "fast",
      projectIds: [...projectIds],
      dataTier: tierOf(scope, projectIds),
      system: buildSystemPrompt({
        instructions: INBOX_DIGEST_INSTRUCTIONS,
        locale,
      }),
      messages: [
        {
          role: "user",
          content: [
            `Unread notifications (${rows.length}), newest first:`,
            wrapUntrusted({
              source: "inbox",
              text: rows.map(digestLine).join("\n") || "(none)",
              maxChars: 16_000,
            }),
            "Write the digest.",
          ].join("\n\n"),
        },
      ],
      maxTokens: 1500,
      effort: "low",
    });
    return respond(c, stream, {
      unread,
      included: rows.length,
      citations: citationsOf(
        workspaceId,
        rows.flatMap((row) => (row.task ? [row.task] : [])),
      ),
    });
  });

export default insightAi;
