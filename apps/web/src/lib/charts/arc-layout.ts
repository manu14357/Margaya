// Pure geometry for donut charts. Angles are radians, clockwise from
// 12 o'clock. The SVG component in components/charts/donut-chart.tsx
// renders it.

export type ArcDatum = { key: string; value: number };

export type Arc = {
  key: string;
  index: number;
  value: number;
  /** The slice's share of the full turn, before the gap is taken out. */
  startAngle: number;
  endAngle: number;
  /** The drawn outer edge, after half the gap is taken from each side. */
  outerStart: number;
  outerEnd: number;
  /** Path data; empty when the slice is too thin to draw beside its gaps. */
  path: string;
};

export type ArcLayout = {
  total: number;
  /** Slices with a value above 0, in input order. */
  arcs: Arc[];
  /** Whole percentages for every input slice, summing to 100 (0 each when empty). */
  percents: number[];
  center: number;
  outerRadius: number;
  innerRadius: number;
};

export const FULL_TURN = Math.PI * 2;

const round2 = (value: number) => Math.round(value * 100) / 100;

function positive(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Whole percentages that sum to exactly 100: each share is rounded down,
 * and the points left over go to the largest remainders (ties: the larger
 * value, then the earlier slice). All zeros when the total is 0.
 */
export function largestRemainderPercents(values: readonly number[]): number[] {
  const clean = values.map(positive);
  const total = clean.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return clean.map(() => 0);

  const exact = clean.map((value) => (value / total) * 100);
  const floors = exact.map((value) => Math.floor(value + 1e-9));
  let left = 100 - floors.reduce((sum, value) => sum + value, 0);
  const byRemainder = exact
    .map((value, index) => ({ index, remainder: value - floors[index] }))
    .sort(
      (a, b) =>
        b.remainder - a.remainder ||
        clean[b.index] - clean[a.index] ||
        a.index - b.index,
    );
  for (const { index } of byRemainder) {
    if (left <= 0) break;
    floors[index] += 1;
    left -= 1;
  }
  return floors;
}

function polar(center: number, radius: number, angle: number) {
  return `${round2(center + radius * Math.sin(angle))} ${round2(center - radius * Math.cos(angle))}`;
}

function ringPath(center: number, outer: number, inner: number) {
  const circle = (radius: number, sweep: 0 | 1) =>
    `M${polar(center, radius, 0)}A${radius} ${radius} 0 1 ${sweep} ${polar(center, radius, Math.PI)}A${radius} ${radius} 0 1 ${sweep} ${polar(center, radius, 0)}Z`;
  // The inner circle runs the other way, so it cuts a hole under any fill rule.
  return `${circle(round2(outer), 1)}${circle(round2(inner), 0)}`;
}

/**
 * Donut slices for a square of `size` pixels. The inner radius is
 * `innerRatio` of the outer one, and neighbors are separated by `gap`
 * pixels of surface (the same width at both radii). A lone slice draws a
 * full ring; a zero total draws nothing.
 */
export function buildArcLayout(
  slices: readonly ArcDatum[],
  {
    size,
    innerRatio = 0.6,
    gap = 2,
  }: { size: number; innerRatio?: number; gap?: number },
): ArcLayout {
  const center = size / 2;
  const outerRadius = size / 2;
  const innerRadius = outerRadius * innerRatio;
  const values = slices.map((slice) => positive(slice.value));
  const total = values.reduce((sum, value) => sum + value, 0);
  const percents = largestRemainderPercents(values);
  const layout = { total, percents, center, outerRadius, innerRadius };
  if (total <= 0) return { ...layout, arcs: [] };

  const drawn = slices
    .map((slice, index) => ({ key: slice.key, index, value: values[index] }))
    .filter((slice) => slice.value > 0);

  if (drawn.length === 1) {
    const [only] = drawn;
    return {
      ...layout,
      arcs: [
        {
          ...only,
          startAngle: 0,
          endAngle: FULL_TURN,
          outerStart: 0,
          outerEnd: FULL_TURN,
          path: ringPath(center, outerRadius, innerRadius),
        },
      ],
    };
  }

  const outerTrim = gap / 2 / outerRadius;
  const innerTrim = innerRadius > 0 ? gap / 2 / innerRadius : 0;
  let cursor = 0;
  const arcs = drawn.map((slice): Arc => {
    const startAngle = cursor;
    const endAngle = cursor + (slice.value / total) * FULL_TURN;
    cursor = endAngle;

    const outerStart = startAngle + outerTrim;
    const outerEnd = endAngle - outerTrim;
    let innerStart = startAngle + innerTrim;
    let innerEnd = endAngle - innerTrim;
    if (innerEnd < innerStart) {
      innerStart = (startAngle + endAngle) / 2;
      innerEnd = innerStart;
    }

    let path = "";
    if (outerEnd > outerStart) {
      const outerLarge = outerEnd - outerStart > Math.PI ? 1 : 0;
      const innerLarge = innerEnd - innerStart > Math.PI ? 1 : 0;
      const r = round2(outerRadius);
      const ri = round2(innerRadius);
      path = `M${polar(center, outerRadius, outerStart)}A${r} ${r} 0 ${outerLarge} 1 ${polar(center, outerRadius, outerEnd)}L${polar(center, innerRadius, innerEnd)}`;
      if (innerEnd > innerStart) {
        path += `A${ri} ${ri} 0 ${innerLarge} 0 ${polar(center, innerRadius, innerStart)}`;
      }
      path += "Z";
    }

    return { ...slice, startAngle, endAngle, outerStart, outerEnd, path };
  });

  return { ...layout, arcs };
}
