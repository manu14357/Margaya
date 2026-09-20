// A pure geometry model for burn-down and burn-up charts (cycles, and later
// modules and analytics). The SVG component in components/charts renders it.

export type BurnChartDay = {
  date: string;
  /** Tasks left on that day; null for future days. */
  remaining: number | null;
  /** Tasks done by that day; null for future days. */
  completed: number | null;
  /** The straight line from scope down to zero. */
  ideal: number;
};

export type BurnChartMode = "burndown" | "burnup";

export type BurnChartPadding = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export const DEFAULT_BURN_CHART_PADDING: BurnChartPadding = {
  top: 8,
  right: 8,
  bottom: 20,
  left: 28,
};

export type BurnChartPoint = {
  index: number;
  date: string;
  x: number;
  /** The actual series value; null on future days. */
  actual: number | null;
  reference: number;
};

export type BurnChartModel = {
  width: number;
  height: number;
  padding: BurnChartPadding;
  yMax: number;
  baselineY: number;
  xFor: (index: number) => number;
  yFor: (value: number) => number;
  points: BurnChartPoint[];
  actualPath: string;
  areaPath: string;
  referencePath: string;
  yTicks: number[];
  xTicks: Array<{ index: number; date: string }>;
  todayIndex: number | null;
};

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Burn-down plots `remaining` against the ideal line; burn-up plots
 * `completed` against a flat scope line. Null values start a new path
 * segment, so gaps stay visible.
 */
export function buildBurnChartModel({
  days,
  scope,
  mode,
  width,
  height,
  today,
  padding = DEFAULT_BURN_CHART_PADDING,
}: {
  days: readonly BurnChartDay[];
  scope: number;
  mode: BurnChartMode;
  width: number;
  height: number;
  today?: string | null;
  padding?: BurnChartPadding;
}): BurnChartModel {
  const plotWidth = Math.max(0, width - padding.left - padding.right);
  const plotHeight = Math.max(0, height - padding.top - padding.bottom);
  const n = days.length;

  const actualOf = (day: BurnChartDay) =>
    mode === "burndown" ? day.remaining : day.completed;
  const referenceOf = (day: BurnChartDay) =>
    mode === "burndown" ? day.ideal : scope;

  const yMax = Math.max(
    1,
    scope,
    ...days.map((day) => actualOf(day) ?? 0),
    ...days.map((day) => referenceOf(day)),
  );

  const xFor = (index: number) =>
    round(
      n <= 1
        ? padding.left + plotWidth / 2
        : padding.left + (index * plotWidth) / (n - 1),
    );
  const yFor = (value: number) =>
    round(padding.top + plotHeight * (1 - value / yMax));
  const baselineY = yFor(0);

  const points = days.map((day, index) => ({
    index,
    date: day.date,
    x: xFor(index),
    actual: actualOf(day),
    reference: referenceOf(day),
  }));

  let actualPath = "";
  let areaPath = "";
  let segment: BurnChartPoint[] = [];
  const closeSegment = () => {
    if (segment.length === 0) return;
    const first = segment[0];
    const last = segment[segment.length - 1];
    areaPath += `M${first.x} ${baselineY}`;
    for (const point of segment) {
      areaPath += ` L${point.x} ${yFor(point.actual ?? 0)}`;
    }
    areaPath += ` L${last.x} ${baselineY} Z`;
    segment = [];
  };
  for (const point of points) {
    if (point.actual === null) {
      closeSegment();
      continue;
    }
    const command = segment.length === 0 ? "M" : "L";
    actualPath += `${actualPath ? " " : ""}${command}${point.x} ${yFor(point.actual)}`;
    segment.push(point);
  }
  closeSegment();

  const referencePath = points
    .map(
      (point, index) =>
        `${index === 0 ? "M" : "L"}${point.x} ${yFor(point.reference)}`,
    )
    .join(" ");

  const yTicks = [...new Set([0, Math.ceil(yMax / 2), Math.ceil(yMax)])];

  const tickIndexes =
    n <= 7
      ? days.map((_, index) => index)
      : [...new Set([0, Math.floor((n - 1) / 2), n - 1])];
  const xTicks = tickIndexes.map((index) => ({
    index,
    date: days[index].date,
  }));

  const todayPosition = today
    ? days.findIndex((day) => day.date === today)
    : -1;

  return {
    width,
    height,
    padding,
    yMax,
    baselineY,
    xFor,
    yFor,
    points,
    actualPath,
    areaPath,
    referencePath,
    yTicks,
    xTicks,
    todayIndex: todayPosition === -1 ? null : todayPosition,
  };
}
