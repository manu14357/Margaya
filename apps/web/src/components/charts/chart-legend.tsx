import type { ReactNode } from "react";
import { type ChartColor, swatchStyle } from "@/lib/charts/series-colors";
import { cn } from "@/lib/cn";

/** A series as the charts take it: identity key, display label and color. */
export type ChartSeries = {
  key: string;
  label: string;
  color: ChartColor;
};

export type ChartSwatchShape = "square" | "line";

/**
 * The colored mark beside a series label: a square for bars and slices, a
 * short line for lines. Text beside it stays in text tokens.
 */
export function ChartSwatch({
  color,
  shape = "square",
  className,
}: {
  color: ChartColor;
  shape?: ChartSwatchShape;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block shrink-0",
        shape === "square" ? "size-2 rounded-[2px]" : "h-0.5 w-3 rounded-full",
        color.swatch,
        className,
      )}
      style={swatchStyle(color)}
    />
  );
}

type ChartLegendProps = {
  items: ReadonlyArray<{ key: string; label: ReactNode; color: ChartColor }>;
  shape?: ChartSwatchShape;
  className?: string;
};

/**
 * Swatch and label rows that wrap. Renders nothing for a single series: the
 * section title already names it.
 */
export default function ChartLegend({
  items,
  shape = "square",
  className,
}: ChartLegendProps) {
  if (items.length < 2) return null;
  return (
    <ul
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground text-xs",
        className,
      )}
    >
      {items.map((item) => (
        <li key={item.key} className="inline-flex min-w-0 items-center gap-1.5">
          <ChartSwatch color={item.color} shape={shape} />
          <span className="truncate">{item.label}</span>
        </li>
      ))}
    </ul>
  );
}
