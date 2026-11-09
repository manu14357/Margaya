import { progressPercent } from "../task/scope";
import { bucketEnd, type DateBucket, fillDateKeys } from "./buckets";
import {
  type AnalyticsDimension,
  dimensionInfo,
  isDateDimension,
  NONE_KEY,
} from "./dimensions";
import { round2 } from "./metrics";
import {
  naturalOrder,
  type OrderLookup,
  OTHER_KEY,
  segmentOrder,
} from "./order";

// From SQL aggregates to the chart the API returns (B8 §2A.3, §2A.5): the
// none bucket rule, x truncation and zero-fill, segment folding into
// `other`, natural order and progress. Pure: the rows come in, nothing is
// read or counted here.

export type Tally = { value: number; taskCount: number };

export type ChartAggregate = {
  /** Per x key: the distinct tasks holding it and their weight. */
  buckets: Map<string, Tally>;
  /** Per segment key over the whole task set. */
  segments: Map<string, Tally>;
  /** x key → segment key → weight of the tasks holding both. */
  cells: Map<string, Map<string, number>>;
  /** The distinct task set. */
  total: Tally;
};

export type ShapedBucket = {
  key: string;
  value: number;
  taskCount: number;
  cells?: Record<string, number>;
  progress: number | null;
  rangeStart?: string;
  rangeEnd?: string;
};

export type ShapedSegment = { key: string; value: number; taskCount: number };

export type ShapedChart = {
  buckets: ShapedBucket[];
  segments: ShapedSegment[];
  truncated: {
    x: boolean;
    hiddenXCount: number;
    segment: boolean;
    hiddenSegmentCount: number;
  };
  noneCount: number | null;
  progress: number | null;
};

export type ShapeOptions = {
  xAxis: AnalyticsDimension;
  segment: AnalyticsDimension | null;
  includeNone: boolean;
  dateBucket: DateBucket;
  lookup: OrderLookup;
};

/**
 * The `cap` keys with the largest values, ties broken by natural order,
 * returned in natural order. `ordered` is every key in natural order.
 */
export function topByValue(
  ordered: readonly string[],
  score: (key: string) => number,
  cap: number,
): { kept: string[]; hidden: number } {
  if (ordered.length <= cap) return { kept: [...ordered], hidden: 0 };
  const rank = new Map(ordered.map((key, index) => [key, index]));
  const top = [...ordered]
    .sort(
      (a, b) => score(b) - score(a) || (rank.get(a) ?? 0) - (rank.get(b) ?? 0),
    )
    .slice(0, cap);
  const keep = new Set(top);
  return {
    kept: ordered.filter((key) => keep.has(key)),
    hidden: ordered.length - cap,
  };
}

type FoldedSegments = {
  keys: string[];
  totals: Map<string, Tally>;
  /** Folded key → `other`; kept keys map to themselves. */
  target: Map<string, string>;
  hidden: number;
};

/**
 * Keeps the top `cap` named segments by total and folds the rest into
 * `other`, whose values are sums (the stack draws them on top of each
 * other). `none` never folds; a null cap never folds.
 */
export function foldSegments(
  ordered: readonly string[],
  totals: ReadonlyMap<string, Tally>,
  cap: number | null,
): FoldedSegments {
  const named = ordered.filter((key) => key !== NONE_KEY);
  const hasNone = ordered.includes(NONE_KEY);
  const { kept, hidden } =
    cap === null
      ? { kept: [...named], hidden: 0 }
      : topByValue(named, (key) => totals.get(key)?.value ?? 0, cap);

  const keptSet = new Set(kept);
  const target = new Map<string, string>();
  const folded: Tally = { value: 0, taskCount: 0 };
  const result = new Map<string, Tally>();
  for (const key of named) {
    const tally = totals.get(key) ?? { value: 0, taskCount: 0 };
    if (keptSet.has(key)) {
      target.set(key, key);
      result.set(key, tally);
    } else {
      target.set(key, OTHER_KEY);
      folded.value += tally.value;
      folded.taskCount += tally.taskCount;
    }
  }
  if (hasNone) {
    target.set(NONE_KEY, NONE_KEY);
    result.set(NONE_KEY, totals.get(NONE_KEY) ?? { value: 0, taskCount: 0 });
  }
  if (hidden > 0) result.set(OTHER_KEY, folded);
  return {
    keys: [
      ...kept,
      ...(hidden > 0 ? [OTHER_KEY] : []),
      ...(hasNone ? [NONE_KEY] : []),
    ],
    totals: result,
    target,
    hidden,
  };
}

/** D11 over one bucket's (or the whole set's) group cells. */
function groupProgress(
  cellOf: (group: string) => number,
  visible: number,
): number {
  return progressPercent({
    completed: cellOf("completed"),
    cancelled: cellOf("cancelled"),
    visible,
  });
}

type XKeys = { keys: string[]; hidden: number };

function shapeXKeys(
  aggregate: ChartAggregate,
  options: ShapeOptions,
  present: string[],
): XKeys {
  const { xAxis, lookup, dateBucket } = options;
  const info = dimensionInfo(xAxis);
  if (isDateDimension(xAxis)) {
    const dated = present.filter((key) => key !== NONE_KEY);
    const filled = fillDateKeys(dated, dateBucket, info.xCap ?? dated.length);
    return {
      keys: [...filled.keys, ...(present.includes(NONE_KEY) ? [NONE_KEY] : [])],
      hidden: filled.hidden,
    };
  }
  const ordered = naturalOrder(xAxis, present, lookup);
  if (info.xCap === null) return { keys: ordered, hidden: 0 };
  const { kept, hidden } = topByValue(
    ordered,
    (key) => aggregate.buckets.get(key)?.value ?? 0,
    info.xCap,
  );
  return { keys: kept, hidden };
}

/** The chart response body's data part, from one aggregate. */
export function shapeChart(
  aggregate: ChartAggregate,
  options: ShapeOptions,
): ShapedChart {
  const { xAxis, segment, includeNone, lookup, dateBucket } = options;
  const keepKey = (key: string) => includeNone || key !== NONE_KEY;

  const noneCount =
    includeNone || !dimensionInfo(xAxis).hasNone
      ? null
      : (aggregate.buckets.get(NONE_KEY)?.taskCount ?? 0);

  const x = shapeXKeys(
    aggregate,
    options,
    [...aggregate.buckets.keys()].filter(keepKey),
  );

  const folded = segment
    ? foldSegments(
        segmentOrder(
          segment,
          [...aggregate.segments.keys()].filter(keepKey),
          lookup,
        ),
        aggregate.segments,
        dimensionInfo(segment).segmentCap,
      )
    : null;

  const buckets = x.keys.map((key): ShapedBucket => {
    const tally = aggregate.buckets.get(key) ?? { value: 0, taskCount: 0 };
    const bucket: ShapedBucket = {
      key,
      value: round2(tally.value),
      taskCount: tally.taskCount,
      progress: null,
    };
    if (folded) {
      const sums = new Map<string, number>();
      for (const [cellKey, value] of aggregate.cells.get(key) ?? []) {
        const target = folded.target.get(cellKey);
        if (target !== undefined) {
          sums.set(target, (sums.get(target) ?? 0) + value);
        }
      }
      const cells: Record<string, number> = {};
      for (const segmentKey of folded.keys) {
        const value = sums.get(segmentKey) ?? 0;
        if (value !== 0) cells[segmentKey] = round2(value);
      }
      bucket.cells = cells;
      if (segment === "group") {
        bucket.progress = groupProgress(
          (group) => sums.get(group) ?? 0,
          tally.value,
        );
      }
    }
    if (isDateDimension(xAxis) && key !== NONE_KEY) {
      bucket.rangeStart = key;
      bucket.rangeEnd = bucketEnd(key, dateBucket);
    }
    return bucket;
  });

  const segments = folded
    ? folded.keys.map((key) => {
        const tally = folded.totals.get(key) ?? { value: 0, taskCount: 0 };
        return { key, value: round2(tally.value), taskCount: tally.taskCount };
      })
    : [];

  let progress: number | null = null;
  if (segment === "group") {
    progress = groupProgress(
      (group) => aggregate.segments.get(group)?.value ?? 0,
      aggregate.total.value,
    );
  } else if (xAxis === "group") {
    progress = groupProgress(
      (group) => aggregate.buckets.get(group)?.value ?? 0,
      aggregate.total.value,
    );
  }

  return {
    buckets,
    segments,
    truncated: {
      x: x.hidden > 0,
      hiddenXCount: x.hidden,
      segment: (folded?.hidden ?? 0) > 0,
      hiddenSegmentCount: folded?.hidden ?? 0,
    },
    noneCount,
    progress,
  };
}
