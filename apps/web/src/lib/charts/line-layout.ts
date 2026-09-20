// Pure geometry for line charts over an ordered x (dates or periods). The
// SVG component in components/charts/line-chart.tsx renders it.

import type { PlotRect } from "./bar-layout";
import { linearScale } from "./scale";

export type LineLayoutSeries = {
  key: string;
  /** One value per x position; null leaves a gap in the line. */
  values: readonly (number | null)[];
};

export type LinePoint = {
  index: number;
  x: number;
  y: number;
  value: number;
};

export type LineSeriesLayout = {
  key: string;
  /** Path data; each run of non-null values starts with its own `M`. */
  path: string;
  /** One entry per x position, null where the value is null. */
  points: (LinePoint | null)[];
  /** Points with no neighbor on either side: a path can't show them. */
  isolated: LinePoint[];
  /** The last non-null point, where a direct label goes. */
  end: LinePoint | null;
};

export type LineLayout = {
  /** The crosshair x of each position. */
  positions: number[];
  /** Each position's hover target: the span closer to it than to a neighbor. */
  hits: Array<{ x: number; width: number }>;
  series: LineSeriesLayout[];
  valueToPixel: (value: number) => number;
};

const round2 = (value: number) => Math.round(value * 100) / 100;

export function buildLineLayout({
  count,
  series,
  plot,
  valueMax,
}: {
  count: number;
  series: readonly LineLayoutSeries[];
  plot: PlotRect;
  valueMax: number;
}): LineLayout {
  const top = valueMax > 0 ? valueMax : 1;
  const valueToPixel = linearScale([0, top], [plot.y + plot.height, plot.y]);
  const slot = count > 1 ? plot.width / (count - 1) : plot.width;
  const xFor = (index: number) =>
    round2(count > 1 ? plot.x + index * slot : plot.x + plot.width / 2);

  const positions = Array.from({ length: count }, (_, index) => xFor(index));
  const hits = positions.map((x) => {
    const left = Math.max(plot.x, x - slot / 2);
    const right = Math.min(plot.x + plot.width, x + slot / 2);
    return { x: round2(left), width: round2(Math.max(right - left, 1)) };
  });

  const layoutSeries = series.map((line): LineSeriesLayout => {
    const points = positions.map((x, index): LinePoint | null => {
      const value = line.values[index];
      if (value === null || value === undefined || !Number.isFinite(value)) {
        return null;
      }
      return { index, x, y: round2(valueToPixel(value)), value };
    });

    const commands: string[] = [];
    const isolated: LinePoint[] = [];
    points.forEach((point, index) => {
      if (!point) return;
      const previous = points[index - 1] ?? null;
      const next = points[index + 1] ?? null;
      commands.push(`${previous ? "L" : "M"}${point.x} ${point.y}`);
      if (!previous && !next) isolated.push(point);
    });

    let end: LinePoint | null = null;
    for (let index = points.length - 1; index >= 0; index -= 1) {
      if (points[index]) {
        end = points[index];
        break;
      }
    }

    return { key: line.key, path: commands.join(""), points, isolated, end };
  });

  return { positions, hits, series: layoutSeries, valueToPixel };
}

/**
 * Pushes label positions apart so neighbors are at least `minGap` apart,
 * moving as little as possible and staying within [min, max]. Returns the
 * new positions in the input order.
 */
export function nudgeLabels(
  positions: readonly number[],
  {
    minGap = 12,
    min = Number.NEGATIVE_INFINITY,
    max = Number.POSITIVE_INFINITY,
  }: { minGap?: number; min?: number; max?: number } = {},
): number[] {
  const order = positions
    .map((value, index) => ({ value, index }))
    .sort((a, b) => a.value - b.value || a.index - b.index);
  const placed = order.map((item) => Math.min(Math.max(item.value, min), max));

  for (let index = 1; index < placed.length; index += 1) {
    placed[index] = Math.max(placed[index], placed[index - 1] + minGap);
  }
  const last = placed.length - 1;
  if (last >= 0 && placed[last] > max) {
    placed[last] = max;
    for (let index = last - 1; index >= 0; index -= 1) {
      placed[index] = Math.min(placed[index], placed[index + 1] - minGap);
    }
  }

  const result = new Array<number>(positions.length);
  order.forEach((item, rank) => {
    result[item.index] = round2(placed[rank]);
  });
  return result;
}
