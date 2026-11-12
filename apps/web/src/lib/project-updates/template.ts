// The template draft of a project update, in the reader's language, built
// from the facts the API computed. Used when AI is off or unavailable; the
// API's own template (English) serves API and MCP clients.

export type TemplateHealth = "on_track" | "at_risk" | "off_track";

type TaskRef = { key: string; title: string };
type TaskList = { total: number; tasks: readonly TaskRef[] };

export type TemplateFacts = {
  sinceLastUpdate: boolean;
  counts: { total: number; open: number; completed: number; percent: number };
  completed: TaskList;
  moved: { total: number };
  overdue: TaskList;
  blocked: TaskList;
  inProgress: TaskList;
  cycles: readonly {
    name: string;
    endDate: string;
    total: number;
    completed: number;
    percent: number;
  }[];
  forecastP85: string | null;
  suggestedHealth: TemplateHealth;
};

export type TemplateDraft = {
  health: TemplateHealth;
  summary: string;
  highlights: string;
  blockers: string;
  nextSteps: string;
};

type Translate = (key: string, options?: Record<string, unknown>) => string;

export const HEALTH_LABEL_KEYS: Record<TemplateHealth, string> = {
  on_track: "projectUpdates:health.on_track",
  at_risk: "projectUpdates:health.at_risk",
  off_track: "projectUpdates:health.off_track",
};

function lines(list: TaskList, t: Translate): string[] {
  const out = list.tasks.map((task) => `- [${task.key}] ${task.title}`);
  const more = list.total - list.tasks.length;
  if (more > 0)
    out.push(`- ${t("projectUpdates:template.more", { count: more })}`);
  return out;
}

export function buildTemplateDraft(
  facts: TemplateFacts,
  t: Translate,
): TemplateDraft {
  const summary = [
    t("projectUpdates:template.summary", {
      health: t(HEALTH_LABEL_KEYS[facts.suggestedHealth]),
      percent: facts.counts.percent,
      completed: facts.counts.completed,
      total: facts.counts.total,
      open: facts.counts.open,
    }),
    t(
      facts.sinceLastUpdate
        ? "projectUpdates:template.changesSinceUpdate"
        : "projectUpdates:template.changesLastWeek",
      { completed: facts.completed.total, moved: facts.moved.total },
    ),
    facts.forecastP85
      ? t("projectUpdates:template.forecast", { date: facts.forecastP85 })
      : null,
  ]
    .filter(Boolean)
    .join(" ");

  const highlights = [
    ...lines(facts.completed, t),
    ...facts.cycles.map(
      (cycle) =>
        `- ${t("projectUpdates:template.cycle", {
          name: cycle.name,
          percent: cycle.percent,
          completed: cycle.completed,
          total: cycle.total,
          date: cycle.endDate,
        })}`,
    ),
  ].join("\n");

  const blockers = [
    facts.overdue.total > 0
      ? [
          t("projectUpdates:template.overdue", { count: facts.overdue.total }),
          ...lines(facts.overdue, t),
        ].join("\n")
      : "",
    facts.blocked.total > 0
      ? [
          t("projectUpdates:template.blocked", { count: facts.blocked.total }),
          ...lines(facts.blocked, t),
        ].join("\n")
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  return {
    health: facts.suggestedHealth,
    summary,
    highlights,
    blockers,
    nextSteps: lines(facts.inProgress, t).join("\n"),
  };
}
