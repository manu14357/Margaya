import { type KeyboardEvent, type ReactNode, useState } from "react";
import { buildArcLayout } from "@/lib/charts/arc-layout";
import { chartIndexOf, chartKeyTarget } from "@/lib/charts/navigation";
import { fillStyle } from "@/lib/charts/series-colors";
import { cn } from "@/lib/cn";
import { formatNumber } from "@/lib/format";
import { type ChartSeries, ChartSwatch } from "./chart-legend";
import { ChartAnnouncer } from "./chart-tooltip";

export type DonutSlice = ChartSeries & { value: number };

type DonutChartProps = {
  /** Slices in legend order, drawn clockwise from 12 o'clock. */
  slices: readonly DonutSlice[];
  /** Shown in the hole, e.g. "12 tasks". */
  centerLabel?: ReactNode;
  /** The donut's width and height in pixels. */
  size?: number;
  /** The screen-reader summary of the chart. */
  ariaLabel: string;
  /** Shown in the hole of the empty ring when every value is 0. */
  emptyLabel?: ReactNode;
  valueFormatter?: (value: number) => string;
  /** Formats a whole-number share for the legend and tooltip. */
  percentFormatter?: (percent: number) => string;
  className?: string;
};

const defaultFormatter = (value: number) => formatNumber(value);
const defaultPercent = (percent: number) => `${percent}%`;

/**
 * A donut with its legend beside it (below it in a narrow container). The
 * legend lists every slice's value and share, with shares that sum to 100.
 * A zero total draws an empty ring and `emptyLabel`.
 */
export default function DonutChart({
  slices,
  centerLabel,
  size = 180,
  ariaLabel,
  emptyLabel,
  valueFormatter = defaultFormatter,
  percentFormatter = defaultPercent,
  className,
}: DonutChartProps) {
  const [active, setActive] = useState<number | null>(null);
  const layout = buildArcLayout(slices, { size });
  const empty = layout.arcs.length === 0;
  const activeArc = active === null ? null : (layout.arcs[active] ?? null);
  const activeSlice = activeArc ? slices[activeArc.index] : null;

  const onKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
    const next = chartKeyTarget(event.key, active, layout.arcs.length, "both");
    if (next === undefined) return;
    event.preventDefault();
    setActive(next);
  };

  return (
    <div className={cn("@container w-full", className)}>
      <div className="flex flex-col items-center gap-4 @sm:flex-row">
        <div
          className="relative shrink-0"
          style={{ width: size, height: size }}
        >
          <svg
            role="img"
            aria-label={ariaLabel}
            // One tab stop: arrow keys move between the slices.
            tabIndex={empty ? undefined : 0}
            width={size}
            height={size}
            viewBox={`0 0 ${size} ${size}`}
            className="block overflow-visible rounded-full outline-none focus-visible:outline-2 focus-visible:outline-ring/50 focus-visible:outline-offset-2"
            onKeyDown={onKeyDown}
            onFocus={() =>
              setActive((current) => current ?? (empty ? null : 0))
            }
            onBlur={() => setActive(null)}
            onMouseMove={(event) => setActive(chartIndexOf(event.target))}
            onMouseLeave={() => setActive(null)}
          >
            {empty ? (
              <circle
                data-chart-empty-ring
                cx={layout.center}
                cy={layout.center}
                r={(layout.outerRadius + layout.innerRadius) / 2}
                fill="none"
                strokeWidth={layout.outerRadius - layout.innerRadius}
                className="stroke-border"
              />
            ) : (
              layout.arcs.map((arc, arcIndex) => {
                const { color } = slices[arc.index];
                return (
                  <path
                    key={arc.key}
                    data-chart-slice={arc.key}
                    d={arc.path}
                    className={cn(
                      color.fill,
                      "transition-opacity duration-150 motion-reduce:transition-none",
                      activeArc && activeArc.key !== arc.key && "opacity-40",
                    )}
                    style={fillStyle(color)}
                    data-chart-index={arcIndex}
                  />
                );
              })
            )}
          </svg>

          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center p-[22%] text-center font-medium text-sm">
            {empty ? (
              <span className="text-muted-foreground">{emptyLabel}</span>
            ) : (
              centerLabel
            )}
          </div>

          {/* The highlighted legend row is the visual readout; a floating
              tooltip would cover the hole's label. */}
          <ChartAnnouncer
            readout={
              activeArc && activeSlice
                ? {
                    title: activeSlice.label,
                    rows: [
                      {
                        key: activeSlice.key,
                        label: percentFormatter(
                          layout.percents[activeArc.index],
                        ),
                        value: valueFormatter(activeSlice.value),
                      },
                    ],
                  }
                : null
            }
          />
        </div>

        {!empty && (
          <ul className="w-full min-w-0 space-y-0.5 text-xs @sm:flex-1">
            {slices.map((slice, index) => (
              <li
                key={slice.key}
                data-chart-legend-row={slice.key}
                className={cn(
                  "flex items-center gap-2 rounded-sm px-1.5 py-1",
                  activeSlice?.key === slice.key && "bg-accent",
                )}
              >
                <ChartSwatch color={slice.color} />
                <span className="min-w-0 flex-1 truncate">{slice.label}</span>
                <span className="tabular-nums">
                  {valueFormatter(slice.value)}
                </span>
                <span className="w-10 text-right text-muted-foreground tabular-nums">
                  {percentFormatter(layout.percents[index])}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
