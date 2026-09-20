import { type EstimateType, isNumericEstimateType } from "./values";

type MappablePoint = {
  id: string;
  value: string;
  numericValue: number | null;
  position: number;
};

type MappableEstimate = {
  type: EstimateType;
  points: readonly MappablePoint[];
};

function byPosition(a: MappablePoint, b: MappablePoint): number {
  return a.position - b.position || a.id.localeCompare(b.id);
}

function sameValue(
  type: EstimateType,
  a: MappablePoint,
  b: MappablePoint,
): boolean {
  if (isNumericEstimateType(type)) {
    return a.numericValue !== null && a.numericValue === b.numericValue;
  }
  const key = (point: MappablePoint) =>
    point.value.replace(/\s+/g, " ").trim().toLowerCase();
  return key(a) === key(b);
}

/** The target nearest in value; a tie goes to the larger one. */
function closestByValue(
  targets: readonly MappablePoint[],
  value: number,
): MappablePoint | undefined {
  let best: { point: MappablePoint; value: number } | undefined;
  for (const target of targets) {
    if (target.numericValue === null) continue;
    const candidate = { point: target, value: target.numericValue };
    if (!best) {
      best = candidate;
      continue;
    }
    const distance = Math.abs(candidate.value - value);
    const bestDistance = Math.abs(best.value - value);
    if (
      distance < bestDistance ||
      (distance === bestDistance && candidate.value > best.value)
    ) {
      best = candidate;
    }
  }
  return best?.point;
}

/**
 * Where each value of the current system goes when switching to `to`:
 * 1. the same type with an equal value maps to that value;
 * 2. otherwise, within one numeric type, to the closest value (a tie takes
 *    the larger one);
 * 3. otherwise by relative rank: position p of n maps to position
 *    round((p − 1)(m − 1)/(n − 1)) + 1 of m;
 * 4. a single current value maps to the first target.
 * Points and minutes are different units, so a switch between them maps by
 * rank. Every current value gets an entry, used or not.
 */
export function defaultEstimateMapping(
  from: MappableEstimate,
  to: MappableEstimate,
): Record<string, string | null> {
  const sources = [...from.points].sort(byPosition);
  const targets = [...to.points].sort(byPosition);
  const mapping: Record<string, string | null> = {};
  const n = sources.length;
  const m = targets.length;
  const sameType = from.type === to.type;

  sources.forEach((point, index) => {
    if (m === 0) {
      mapping[point.id] = null;
      return;
    }
    if (sameType) {
      const equal = targets.find((target) =>
        sameValue(from.type, point, target),
      );
      if (equal) {
        mapping[point.id] = equal.id;
        return;
      }
      if (isNumericEstimateType(from.type) && point.numericValue !== null) {
        const closest = closestByValue(targets, point.numericValue);
        if (closest) {
          mapping[point.id] = closest.id;
          return;
        }
      }
    }
    if (n === 1) {
      mapping[point.id] = targets[0].id;
      return;
    }
    const rank = Math.round((index * (m - 1)) / (n - 1));
    mapping[point.id] = targets[rank].id;
  });

  return mapping;
}

/**
 * The value to move tasks to when a value is deleted: the nearest other
 * value by position, the next one on a tie. Null when none is left.
 */
export function nearestPointId(
  points: readonly MappablePoint[],
  pointId: string,
): string | null {
  const deleted = points.find((point) => point.id === pointId);
  if (!deleted) return null;
  let best: MappablePoint | null = null;
  for (const point of points) {
    if (point.id === pointId) continue;
    if (!best) {
      best = point;
      continue;
    }
    const distance = Math.abs(point.position - deleted.position);
    const bestDistance = Math.abs(best.position - deleted.position);
    if (
      distance < bestDistance ||
      (distance === bestDistance && point.position > best.position)
    ) {
      best = point;
    }
  }
  return best?.id ?? null;
}
