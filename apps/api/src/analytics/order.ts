import type { CycleGroupMeta, GroupLookup } from "../task-query/group";
import { sortGroupKeys } from "../task-query/group";
import {
  type AnalyticsDimension,
  ESTIMATE_KEY_TYPES,
  isDateDimension,
  NONE_KEY,
} from "./dimensions";

// Natural key order per dimension (B8 §2A.1). Pure: keys plus what meta
// says about them. Dimensions that the task query engine groups by keep its
// order; cycles, estimates and dates have analytics' own. `none` is always
// last (status and project never have one).

export const OTHER_KEY = "other";

/** An estimate key as analytics shows it: `<type>:<value>`. */
export type EstimateKeyMeta = {
  key: string;
  type: (typeof ESTIMATE_KEY_TYPES)[number];
  value: string;
  /** The lowest position of this value across the scope's systems. */
  position: number;
};

export type OrderLookup = GroupLookup & {
  estimates: ReadonlyMap<string, EstimateKeyMeta>;
};

type SortTuple = (number | string)[];

function compareTuples(a: SortTuple, b: SortTuple): number {
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index++) {
    const left = a[index];
    const right = b[index];
    if (left === right) continue;
    if (left === undefined) return -1;
    if (right === undefined) return 1;
    if (typeof left === "number" && typeof right === "number") {
      return left - right;
    }
    return String(left) < String(right) ? -1 : 1;
  }
  return 0;
}

function sortBy(
  keys: readonly string[],
  tuple: (key: string) => SortTuple,
): string[] {
  return keys
    .map((key) => ({ key, tuple: tuple(key) }))
    .sort((a, b) => compareTuples(a.tuple, b.tuple))
    .map((entry) => entry.key);
}

/** Dated cycles by start date, then drafts; each by name. */
function cycleTuple(cycle: CycleGroupMeta): SortTuple {
  const name = cycle.name.toLocaleLowerCase();
  return cycle.startDate
    ? [0, 0, cycle.startDate, name, cycle.id]
    : [0, 1, "", name, cycle.id];
}

const ESTIMATE_TYPE_RANK: Record<string, number> = Object.fromEntries(
  ESTIMATE_KEY_TYPES.map((type, index) => [type, index]),
);

/** Splits `<type>:<value>`; the value may itself contain colons. */
export function parseEstimateKey(
  key: string,
): { type: string; value: string } | null {
  const index = key.indexOf(":");
  if (index <= 0) return null;
  return { type: key.slice(0, index), value: key.slice(index + 1) };
}

function estimateTuple(key: string, lookup: OrderLookup): SortTuple {
  const parsed = parseEstimateKey(key);
  const rank = parsed ? ESTIMATE_TYPE_RANK[parsed.type] : undefined;
  if (!parsed || rank === undefined) return [1, key];
  if (parsed.type === "categories") {
    const position = lookup.estimates.get(key)?.position;
    return [0, rank, position ?? Number.MAX_SAFE_INTEGER, parsed.value];
  }
  const number = Number(parsed.value);
  return [0, rank, Number.isFinite(number) ? number : 0, parsed.value];
}

/** Keys of a dimension in natural order. */
export function naturalOrder(
  dimension: AnalyticsDimension,
  keys: readonly string[],
  lookup: OrderLookup,
): string[] {
  if (isDateDimension(dimension)) {
    return sortBy(keys, (key) => (key === NONE_KEY ? [2] : [0, key]));
  }
  if (dimension === "cycle") {
    return sortBy(keys, (key) => {
      if (key === NONE_KEY) return [2];
      const cycle = lookup.cycles.get(key);
      return cycle ? cycleTuple(cycle) : [1, key];
    });
  }
  if (dimension === "estimate") {
    return sortBy(keys, (key) =>
      key === NONE_KEY ? [2] : estimateTuple(key, lookup),
    );
  }
  return sortGroupKeys(dimension, keys, lookup);
}

/**
 * Legend (and stack) order of segments: natural order, then `other`, then
 * `none`.
 */
export function segmentOrder(
  dimension: AnalyticsDimension,
  keys: readonly string[],
  lookup: OrderLookup,
): string[] {
  const named = keys.filter((key) => key !== OTHER_KEY && key !== NONE_KEY);
  return [
    ...naturalOrder(dimension, named, lookup),
    ...(keys.includes(OTHER_KEY) ? [OTHER_KEY] : []),
    ...(keys.includes(NONE_KEY) ? [NONE_KEY] : []),
  ];
}
