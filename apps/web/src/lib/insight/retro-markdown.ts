import type { TFunction } from "i18next";
import type { RetroFacts } from "@/fetchers/insight/insight";

// Facts-first retrospectives (#15): the fact lines shown in the panel and
// the Markdown of the saved Page. Every number comes from the API's fact
// sheet; the optional AI narrative is added as written (and editable).

type TaskList = { total: number; tasks: { key: string; title: string }[] };

/** One line per fact, in reading order. */
export function retroFactLines(facts: RetroFacts, t: TFunction): string[] {
  const c = facts.counts;
  const lines = [
    facts.sayDoPercent === null
      ? t("insight:retro.facts.sayDoNone")
      : t("insight:retro.facts.sayDo", {
          done: c.committedCompleted,
          count: c.committed,
          percent: facts.sayDoPercent,
        }),
    t("insight:retro.facts.scope", { added: c.added, removed: c.removed }),
    t("insight:retro.facts.carry", {
      carried: c.carriedOver,
      open: c.leftOpen,
    }),
    t("insight:retro.facts.reopened", { count: c.reopened }),
  ];
  // Nothing committed in points makes "7 of 0 done" meaningless.
  if (facts.points && facts.points.committed > 0) {
    lines.push(
      t("insight:retro.facts.points", {
        completed: facts.points.completed,
        committed: facts.points.committed,
      }),
    );
  }
  const time = facts.cycleTime;
  lines.push(
    time.medianDays === null
      ? t("insight:retro.facts.cycleTimeNone")
      : time.threshold === null
        ? t("insight:retro.facts.cycleTime", { median: time.medianDays })
        : t("insight:retro.facts.cycleTimeOutliers", {
            median: time.medianDays,
            count: time.outliers.length,
            threshold: time.threshold,
          }),
  );
  lines.push(t("insight:retro.facts.blocked", { count: c.blocked }));
  const forecast = facts.forecast;
  lines.push(
    forecast.p85 === null
      ? t("insight:retro.facts.forecastNone")
      : forecast.met === null
        ? t("insight:retro.facts.forecastOpen", { date: forecast.p85 })
        : forecast.met
          ? t("insight:retro.facts.forecastMet", { date: forecast.p85 })
          : t("insight:retro.facts.forecastMissed", { date: forecast.p85 }),
  );
  return lines;
}

function listSection(title: string, list: TaskList, t: TFunction): string[] {
  if (list.total === 0) return [];
  const lines = list.tasks.map((task) => `- ${task.key} ${task.title}`);
  if (list.total > list.tasks.length) {
    lines.push(
      `- ${t("insight:retro.more", { count: list.total - list.tasks.length })}`,
    );
  }
  return [`### ${title}`, "", ...lines, ""];
}

/** The retrospective Page: facts, the narrative if any, and team sections. */
export function retroMarkdown(
  facts: RetroFacts,
  t: TFunction,
  narrative?: string,
): string {
  const parts = [
    `## ${t("insight:retro.page.facts")}`,
    "",
    ...retroFactLines(facts, t).map((line) => `- ${line}`),
    "",
    ...listSection(t("insight:retro.lists.added"), facts.added, t),
    ...listSection(t("insight:retro.lists.carriedOver"), facts.carriedOver, t),
    ...listSection(t("insight:retro.lists.leftOpen"), facts.leftOpen, t),
    ...listSection(
      t("insight:retro.lists.outliers"),
      {
        total: facts.cycleTime.outliers.length,
        tasks: facts.cycleTime.outliers.map((task) => ({
          key: task.key,
          title: `${task.title} (${t("insight:days", { count: task.days })})`,
        })),
      },
      t,
    ),
    ...listSection(
      t("insight:retro.lists.blocked"),
      {
        total: facts.blocked.length,
        tasks: facts.blocked.map((entry) => entry.task),
      },
      t,
    ),
  ];
  if (narrative?.trim()) parts.push(narrative.trim(), "");
  for (const heading of [
    t("insight:retro.page.wentWell"),
    t("insight:retro.page.improve"),
    t("insight:retro.page.actions"),
  ]) {
    parts.push(`## ${heading}`, "", "- ", "");
  }
  return parts.join("\n").trim();
}
