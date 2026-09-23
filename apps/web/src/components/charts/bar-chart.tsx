import { type KeyboardEvent, type ReactNode, useState } from "react";
import { useElementSize } from "@/hooks/use-element-size";
import {
  type BarLayoutDatum,
  type BarOrientation,
  barDomainMax,
  buildBarLayout,
  labelStride,
  type PlotRect,
  visibleLabelIndexes,
} from "@/lib/charts/bar-layout";
import { chartIndexOf, chartKeyTarget } from "@/lib/charts/navigation";
import { allIntegers, niceTicks } from "@/lib/charts/scale";
import {
  type ChartColor,
  fillStyle,
  SINGLE_SERIES_COLOR,
} from "@/lib/charts/series-colors";
import { cn } from "@/lib/cn";
import { formatNumber } from "@/lib/format";
import ChartLegend, { type ChartSeries } from "./chart-legend";
import ChartTooltip, {
  ChartAnnouncer,
  type ChartReadout,
  type ChartTooltipRow,
} from "./chart-tooltip";

export type BarChartDatum = BarLayoutDatum & {
  /** Plain bars only: this bucket's identity color (group, priority, label). */
  color?: ChartColor;
};

export type BarChartReferenceLine = { value: number; label: string };

type BarChartProps = {
  /** Buckets in display order. */
  data: readonly BarChartDatum[];
  /**
   * Stacked: the segments, in legend order (from the baseline outwards).
   * Plain: one entry that names the metric and gives the default color.
   */
  series: readonly ChartSeries[];
  orientation?: BarOrientation;
  stacked?: boolean;
  valueFormatter?: (value: number) => string;
  /** Vertical charts: the chart height in pixels. */
  height?: number;
  /** Horizontal charts: the height of one category row. */
  rowHeight?: number;
  /** A category's display, e.g. an avatar and a name. Keep it inline so it truncates. */
  categoryLabel: (key: string) => ReactNode;
  /** The tooltip header; defaults to the category label (date buckets pass their range). */
  tooltipTitle?: (key: string) => ReactNode;
  /** A dashed line across the bars, e.g. an average. */
  referenceLine?: BarChartReferenceLine;
  /** The screen-reader summary of the chart. */
  ariaLabel: string;
  /** Stacked charts: the label of the tooltip's distinct total row. */
  totalLabel?: string;
  /** Vertical charts: the room one category label needs; labels thin out to fit. */
  categoryLabelWidth?: number;
  showLegend?: boolean;
  className?: string;
};

// About one 11 px glyph, to estimate the room axis and value labels need.
const CHAR_WIDTH = 6.5;
const AXIS_GAP = 6;
// A 12 px bar plus its 20% of air; narrower bands scroll instead.
const MIN_VERTICAL_STEP = 15;
const HORIZONTAL_BAR_THICKNESS = 16;
const MAX_DIRECT_LABELS = 20;

const defaultFormatter = (value: number) => formatNumber(value);

function positive(value: number | undefined) {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : 0;
}

function ReferenceLine({
  line,
  plot,
  position,
  vertical,
}: {
  line: BarChartReferenceLine;
  plot: PlotRect;
  position: number;
  vertical: boolean;
}) {
  return (
    <g data-chart-reference className="pointer-events-none">
      {vertical ? (
        <line
          x1={plot.x}
          x2={plot.x + plot.width}
          y1={position}
          y2={position}
          className="stroke-muted-foreground"
          strokeDasharray="4 3"
          strokeWidth={1}
        />
      ) : (
        <line
          x1={position}
          x2={position}
          y1={plot.y - 4}
          y2={plot.y + plot.height}
          className="stroke-muted-foreground"
          strokeDasharray="4 3"
          strokeWidth={1}
        />
      )}
      <text
        x={vertical ? plot.x + plot.width : position}
        y={vertical ? position - 4 : plot.y - 7}
        textAnchor={vertical ? "end" : "middle"}
        paintOrder="stroke"
        strokeWidth={3}
        className="fill-muted-foreground stroke-background text-[11px]"
      >
        {line.label}
      </text>
    </g>
  );
}

/**
 * Vertical or horizontal bars, plain or stacked, in plain SVG sized to its
 * container. One tab stop: arrow keys move between buckets and show the
 * same tooltip as hover.
 */
export default function BarChart({
  data,
  series,
  orientation = "vertical",
  stacked = false,
  valueFormatter = defaultFormatter,
  height = 240,
  rowHeight = 28,
  categoryLabel,
  tooltipTitle,
  referenceLine,
  ariaLabel,
  totalLabel,
  categoryLabelWidth = 56,
  showLegend = true,
  className,
}: BarChartProps) {
  const { ref, width } = useElementSize();
  const [active, setActive] = useState<number | null>(null);
  const vertical = orientation === "vertical";
  const seriesKeys = series.map((item) => item.key);
  const seriesColors = new Map(series.map((item) => [item.key, item.color]));

  const plottedValues = data.flatMap((datum) =>
    stacked
      ? seriesKeys.map((key) => positive(datum.cells?.[key]))
      : [datum.value],
  );
  if (referenceLine) plottedValues.push(referenceLine.value);
  const ticks = niceTicks(
    Math.max(
      barDomainMax(data, seriesKeys, stacked),
      referenceLine?.value ?? 0,
    ),
    { integer: allIntegers(plottedValues) },
  );
  const valueMax = ticks[ticks.length - 1];
  const tickLabels = ticks.map(valueFormatter);
  const showValueLabels =
    !vertical && data.length > 0 && data.length <= MAX_DIRECT_LABELS;
  const top = referenceLine ? 18 : 8;

  let svgWidth = width;
  let svgHeight = height;
  let labelColumn = 0;
  let plot: PlotRect;
  if (vertical) {
    const longestTick = Math.max(...tickLabels.map((label) => label.length));
    const left = Math.ceil(longestTick * CHAR_WIDTH) + AXIS_GAP + 2;
    const right = 8;
    svgWidth = Math.max(width, left + right + data.length * MIN_VERTICAL_STEP);
    plot = {
      x: left,
      y: top,
      width: svgWidth - left - right,
      height: Math.max(height - top - 24, 1),
    };
  } else {
    labelColumn = Math.min(Math.round(width * 0.4), 200);
    const longestValue = Math.max(
      0,
      ...data.map((datum) => valueFormatter(datum.value).length),
    );
    const valueRoom = showValueLabels
      ? Math.ceil(longestValue * CHAR_WIDTH) + AXIS_GAP + 4
      : 12;
    const left = labelColumn + 8;
    plot = {
      x: left,
      y: top,
      width: Math.max(width - left - valueRoom, 1),
      height: data.length * rowHeight,
    };
    svgHeight = top + plot.height + 22;
  }

  const layout = buildBarLayout({
    data,
    seriesKeys,
    stacked,
    orientation,
    plot,
    valueMax,
    maxThickness: vertical ? 24 : HORIZONTAL_BAR_THICKNESS,
  });
  const labelIndexes = vertical
    ? visibleLabelIndexes(
        data.length,
        labelStride(layout.step, categoryLabelWidth),
      )
    : [];
  const labelBoxWidth = vertical
    ? Math.max(
        layout.step * labelStride(layout.step, categoryLabelWidth) - 4,
        0,
      )
    : 0;

  const colorOf = (datum: BarChartDatum, seriesKey: string): ChartColor =>
    stacked
      ? (seriesColors.get(seriesKey) ?? SINGLE_SERIES_COLOR)
      : (datum.color ?? series[0]?.color ?? SINGLE_SERIES_COLOR);

  if (data.length === 0) return null;

  const activeBand = active === null ? null : (layout.bands[active] ?? null);
  const activeDatum = activeBand ? data[activeBand.index] : null;
  let readout: ChartReadout | null = null;
  if (activeBand && activeDatum) {
    const rows: ChartTooltipRow[] = stacked
      ? series.flatMap((item) => {
          const value = positive(activeDatum.cells?.[item.key]);
          return value > 0
            ? [
                {
                  key: item.key,
                  label: item.label,
                  value: valueFormatter(value),
                  color: item.color,
                },
              ]
            : [];
        })
      : [
          {
            key: "value",
            label: series[0]?.label ?? "",
            value: valueFormatter(activeDatum.value),
            color: colorOf(activeDatum, ""),
          },
        ];
    readout = {
      title: tooltipTitle
        ? tooltipTitle(activeBand.key)
        : categoryLabel(activeBand.key),
      rows,
      total:
        stacked && totalLabel
          ? { label: totalLabel, value: valueFormatter(activeDatum.value) }
          : undefined,
    };
  }

  const onKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    const next = chartKeyTarget(
      event.key,
      active,
      data.length,
      vertical ? "horizontal" : "vertical",
    );
    if (next === undefined) return;
    event.preventDefault();
    setActive(next);
  };

  return (
    <div ref={ref} className={cn("w-full", className)}>
      <div className={cn("w-full", svgWidth > width && "overflow-x-auto")}>
        <div
          className="relative"
          style={{ width: svgWidth, height: svgHeight }}
        >
          <svg
            role="img"
            aria-label={ariaLabel}
            // biome-ignore lint/a11y/noNoninteractiveTabindex: the chart is one tab stop; arrow keys move between its buckets
            tabIndex={0}
            width={svgWidth}
            height={svgHeight}
            viewBox={`0 0 ${svgWidth} ${svgHeight}`}
            className="block overflow-visible rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-ring/50 focus-visible:outline-offset-2"
            onKeyDown={onKeyDown}
            onFocus={() => setActive((current) => current ?? 0)}
            onBlur={() => setActive(null)}
            onMouseMove={(event) => setActive(chartIndexOf(event.target))}
            onMouseLeave={() => setActive(null)}
          >
            {ticks.map((tick, index) => {
              const position = Math.round(layout.valueToPixel(tick)) + 0.5;
              return (
                <g key={tick}>
                  {vertical ? (
                    <line
                      x1={plot.x}
                      x2={plot.x + plot.width}
                      y1={position}
                      y2={position}
                      className="stroke-border"
                      strokeWidth={1}
                    />
                  ) : (
                    <line
                      x1={position}
                      x2={position}
                      y1={plot.y}
                      y2={plot.y + plot.height}
                      className="stroke-border"
                      strokeWidth={1}
                    />
                  )}
                  <text
                    x={vertical ? plot.x - AXIS_GAP : position}
                    y={vertical ? position : plot.y + plot.height + 14}
                    textAnchor={vertical ? "end" : "middle"}
                    dominantBaseline={vertical ? "middle" : undefined}
                    className="fill-muted-foreground text-[11px] tabular-nums"
                  >
                    {tickLabels[index]}
                  </text>
                </g>
              );
            })}

            {layout.bands.map((band) => {
              const datum = data[band.index];
              return (
                <g
                  key={band.key}
                  data-chart-band={band.key}
                  data-chart-index={band.index}
                >
                  <rect
                    x={band.hit.x}
                    y={band.hit.y}
                    width={Math.max(band.hit.width, 0)}
                    height={Math.max(band.hit.height, 0)}
                    className={cn(
                      "fill-muted opacity-0 transition-opacity duration-150 motion-reduce:transition-none",
                      band.index === active && "opacity-100",
                    )}
                  />
                  {band.segments.map((segment) => {
                    const color = colorOf(datum, segment.seriesKey);
                    return (
                      <path
                        key={segment.seriesKey}
                        d={segment.path}
                        data-chart-segment={segment.seriesKey}
                        className={color.fill}
                        style={fillStyle(color)}
                      />
                    );
                  })}
                  {showValueLabels && (
                    <text
                      data-chart-value-label
                      x={band.end + AXIS_GAP}
                      y={band.center}
                      dominantBaseline="middle"
                      className="fill-foreground text-[11px] tabular-nums"
                    >
                      {valueFormatter(datum.value)}
                    </text>
                  )}
                </g>
              );
            })}

            {referenceLine && (
              <ReferenceLine
                line={referenceLine}
                plot={plot}
                position={layout.valueToPixel(referenceLine.value)}
                vertical={vertical}
              />
            )}
          </svg>

          <div aria-hidden className="pointer-events-none">
            {vertical
              ? labelIndexes.map((index) => {
                  const band = layout.bands[index];
                  return (
                    <div
                      key={band.key}
                      className="absolute truncate text-center text-[11px] text-muted-foreground"
                      style={{
                        left: band.center - labelBoxWidth / 2,
                        top: plot.y + plot.height + 5,
                        width: labelBoxWidth,
                      }}
                    >
                      {categoryLabel(band.key)}
                    </div>
                  );
                })
              : layout.bands.map((band) => (
                  <div
                    key={band.key}
                    className="absolute left-0 flex items-center pr-2 text-xs"
                    style={{
                      top: band.hit.y,
                      height: band.hit.height,
                      width: labelColumn,
                    }}
                  >
                    <div className="min-w-0 truncate">
                      {categoryLabel(band.key)}
                    </div>
                  </div>
                ))}
          </div>

          {activeBand && readout && (
            <ChartTooltip
              readout={readout}
              // Beside a column, above (or below) a row: the readout never
              // covers the bar it describes.
              anchor={
                vertical
                  ? { x: activeBand.center, y: activeBand.end }
                  : {
                      x: activeBand.end,
                      y: activeBand.hit.y,
                      below: activeBand.hit.y + activeBand.hit.height,
                    }
              }
              placement={vertical ? "side" : "above"}
              offset={vertical ? layout.thickness / 2 + 6 : 2}
              bounds={{ width: svgWidth, height: svgHeight }}
            />
          )}
          <ChartAnnouncer readout={readout} />
        </div>
      </div>

      {showLegend && stacked && <ChartLegend items={series} className="mt-3" />}
    </div>
  );
}
