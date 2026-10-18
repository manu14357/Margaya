import { percentile } from "../delivery/stats";

// Calibrated estimates (report 03, #9): pure maths over the team's own
// completed work. Cycle time is first start → completion, in days, rebuilt
// from task history (delivery/flow-intervals.ts). No model computes these.

/** Fewer similar tasks than this give no suggestion. */
export const MIN_SIMILAR = 3;
/** The most similar tasks a suggestion is drawn from. */
export const MAX_SIMILAR = 8;

export type Spread = {
  samples: number;
  p25: number | null;
  median: number | null;
  p75: number | null;
  min: number | null;
  max: number | null;
};

const round1 = (value: number | null) =>
  value === null ? null : Math.round(value * 10) / 10;

/** Quartiles and range of day counts, rounded to a tenth of a day. */
export function spreadOf(days: readonly number[]): Spread {
  if (days.length === 0) {
    return {
      samples: 0,
      p25: null,
      median: null,
      p75: null,
      min: null,
      max: null,
    };
  }
  return {
    samples: days.length,
    p25: round1(percentile(days, 25)),
    median: round1(percentile(days, 50)),
    p75: round1(percentile(days, 75)),
    min: round1(Math.min(...days)),
    max: round1(Math.max(...days)),
  };
}

export type CalibrationPoint = {
  id: string;
  value: string;
  position: number;
};

export type CalibrationSample = {
  pointId: string;
  cycleDays: number;
};

export type CalibrationBucket = CalibrationPoint & Spread;

/**
 * One bucket per estimate value (in the system's order) with the spread of
 * actual cycle times of the tasks completed at that size. `ordered` tells
 * whether bigger sizes really took longer: the medians of the buckets with
 * enough samples never go down.
 */
export function calibrationBuckets(
  points: readonly CalibrationPoint[],
  samples: readonly CalibrationSample[],
  minSamples = MIN_SIMILAR,
): { buckets: CalibrationBucket[]; ordered: boolean | null } {
  const byPoint = new Map<string, number[]>();
  for (const sample of samples) {
    const list = byPoint.get(sample.pointId) ?? [];
    list.push(sample.cycleDays);
    byPoint.set(sample.pointId, list);
  }
  const buckets = [...points]
    .sort((a, b) => a.position - b.position)
    .map((point) => ({ ...point, ...spreadOf(byPoint.get(point.id) ?? []) }));
  const medians = buckets
    .filter((bucket) => bucket.samples >= minSamples)
    .map((bucket) => bucket.median as number);
  if (medians.length < 2) return { buckets, ordered: null };
  const ordered = medians.every(
    (median, index) => index === 0 || median >= (medians[index - 1] as number),
  );
  return { buckets, ordered };
}

export type SimilarSample = {
  pointId: string;
  position: number;
  cycleDays: number | null;
  /** How alike the task is: text rank plus shared labels. */
  weight: number;
};

export type EstimateSuggestion = {
  pointId: string;
  /** Share of the similar tasks' weight on the suggested value, 0..1. */
  share: number;
  matches: number;
};

/**
 * The value similar tasks were usually given: the weighted mode of their
 * estimates. A tie goes to the value nearest the weighted median size, and
 * then to the smaller one. Null below MIN_SIMILAR matches.
 */
export function suggestEstimate(
  similar: readonly SimilarSample[],
): EstimateSuggestion | null {
  if (similar.length < MIN_SIMILAR) return null;
  const weights = new Map<string, { weight: number; position: number }>();
  let total = 0;
  for (const sample of similar) {
    const weight = Math.max(sample.weight, 0.01);
    total += weight;
    const entry = weights.get(sample.pointId) ?? {
      weight: 0,
      position: sample.position,
    };
    entry.weight += weight;
    weights.set(sample.pointId, entry);
  }
  // Weighted median position: where half of the weight lies below.
  const sorted = [...similar].sort((a, b) => a.position - b.position);
  let running = 0;
  let medianPosition = sorted[0]?.position ?? 0;
  for (const sample of sorted) {
    running += Math.max(sample.weight, 0.01);
    if (running >= total / 2) {
      medianPosition = sample.position;
      break;
    }
  }
  const ranked = [...weights.entries()].sort(
    ([, a], [, b]) =>
      b.weight - a.weight ||
      Math.abs(a.position - medianPosition) -
        Math.abs(b.position - medianPosition) ||
      a.position - b.position,
  );
  const [best] = ranked;
  if (!best) return null;
  return {
    pointId: best[0],
    share: Math.round((best[1].weight / total) * 100) / 100,
    matches: similar.length,
  };
}

/**
 * The words of a title as an "any of these words" full-text query: each
 * word quoted (so the last one is not read as a prefix) and joined by `or`.
 * Short and duplicate words are dropped; at most `limit` words.
 */
export function similarityQuery(title: string, limit = 12): string | null {
  const seen = new Set<string>();
  const words: string[] = [];
  for (const raw of title.normalize("NFKC").split(/[^\p{L}\p{N}\p{M}]+/u)) {
    const word = raw.toLowerCase();
    if (!word || seen.has(word)) continue;
    // Scripts without spaces keep whole runs; elsewhere skip "a", "of"...
    const noSpaces = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
    if (word.length < 3 && !noSpaces.test(word)) continue;
    seen.add(word);
    words.push(`"${word}"`);
    if (words.length >= limit) break;
  }
  return words.length > 0 ? words.join(" or ") : null;
}
