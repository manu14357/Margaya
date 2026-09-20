// Pure geometry for bar charts, vertical or horizontal, plain or stacked.
// The SVG component in components/charts/bar-chart.tsx renders it.

import { bandScale, linearScale } from "./scale";

export type BarOrientation = "vertical" | "horizontal";

export type BarLayoutDatum = {
  key: string;
  /** The bucket's own value; for a stack, the distinct total. */
  value: number;
  /** Stacked charts: the value of each series in this bucket. */
  cells?: Readonly<Record<string, number>>;
};

export type PlotRect = { x: number; y: number; width: number; height: number };

export type BarSegment = {
  seriesKey: string;
  value: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** The outermost segment: its data end is rounded, every other edge square. */
  rounded: boolean;
  path: string;
};

export type BarBand = {
  key: string;
  index: number;
  value: number;
  /** The drawn length: the value, or the sum of the cells when stacked. */
  total: number;
  /** The whole slot: the hover target, larger than the bar. */
  hit: PlotRect;
  /** The band's middle along the category axis. */
  center: number;
  /** The bar's data end along the value axis (the baseline when empty). */
  end: number;
  /** Empty for a zero value: the band keeps its slot but draws nothing. */
  segments: BarSegment[];
};

export type BarLayout = {
  orientation: BarOrientation;
  bands: BarBand[];
  /** Distance between neighboring bands. */
  step: number;
  /** The drawn bar thickness. */
  thickness: number;
  /** Value to pixel along the value axis. */
  valueToPixel: (value: number) => number;
};

export const BAR_GAP = 2;
export const BAR_RADIUS = 4;

const round2 = (value: number) => Math.round(value * 100) / 100;

function positive(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : 0;
}

/** The drawn length of a bucket: its value, or the sum of its cells when stacked. */
export function barTotal(
  datum: BarLayoutDatum,
  seriesKeys: readonly string[],
  stacked: boolean,
): number {
  if (!stacked) return positive(datum.value);
  let sum = 0;
  for (const key of seriesKeys) sum += positive(datum.cells?.[key]);
  return sum;
}

/** The largest drawn length, for the value axis. */
export function barDomainMax(
  data: readonly BarLayoutDatum[],
  seriesKeys: readonly string[],
  stacked: boolean,
): number {
  let max = 0;
  for (const datum of data) {
    max = Math.max(max, barTotal(datum, seriesKeys, stacked));
  }
  return max;
}

/** The bucket with the largest value (the first one on a tie), for summaries. */
export function highestBar<T extends BarLayoutDatum>(
  data: readonly T[],
): T | null {
  let best: T | null = null;
  for (const datum of data) {
    if (best === null || datum.value > best.value) best = datum;
  }
  return best;
}

/** A rectangle as path data. */
export function rectPath(x: number, y: number, width: number, height: number) {
  const [x0, y0, x1, y1] = [x, y, x + width, y + height].map(round2);
  return `M${x0} ${y0}H${x1}V${y1}H${x0}Z`;
}

/**
 * A rectangle whose data end is rounded: the top for vertical bars, the
 * right end for horizontal ones. The baseline corners stay square.
 */
export function roundedBarPath(
  x: number,
  y: number,
  width: number,
  height: number,
  orientation: BarOrientation,
  radius = BAR_RADIUS,
) {
  if (width <= 0 || height <= 0) return "";
  const r = round2(
    orientation === "vertical"
      ? Math.min(radius, width / 2, height)
      : Math.min(radius, height / 2, width),
  );
  if (r <= 0) return rectPath(x, y, width, height);
  const [x0, y0, x1, y1] = [x, y, x + width, y + height].map(round2);
  if (orientation === "vertical") {
    return `M${x0} ${y1}V${round2(y0 + r)}A${r} ${r} 0 0 1 ${round2(x0 + r)} ${y0}H${round2(x1 - r)}A${r} ${r} 0 0 1 ${x1} ${round2(y0 + r)}V${y1}Z`;
  }
  return `M${x0} ${y0}H${round2(x1 - r)}A${r} ${r} 0 0 1 ${x1} ${round2(y0 + r)}V${round2(y1 - r)}A${r} ${r} 0 0 1 ${round2(x1 - r)} ${y1}H${x0}Z`;
}

/**
 * Bars and stacked segments. Categories run along x (vertical) or y
 * (horizontal) in data order; values grow from 0 at the baseline. Stacks go
 * from the baseline outwards in `seriesKeys` order (the legend order), with
 * a `gap` of surface between neighbors.
 */
export function buildBarLayout({
  data,
  seriesKeys,
  stacked,
  orientation,
  plot,
  valueMax,
  maxThickness = 24,
  gap = BAR_GAP,
  radius = BAR_RADIUS,
  paddingInner = 0.2,
}: {
  data: readonly BarLayoutDatum[];
  seriesKeys: readonly string[];
  stacked: boolean;
  orientation: BarOrientation;
  plot: PlotRect;
  valueMax: number;
  maxThickness?: number;
  gap?: number;
  radius?: number;
  paddingInner?: number;
}): BarLayout {
  const vertical = orientation === "vertical";
  const top = valueMax > 0 ? valueMax : 1;
  const valueToPixel = vertical
    ? linearScale([0, top], [plot.y + plot.height, plot.y])
    : linearScale([0, top], [plot.x, plot.x + plot.width]);
  const base = valueToPixel(0);
  const lengthOf = (value: number) => Math.abs(valueToPixel(value) - base);

  const bands = bandScale(
    data.length,
    vertical ? [plot.x, plot.x + plot.width] : [plot.y, plot.y + plot.height],
    paddingInner,
  );
  const thickness = Math.max(0, Math.min(bands.bandwidth, maxThickness));

  const layoutBands = data.map((datum, index): BarBand => {
    const center = bands.center(index);
    const barStart = center - thickness / 2;
    const parts = stacked
      ? seriesKeys
          .map((key) => ({ key, value: positive(datum.cells?.[key]) }))
          .filter((part) => part.value > 0)
      : positive(datum.value) > 0
        ? [{ key: seriesKeys[0] ?? "value", value: positive(datum.value) }]
        : [];

    let cumulative = 0;
    const segments = parts.map((part, partIndex): BarSegment => {
      const isFirst = partIndex === 0;
      const isLast = partIndex === parts.length - 1;
      const from = lengthOf(cumulative) + (isFirst ? 0 : gap / 2);
      cumulative += part.value;
      const to = lengthOf(cumulative) - (isLast ? 0 : gap / 2);
      // A value too small for its share of the gap still shows as a sliver.
      const length = Math.max(to - from, 1);
      const rect = vertical
        ? {
            x: barStart,
            y: base - from - length,
            width: thickness,
            height: length,
          }
        : { x: base + from, y: barStart, width: length, height: thickness };
      return {
        seriesKey: part.key,
        value: part.value,
        x: round2(rect.x),
        y: round2(rect.y),
        width: round2(rect.width),
        height: round2(rect.height),
        rounded: isLast,
        path: isLast
          ? roundedBarPath(
              rect.x,
              rect.y,
              rect.width,
              rect.height,
              orientation,
              radius,
            )
          : rectPath(rect.x, rect.y, rect.width, rect.height),
      };
    });

    const total = barTotal(datum, seriesKeys, stacked);
    const slotStart = bands.slotStart(index);
    return {
      key: datum.key,
      index,
      value: datum.value,
      total,
      hit: vertical
        ? { x: slotStart, y: plot.y, width: bands.step, height: plot.height }
        : { x: plot.x, y: slotStart, width: plot.width, height: bands.step },
      center: round2(center),
      end: round2(valueToPixel(total)),
      segments,
    };
  });

  return {
    orientation,
    bands: layoutBands,
    step: bands.step,
    thickness,
    valueToPixel,
  };
}

/**
 * Show every k-th category label, so labels of `labelWidth` never overlap
 * on bands `step` apart (keeping at least `minGap` between them).
 */
export function labelStride(step: number, labelWidth: number, minGap = 4) {
  if (step <= 0) return 1;
  return Math.max(1, Math.ceil((labelWidth + minGap) / step));
}

/** The indexes of the labels to show with a stride from `labelStride`. */
export function visibleLabelIndexes(count: number, stride: number): number[] {
  const indexes: number[] = [];
  for (let index = 0; index < count; index += Math.max(1, stride)) {
    indexes.push(index);
  }
  return indexes;
}
