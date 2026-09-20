// Pure scale helpers shared by the SVG charts in components/charts. Values
// always start at 0: every chart here plots counts or sums on one axis.

export type Range = readonly [number, number];

/** Maps a value from `domain` onto `range`; a zero-width domain maps to the range start. */
export function linearScale(domain: Range, range: Range) {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0;
  return (value: number) =>
    span === 0 ? r0 : r0 + ((value - d0) / span) * (r1 - r0);
}

/** True when every value is a whole number, so axis ticks can stay integers. */
export function allIntegers(values: Iterable<number>): boolean {
  for (const value of values) {
    if (!Number.isInteger(value)) return false;
  }
  return true;
}

const NICE_STEPS = [1, 2, 5, 10] as const;

function decimalsOf(step: number): number {
  if (step >= 1) return 0;
  return Math.min(10, Math.ceil(-Math.log10(step) - 1e-9));
}

/**
 * Evenly spaced ticks from 0 to at least `max`, on a 1-2-5 step, about
 * `count` of them. With `integer`, the step is never below 1, so a chart of
 * counts never shows "0.5 tasks". The last tick is the axis maximum.
 */
export function niceTicks(
  max: number,
  { count = 5, integer = false }: { count?: number; integer?: boolean } = {},
): number[] {
  const top = Number.isFinite(max) && max > 0 ? max : 0;
  if (top === 0) return [0, 1];

  const raw = top / Math.max(1, count);
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalized = raw / magnitude;
  const multiple =
    NICE_STEPS.find((candidate) => candidate >= normalized - 1e-9) ?? 10;
  let step = multiple * magnitude;
  if (integer) step = Math.max(1, Math.round(step));

  const decimals = decimalsOf(step);
  const tickCount = Math.ceil(top / step - 1e-9);
  const ticks: number[] = [];
  for (let index = 0; index <= tickCount; index += 1) {
    ticks.push(Number((index * step).toFixed(decimals)));
  }
  return ticks;
}

export type BandScale = {
  /** Distance between the starts of two neighboring bands (the hit slot). */
  step: number;
  /** The drawable width of one band. */
  bandwidth: number;
  /** Where band `index`'s slot begins. */
  slotStart: (index: number) => number;
  /** Where band `index`'s drawable part begins. */
  start: (index: number) => number;
  center: (index: number) => number;
};

/**
 * `n` equal slots across `range`, each keeping `paddingInner` of its width
 * as air, split evenly on both sides, so the edge bands get half a gap.
 */
export function bandScale(
  n: number,
  range: Range,
  paddingInner = 0.2,
): BandScale {
  const [r0, r1] = range;
  const step = n > 0 ? (r1 - r0) / n : 0;
  const bandwidth = step * (1 - paddingInner);
  const offset = (step - bandwidth) / 2;
  return {
    step,
    bandwidth,
    slotStart: (index) => r0 + index * step,
    start: (index) => r0 + index * step + offset,
    center: (index) => r0 + index * step + step / 2,
  };
}
