import { type KeyboardEvent, type ReactNode, useState } from "react";
import { useElementSize } from "@/hooks/use-element-size";
import { labelStride, visibleLabelIndexes } from "@/lib/charts/bar-layout";
import { buildLineLayout, nudgeLabels } from "@/lib/charts/line-layout";
import { chartIndexOf, chartKeyTarget } from "@/lib/charts/navigation";
import { allIntegers, niceTicks } from "@/lib/charts/scale";
import { fillStyle, strokeStyle } from "@/lib/charts/series-colors";
import { cn } from "@/lib/cn";
import { formatNumber } from "@/lib/format";
import ChartLegend, { type ChartSeries } from "./chart-legend";
import ChartTooltip, {
  ChartAnnouncer,
  type ChartReadout,
} from "./chart-tooltip";

export type LineChartSeries = ChartSeries & {
  /** One value per x label; null leaves a gap in the line. */
  values: readonly (number | null)[];
};

type LineChartProps = {
  /** The x positions' display labels, in order (e.g. formatted periods). */
  labels: readonly string[];
  series: readonly LineChartSeries[];
  valueFormatter?: (value: number) => string;
  height?: number;
  /** The screen-reader summary of the chart. */
  ariaLabel: string;
  /** The tooltip header for a position; defaults to its label (dates pass their range). */
  tooltipTitle?: (index: number) => ReactNode;
  showLegend?: boolean;
  className?: string;
};

// About one 11 px glyph, to estimate the room axis and end labels need.
const CHAR_WIDTH = 6.5;
const AXIS_GAP = 6;
const MAX_DIRECT_LABELS = 4;
const MIN_WIDTH_FOR_DIRECT_LABELS = 360;

const defaultFormatter = (value: number) => formatNumber(value);

function fitText(text: string, room: number) {
  const maxChars = Math.max(1, Math.floor(room / CHAR_WIDTH));
  return text.length <= maxChars ? text : `${text.slice(0, maxChars - 1)}…`;
}

/**
 * Lines over an ordered x in plain SVG sized to its container. Hovering or
 * focusing a position shows a crosshair, a marker on every series and one
 * tooltip listing them all. Two to four series are also labeled at their
 * line ends.
 */
export default function LineChart({
  labels,
  series,
  valueFormatter = defaultFormatter,
  height = 220,
  ariaLabel,
  tooltipTitle,
  showLegend = true,
  className,
}: LineChartProps) {
  const { ref, width } = useElementSize();
  const [active, setActive] = useState<number | null>(null);
  const count = labels.length;

  const values = series.flatMap((line) =>
    line.values.filter(
      (value): value is number => value !== null && Number.isFinite(value),
    ),
  );
  const ticks = niceTicks(Math.max(0, ...values), {
    integer: allIntegers(values),
  });
  const valueMax = ticks[ticks.length - 1];
  const tickLabels = ticks.map(valueFormatter);

  const directLabels =
    series.length >= 2 &&
    series.length <= MAX_DIRECT_LABELS &&
    width >= MIN_WIDTH_FOR_DIRECT_LABELS;
  const longestSeriesLabel = Math.max(
    0,
    ...series.map((line) => line.label.length),
  );
  const right = directLabels
    ? Math.min(
        Math.ceil(longestSeriesLabel * CHAR_WIDTH) + AXIS_GAP + 8,
        Math.round(width * 0.3),
      )
    : 12;
  const longestTick = Math.max(...tickLabels.map((label) => label.length));
  const left = Math.ceil(longestTick * CHAR_WIDTH) + AXIS_GAP + 2;
  const plot = {
    x: left,
    y: 8,
    width: Math.max(width - left - right, 1),
    height: Math.max(height - 8 - 24, 1),
  };

  const layout = buildLineLayout({ count, series, plot, valueMax });
  const step = count > 1 ? plot.width / (count - 1) : plot.width;
  const longestLabel = Math.max(0, ...labels.map((label) => label.length));
  const xLabelIndexes = visibleLabelIndexes(
    count,
    labelStride(step, longestLabel * CHAR_WIDTH, 8),
  );

  const ends = layout.series.map((line) => line.end);
  const endLabelY = nudgeLabels(
    ends.map((end) => end?.y ?? plot.y + plot.height),
    { minGap: 12, min: plot.y, max: plot.y + plot.height },
  );

  if (count === 0) return null;

  const activeIndex = active !== null && active < count ? active : null;
  const activePoints =
    activeIndex === null
      ? []
      : layout.series.flatMap((line) => {
          const point = line.points[activeIndex];
          return point ? [point] : [];
        });
  const readout: ChartReadout | null =
    activeIndex === null
      ? null
      : {
          title: tooltipTitle ? tooltipTitle(activeIndex) : labels[activeIndex],
          // One readout, every series: the pointer never has to hit a line.
          rows: series.map((line) => {
            const value = line.values[activeIndex];
            return {
              key: line.key,
              label: line.label,
              value:
                value === null || value === undefined
                  ? "–"
                  : valueFormatter(value),
              color: line.color,
            };
          }),
        };

  const onKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    const next = chartKeyTarget(event.key, active, count, "horizontal");
    if (next === undefined) return;
    event.preventDefault();
    setActive(next);
  };

  return (
    <div ref={ref} className={cn("w-full", className)}>
      <div className="relative" style={{ height }}>
        <svg
          role="img"
          aria-label={ariaLabel}
          // biome-ignore lint/a11y/noNoninteractiveTabindex: the chart is one tab stop; arrow keys move between its positions
          tabIndex={0}
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          className="block overflow-visible rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-ring/50 focus-visible:outline-offset-2"
          onKeyDown={onKeyDown}
          onFocus={() => setActive((current) => current ?? 0)}
          onBlur={() => setActive(null)}
          onMouseMove={(event) => setActive(chartIndexOf(event.target))}
          onMouseLeave={() => setActive(null)}
        >
          {ticks.map((tick, index) => {
            const y = Math.round(layout.valueToPixel(tick)) + 0.5;
            return (
              <g key={tick}>
                <line
                  x1={plot.x}
                  x2={plot.x + plot.width}
                  y1={y}
                  y2={y}
                  className="stroke-border"
                  strokeWidth={1}
                />
                <text
                  x={plot.x - AXIS_GAP}
                  y={y}
                  textAnchor="end"
                  dominantBaseline="middle"
                  className="fill-muted-foreground text-[11px] tabular-nums"
                >
                  {tickLabels[index]}
                </text>
              </g>
            );
          })}

          {xLabelIndexes.map((index) => (
            <text
              key={`x-${index}`}
              x={layout.positions[index]}
              y={plot.y + plot.height + 16}
              textAnchor="middle"
              className="fill-muted-foreground text-[11px]"
            >
              {labels[index]}
            </text>
          ))}

          {activeIndex !== null && (
            <line
              data-chart-crosshair
              x1={layout.positions[activeIndex]}
              x2={layout.positions[activeIndex]}
              y1={plot.y}
              y2={plot.y + plot.height}
              className="stroke-muted-foreground/60"
              strokeWidth={1}
            />
          )}

          {layout.series.map((line, seriesIndex) => {
            const { color } = series[seriesIndex];
            return (
              <g key={line.key} data-chart-series={line.key}>
                <path
                  d={line.path}
                  fill="none"
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                  className={color.stroke}
                  style={strokeStyle(color)}
                />
                {line.isolated.map((point) => (
                  <circle
                    key={point.index}
                    cx={point.x}
                    cy={point.y}
                    r={3}
                    className={color.fill}
                    style={fillStyle(color)}
                  />
                ))}
                {activeIndex !== null && line.points[activeIndex] && (
                  <circle
                    data-chart-marker
                    cx={line.points[activeIndex].x}
                    cy={line.points[activeIndex].y}
                    r={4}
                    strokeWidth={2}
                    className={cn("stroke-background", color.fill)}
                    style={fillStyle(color)}
                  />
                )}
                {directLabels && line.end && (
                  <text
                    data-chart-end-label
                    x={line.end.x + AXIS_GAP}
                    y={endLabelY[seriesIndex]}
                    dominantBaseline="middle"
                    className="fill-foreground text-[11px]"
                  >
                    {fitText(
                      series[seriesIndex].label,
                      plot.x + plot.width + right - line.end.x - AXIS_GAP,
                    )}
                  </text>
                )}
              </g>
            );
          })}

          {layout.hits.map((hit, index) => (
            <rect
              key={hit.x}
              data-chart-index={index}
              x={hit.x}
              y={plot.y}
              width={hit.width}
              height={plot.height}
              fill="transparent"
            />
          ))}
        </svg>

        {activeIndex !== null && readout && (
          <ChartTooltip
            readout={readout}
            anchor={{
              x: layout.positions[activeIndex],
              y: activePoints.length
                ? Math.min(...activePoints.map((point) => point.y))
                : plot.y + plot.height / 2,
            }}
            bounds={{ width, height }}
            placement="side"
            swatch="line"
          />
        )}
        <ChartAnnouncer readout={readout} />
      </div>

      {showLegend && (
        <ChartLegend items={series} shape="line" className="mt-3" />
      )}
    </div>
  );
}
