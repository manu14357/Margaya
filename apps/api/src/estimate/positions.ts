import { type EstimateType, isNumericEstimateType } from "./types";

// Pure ordering rules for a system's points. Positions are always 1..n with
// no gaps: numeric systems are ordered by value, categories by hand.

type Valued = { numericValue: number | null };

/**
 * The final order of a system's points, positions renumbered 1..n. Points
 * and time sort ascending by value; categories keep the order given.
 */
export function arrangePoints<T extends Valued>(
  type: EstimateType,
  points: readonly T[],
): Array<T & { position: number }> {
  const ordered = isNumericEstimateType(type)
    ? [...points].sort((a, b) => (a.numericValue ?? 0) - (b.numericValue ?? 0))
    : [...points];
  return ordered.map((point, index) => ({ ...point, position: index + 1 }));
}

/**
 * Inserts a point at a 1-based position, clamped to the ends of the list;
 * without a position it goes last.
 */
export function insertAtPosition<T>(
  points: readonly T[],
  point: T,
  position?: number,
): T[] {
  const index =
    position === undefined
      ? points.length
      : Math.min(Math.max(position, 1), points.length + 1) - 1;
  return [...points.slice(0, index), point, ...points.slice(index)];
}
