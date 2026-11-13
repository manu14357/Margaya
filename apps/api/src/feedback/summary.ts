import type { FeedbackFormat } from "./constants";
import { FORMAT_RANGES } from "./constants";

// Pure aggregation for the admin summary: averages, the share of happy
// answers, NPS and the distribution, from (score, count) rows.

export type ScoreCount = { score: number; count: number };

/**
 * A happy answer: the top face of three, 4 or 5 of five faces or stars, a
 * promoter (9-10) on NPS, a thumbs up.
 */
export function isPositive(format: FeedbackFormat, score: number): boolean {
  switch (format) {
    case "faces3":
      return score === 3;
    case "faces5":
    case "stars":
      return score >= 4;
    case "nps":
      return score >= 9;
    case "thumbs":
      return score === 1;
  }
}

/** Detractors (0-6) count against NPS. */
function isDetractor(score: number) {
  return score <= 6;
}

export type ScoreSummary = {
  count: number;
  average: number | null;
  /** Happy answers, 0-100. */
  satisfaction: number | null;
  /** -100 to 100, NPS only. */
  nps: number | null;
};

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

export function summarizeScores(
  format: FeedbackFormat,
  rows: readonly ScoreCount[],
): ScoreSummary {
  let count = 0;
  let sum = 0;
  let positive = 0;
  let detractors = 0;
  for (const row of rows) {
    count += row.count;
    sum += row.score * row.count;
    if (isPositive(format, row.score)) positive += row.count;
    if (format === "nps" && isDetractor(row.score)) detractors += row.count;
  }
  if (count === 0) {
    return { count, average: null, satisfaction: null, nps: null };
  }
  return {
    count,
    average: round1(sum / count),
    satisfaction: Math.round((positive / count) * 100),
    nps:
      format === "nps"
        ? Math.round(((positive - detractors) / count) * 100)
        : null,
  };
}

/** Every score the format allows, zero-filled, lowest first. */
export function fullDistribution(
  format: FeedbackFormat,
  rows: readonly ScoreCount[],
): ScoreCount[] {
  const { min, max } = FORMAT_RANGES[format];
  const counts = new Map(rows.map((row) => [row.score, row.count]));
  const result: ScoreCount[] = [];
  for (let score = min; score <= max; score += 1) {
    result.push({ score, count: counts.get(score) ?? 0 });
  }
  return result;
}

export type WeekScoreCount = ScoreCount & { week: string };

export type TrendPoint = ScoreSummary & { week: string };

/** One point per week that has answers, oldest first. */
export function weeklyTrend(
  format: FeedbackFormat,
  rows: readonly WeekScoreCount[],
): TrendPoint[] {
  const byWeek = new Map<string, ScoreCount[]>();
  for (const row of rows) {
    const list = byWeek.get(row.week) ?? [];
    list.push({ score: row.score, count: row.count });
    byWeek.set(row.week, list);
  }
  return [...byWeek.keys()].sort().map((week) => ({
    week,
    ...summarizeScores(format, byWeek.get(week) ?? []),
  }));
}
