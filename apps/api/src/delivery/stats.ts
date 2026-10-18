// Robust statistics shared by the forecast, the risk radar and flow alerts.

function sortedCopy(values: readonly number[]): number[] {
  return [...values].sort((a, b) => a - b);
}

/** The median; null for no values. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = sortedCopy(values);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[middle] as number)
    : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

/**
 * Nearest-rank percentile (p in 0..100) of ascending values: the smallest
 * value with at least p% of the values at or below it. Null for none.
 */
export function percentileSorted(
  sorted: ArrayLike<number>,
  p: number,
): number | null {
  if (sorted.length === 0) return null;
  const rank = Math.ceil((p / 100) * sorted.length);
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[index] as number;
}

/** Nearest-rank percentile of unsorted values. */
export function percentile(values: readonly number[], p: number) {
  return percentileSorted(sortedCopy(values), p);
}

/** Median absolute deviation (raw, unscaled); null for no values. */
export function mad(values: readonly number[]): number | null {
  const center = median(values);
  if (center === null) return null;
  return median(values.map((value) => Math.abs(value - center)));
}

/** MAD scaled to estimate a standard deviation under normality. */
export const MAD_TO_SIGMA = 1.4826;

/**
 * A spread that is never zero: the scaled MAD, or 10% of the median, or
 * `floor`, whichever is largest. A perfectly steady baseline (MAD 0) would
 * otherwise flag any change at all.
 */
export function robustScale(values: readonly number[], floor: number): number {
  const center = median(values) ?? 0;
  const spread = mad(values) ?? 0;
  return Math.max(MAD_TO_SIGMA * spread, 0.1 * Math.abs(center), floor);
}
