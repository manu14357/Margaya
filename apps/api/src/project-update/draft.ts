import type { Context } from "hono";
import { assertAiEnabled } from "../ai/access";
import {
  type AiContextItem,
  assertProjectInScope,
  projectDataTier,
  resolveAiScope,
} from "../ai/context";
import { isAiError } from "../ai/errors";
import { aiCompleteJson } from "../ai/gateway";
import { buildSystemPrompt, wrapUntrusted } from "../ai/prompt";
import { userLocale } from "../ai-translate/locale";
import { hasWorkspacePermission } from "../utils/require-workspace-permission";
import { computeProjectUpdateFacts } from "./facts";
import {
  PROJECT_UPDATE_HEALTHS,
  type ProjectUpdateDraft,
  type ProjectUpdateFacts,
  type ProjectUpdateHealth,
  type ProjectUpdateTaskList,
} from "./types";

// "Draft with AI" for a project status update. The numbers always come from
// facts.ts. With AI available, the model writes prose around them through
// the gateway; without it (off, not set up, over budget, failed) the same
// facts fill a fixed template, so the button always gives a draft.

/** Field limits, shared with the request schema. */
export const SUMMARY_MAX = 2000;
export const SECTION_MAX = 4000;

export const PROJECT_UPDATE_INSTRUCTIONS = `You draft a short project status update for the project's team and stakeholders.
Rules:
- Use ONLY the facts given. Never calculate, estimate or round numbers or dates yourself: copy them exactly as given. Leave out anything the facts don't cover.
- Mention tasks by their key in square brackets, such as [WEB-12]. Mention only tasks listed in the facts.
- health: pick on_track, at_risk or off_track. Start from the suggested health and change it only when the facts clearly say otherwise.
- summary: two or three plain sentences on overall progress and health.
- highlights: what was completed or moved forward, as short Markdown bullets ("- ").
- blockers: overdue and blocked work and the main risks, as short Markdown bullets; empty when there are none.
- nextSteps: what is in progress or should happen next, as short Markdown bullets.
- Plain, factual wording. No greetings, no sign-off, no names of people.`;

const DRAFT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["health", "summary", "highlights", "blockers", "nextSteps"],
  properties: {
    health: { type: "string", enum: [...PROJECT_UPDATE_HEALTHS] },
    summary: { type: "string" },
    highlights: { type: "string" },
    blockers: { type: "string" },
    nextSteps: { type: "string" },
  },
} as const;

function taskLines(list: ProjectUpdateTaskList): string {
  const lines = list.tasks.map((task) => `- [${task.key}] ${task.title}`);
  if (list.total > list.tasks.length) {
    lines.push(`- (and ${list.total - list.tasks.length} more)`);
  }
  return lines.join("\n");
}

function nullIfEmpty(text: string): string | null {
  const trimmed = text.trim();
  return trimmed ? trimmed : null;
}

const HEALTH_WORDS: Record<ProjectUpdateHealth, string> = {
  on_track: "on track",
  at_risk: "at risk",
  off_track: "off track",
};

/**
 * The template draft, from facts alone. The web app builds its own
 * translated template from the same facts; this English one serves API and
 * MCP clients.
 */
export function templateDraft(facts: ProjectUpdateFacts): ProjectUpdateDraft {
  const window = facts.sinceLastUpdate
    ? "since the last update"
    : "in the last 7 days";
  const summary = [
    `The project is ${HEALTH_WORDS[facts.suggestedHealth]}: ${facts.counts.percent}% of tasks are complete (${facts.counts.completed} of ${facts.counts.total}), with ${facts.counts.open} open.`,
    `${facts.completed.total} completed and ${facts.moved.total} moved ${window}.`,
    facts.forecastP85
      ? `The delivery forecast gives an 85% chance to finish by ${facts.forecastP85}.`
      : null,
  ]
    .filter(Boolean)
    .join(" ");
  const highlights = [
    taskLines(facts.completed),
    ...facts.cycles.map(
      (cycle) =>
        `- ${cycle.name}: ${cycle.percent}% complete (${cycle.completed} of ${cycle.total}), ends ${cycle.endDate}`,
    ),
  ]
    .filter(Boolean)
    .join("\n");
  const blockers = [
    facts.overdue.total > 0
      ? `Overdue (${facts.overdue.total}):\n${taskLines(facts.overdue)}`
      : "",
    facts.blocked.total > 0
      ? `Blocked (${facts.blocked.total}):\n${taskLines(facts.blocked)}`
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  return {
    health: facts.suggestedHealth,
    summary,
    highlights: nullIfEmpty(highlights),
    blockers: nullIfEmpty(blockers),
    nextSteps: nullIfEmpty(taskLines(facts.inProgress)),
  };
}

/** The facts as model input; task titles are workspace text (untrusted). */
export function draftPrompt(
  projectName: string,
  facts: ProjectUpdateFacts,
): string {
  const numbers = [
    `Facts as of ${facts.generatedAt.slice(0, 10)}; changes counted since ${facts.since.slice(0, 10)} (${facts.sinceLastUpdate ? "the previous update" : "no previous update: the last 7 days"}).`,
    `Tasks: ${facts.counts.total} in total, ${facts.counts.completed} completed, ${facts.counts.open} open. Progress: ${facts.counts.percent}% complete.${facts.truncated ? " (Only the first tasks were counted.)" : ""}`,
    `Since then: ${facts.completed.total} completed, ${facts.moved.total} moved between statuses, ${facts.added.total} added.`,
    `Overdue: ${facts.overdue.total}. Blocked: ${facts.blocked.total}. In progress: ${facts.inProgress.total}.`,
    facts.forecastP85
      ? `Forecast: 85% likely done by ${facts.forecastP85}.`
      : "Forecast: unavailable.",
    `Suggested health: ${facts.suggestedHealth}.`,
  ];
  const cycles =
    facts.cycles.length === 0
      ? "(none)"
      : facts.cycles
          .map(
            (cycle) =>
              `${cycle.name}: ${cycle.percent}% complete (${cycle.completed} of ${cycle.total}), ends ${cycle.endDate}`,
          )
          .join("\n");
  const risks =
    facts.risks.length === 0
      ? "(none)"
      : facts.risks
          .map(
            (risk) => `${risk.kind} (${risk.severity}): ${risk.total} task(s)`,
          )
          .join("\n");
  const block = (source: string, text: string) =>
    wrapUntrusted({ source, text: text || "(none)", maxChars: 6000 });
  return [
    numbers.join("\n"),
    "Project:",
    block("project", projectName),
    "Completed since then:",
    block("completed", taskLines(facts.completed)),
    "Overdue:",
    block("overdue", taskLines(facts.overdue)),
    "Blocked:",
    block("blocked", taskLines(facts.blocked)),
    "In progress:",
    block("in-progress", taskLines(facts.inProgress)),
    "Active cycles:",
    block("cycles", cycles),
    `Risks (computed):\n${risks}`,
    "Draft the update.",
  ].join("\n\n");
}

function clip(text: unknown, max: number): string | null {
  if (typeof text !== "string") return null;
  const trimmed = text.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

/** The model's answer, checked; null when it is unusable. */
export function parseAiDraft(
  value: unknown,
  fallbackHealth: ProjectUpdateHealth,
): ProjectUpdateDraft | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const summary = clip(record.summary, SUMMARY_MAX);
  if (!summary) return null;
  const health = (PROJECT_UPDATE_HEALTHS as readonly unknown[]).includes(
    record.health,
  )
    ? (record.health as ProjectUpdateHealth)
    : fallbackHealth;
  return {
    health,
    summary,
    highlights: clip(record.highlights, SECTION_MAX),
    blockers: clip(record.blockers, SECTION_MAX),
    nextSteps: clip(record.nextSteps, SECTION_MAX),
  };
}

export type DraftResult = {
  facts: ProjectUpdateFacts;
  draft: ProjectUpdateDraft;
  /** A model wrote the text; post it with aiAssist to label it. */
  aiDrafted: boolean;
  /** Why the template was used although AI was asked for. */
  aiUnavailable: string | null;
};

async function draftWithAi(
  c: Context,
  input: { projectId: string; projectName: string; locale?: string },
  facts: ProjectUpdateFacts,
): Promise<ProjectUpdateDraft> {
  const workspaceId = c.get("workspaceId") as string;
  const userId = c.get("userId") as string;
  await assertAiEnabled(workspaceId);
  if (!(await hasWorkspacePermission(c, { ai: ["use"] }))) {
    throw new DraftFallback("AI_FORBIDDEN");
  }
  const scope = await resolveAiScope(c);
  // AI_DISABLED for a project with AI off (or restricted and kept out).
  assertProjectInScope(scope, input.projectId);
  const context: AiContextItem[] = [
    {
      kind: "project",
      id: input.projectId,
      projectId: input.projectId,
      title: input.projectName,
      url: "",
      source: `project:${input.projectName}`,
      author: null,
      text: "",
      dataTier: projectDataTier(scope, input.projectId),
    },
  ];
  const locale = input.locale ?? (await userLocale(userId));
  const { value } = await aiCompleteJson<unknown>({
    workspaceId,
    userId,
    feature: "project_update",
    tier: "balanced",
    context,
    system: buildSystemPrompt({
      instructions: PROJECT_UPDATE_INSTRUCTIONS,
      locale,
    }),
    messages: [
      { role: "user", content: draftPrompt(input.projectName, facts) },
    ],
    jsonSchema: DRAFT_JSON_SCHEMA,
    maxTokens: 2000,
    effort: "low",
  });
  const draft = parseAiDraft(value, facts.suggestedHealth);
  if (!draft) throw new DraftFallback("AI_PROVIDER_ERROR");
  return draft;
}

class DraftFallback extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

/** Facts plus a draft: AI when asked for and available, else the template. */
export async function draftProjectUpdate(
  c: Context,
  input: {
    projectId: string;
    projectName: string;
    useAi: boolean;
    locale?: string;
  },
): Promise<DraftResult> {
  const facts = await computeProjectUpdateFacts({
    projectId: input.projectId,
    workspaceId: c.get("workspaceId") as string,
    userId: c.get("userId") as string,
  });
  if (!input.useAi) {
    return {
      facts,
      draft: templateDraft(facts),
      aiDrafted: false,
      aiUnavailable: null,
    };
  }
  try {
    const draft = await draftWithAi(c, input, facts);
    return { facts, draft, aiDrafted: true, aiUnavailable: null };
  } catch (error) {
    // Any AI failure falls back to the template: the person still gets a
    // draft, and the code tells the web why it isn't an AI one.
    if (isAiError(error)) {
      return {
        facts,
        draft: templateDraft(facts),
        aiDrafted: false,
        aiUnavailable: error.code,
      };
    }
    if (error instanceof DraftFallback) {
      return {
        facts,
        draft: templateDraft(facts),
        aiDrafted: false,
        aiUnavailable: error.code,
      };
    }
    throw error;
  }
}
