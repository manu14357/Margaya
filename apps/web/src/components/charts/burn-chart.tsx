import { parseISO } from "date-fns";
import { useMemo, useState } from "react";
import { useElementSize } from "@/hooks/use-element-size";
import {
  type BurnChartDay,
  type BurnChartMode,
  buildBurnChartModel,
} from "@/lib/charts/burn-chart-model";
import { cn } from "@/lib/cn";
import { formatDateMedium, formatDateShort } from "@/lib/format";

type BurnChartProps = {
  days: readonly BurnChartDay[];
  scope: number;
  mode: BurnChartMode;
  /** The server's today (YYYY-MM-DD); marked when inside the range. */
  today?: string | null;
  height?: number;
  /** A sentence describing the chart for screen readers. */
  ariaLabel: string;
  labels: { actual: string; reference: string };
  /** Formats axis and tooltip values, e.g. minutes as durations. */
  formatValue?: (value: number) => string;
  className?: string;
};

function tickLabel(date: string) {
  return formatDateShort(parseISO(date));
}

/**
 * A burn-down (remaining vs. ideal) or burn-up (completed vs. scope) chart in
 * plain SVG. Each day is a focusable hit area that shows a tooltip.
 */
export default function BurnChart({
  days,
  scope,
  mode,
  today,
  height = 200,
  ariaLabel,
  labels,
  formatValue,
  className,
}: BurnChartProps) {
  const { ref, width } = useElementSize();
  const [active, setActive] = useState<number | null>(null);

  const model = useMemo(
    () => buildBurnChartModel({ days, scope, mode, width, height, today }),
    [days, scope, mode, width, height, today],
  );
  const { padding, points } = model;
  const plotBottom = height - padding.bottom;
  const slotWidth =
    points.length > 1
      ? (width - padding.left - padding.right) / (points.length - 1)
      : width - padding.left - padding.right;
  const activePoint = active === null ? null : points[active];
  const formatActual = (value: number | null) =>
    value === null ? "–" : formatValue ? formatValue(value) : String(value);
  const formatReference = (value: number, precision: number) =>
    formatValue
      ? formatValue(value)
      : String(Math.round(value * precision) / precision);

  return (
    <div className={cn("w-full", className)}>
      <div ref={ref} className="relative w-full">
        <svg
          role="img"
          aria-label={ariaLabel}
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          className="block max-w-full overflow-visible"
        >
          {model.yTicks.map((tick) => (
            <g key={`y-${tick}`}>
              <line
                x1={padding.left}
                x2={width - padding.right}
                y1={model.yFor(tick)}
                y2={model.yFor(tick)}
                className="stroke-border"
                strokeWidth={1}
              />
              <text
                x={padding.left - 6}
                y={model.yFor(tick)}
                textAnchor="end"
                dominantBaseline="middle"
                className="fill-muted-foreground text-[10px]"
              >
                {formatValue ? formatValue(tick) : tick}
              </text>
            </g>
          ))}

          {model.xTicks.map((tick) => (
            <text
              key={`x-${tick.index}`}
              x={model.xFor(tick.index)}
              y={height - 4}
              textAnchor={
                points.length > 1 && tick.index === 0
                  ? "start"
                  : points.length > 1 && tick.index === points.length - 1
                    ? "end"
                    : "middle"
              }
              className="fill-muted-foreground text-[10px]"
            >
              {tickLabel(tick.date)}
            </text>
          ))}

          {model.todayIndex !== null && (
            <line
              x1={model.xFor(model.todayIndex)}
              x2={model.xFor(model.todayIndex)}
              y1={padding.top}
              y2={plotBottom}
              className="stroke-muted-foreground/60"
              strokeDasharray="2 3"
              strokeWidth={1}
            />
          )}

          <path
            d={model.referencePath}
            fill="none"
            stroke="currentColor"
            strokeWidth={1}
            strokeDasharray="4 4"
            className="text-muted-foreground"
          />

          <g className="text-chart-2">
            <path d={model.areaPath} fill="currentColor" fillOpacity={0.1} />
            <path
              d={model.actualPath}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
              className="transition-[d] duration-300 motion-reduce:transition-none"
            />
            {activePoint && activePoint.actual !== null && (
              <circle
                cx={activePoint.x}
                cy={model.yFor(activePoint.actual)}
                r={4}
                fill="currentColor"
                className="stroke-background"
                strokeWidth={2}
              />
            )}
          </g>

          {points.map((point) => (
            // biome-ignore lint/a11y/useSemanticElements: an SVG hit area has no HTML equivalent
            <rect
              key={point.date}
              role="button"
              tabIndex={0}
              aria-label={`${formatDateMedium(parseISO(point.date))}: ${labels.actual} ${formatActual(point.actual)}, ${labels.reference} ${formatReference(point.reference, 100)}`}
              x={point.x - slotWidth / 2}
              y={padding.top}
              width={Math.max(slotWidth, 1)}
              height={Math.max(plotBottom - padding.top, 1)}
              fill="transparent"
              className="cursor-default outline-none focus-visible:fill-accent/40"
              onMouseEnter={() => setActive(point.index)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(point.index)}
              onBlur={() => setActive(null)}
            />
          ))}
        </svg>

        {activePoint && (
          <div
            role="status"
            className="pointer-events-none absolute z-10 min-w-28 -translate-x-1/2 rounded-md border bg-popover px-2 py-1 text-popover-foreground text-xs shadow-md/5"
            style={{
              left: Math.min(Math.max(activePoint.x, 56), width - 56),
              top: 0,
            }}
          >
            <p className="font-medium">
              {formatDateMedium(parseISO(activePoint.date))}
            </p>
            <p className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">{labels.actual}</span>
              <span className="tabular-nums">
                {formatActual(activePoint.actual)}
              </span>
            </p>
            <p className="flex items-center justify-between gap-3">
              <span className="text-muted-foreground">{labels.reference}</span>
              <span className="tabular-nums">
                {formatReference(activePoint.reference, 10)}
              </span>
            </p>
          </div>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-3 text-muted-foreground text-xs">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-0.5 w-3 rounded-full bg-chart-2" aria-hidden />
          {labels.actual}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="w-3 border-muted-foreground border-t border-dashed"
            aria-hidden
          />
          {labels.reference}
        </span>
      </div>
    </div>
  );
}
