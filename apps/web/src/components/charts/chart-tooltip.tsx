import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import type { ChartColor } from "@/lib/charts/series-colors";
import { ChartSwatch, type ChartSwatchShape } from "./chart-legend";

export type ChartTooltipRow = {
  key: string;
  label: ReactNode;
  value: string;
  color?: ChartColor;
};

/**
 * Where the tooltip points. `below` is the lower edge of the marked area
 * (e.g. a bar row), used when an "above" tooltip flips down, so it never
 * covers what it describes.
 */
type Anchor = { x: number; y: number; below?: number };
type Size = { width: number; height: number };

export type ChartTooltipPlacement = "above" | "side";

const OFFSET = 8;

/**
 * Where the tooltip goes inside its chart container. "above" centers it
 * over the anchor and flips below when there is no room; "side" puts it to
 * the right and flips left. Both are clamped to the container.
 */
export function placeTooltip({
  anchor,
  size,
  bounds,
  placement,
  offset = OFFSET,
}: {
  anchor: Anchor;
  size: Size;
  bounds: Size;
  placement: ChartTooltipPlacement;
  offset?: number;
}): { left: number; top: number } {
  const clamp = (value: number, max: number) =>
    Math.max(0, Math.min(value, Math.max(0, max)));

  if (placement === "side") {
    const right = anchor.x + offset;
    const left =
      right + size.width <= bounds.width
        ? right
        : anchor.x - offset - size.width;
    return {
      left: clamp(left, bounds.width - size.width),
      top: clamp(anchor.y - size.height / 2, bounds.height - size.height),
    };
  }

  const above = anchor.y - offset - size.height;
  const top = above >= 0 ? above : (anchor.below ?? anchor.y) + offset;
  return {
    left: clamp(anchor.x - size.width / 2, bounds.width - size.width),
    top: Math.max(0, top),
  };
}

/** What a chart shows for its active bucket. */
export type ChartReadout = {
  title: ReactNode;
  rows: readonly ChartTooltipRow[];
  /** A stacked bucket's distinct total, shown under the rows. */
  total?: { label: ReactNode; value: string };
};

function ReadoutBody({
  readout,
  swatch,
}: {
  readout: ChartReadout;
  swatch?: ChartSwatchShape;
}) {
  return (
    <>
      <div className="mb-0.5 truncate font-medium">{readout.title}</div>
      {readout.rows.length > 0 && (
        <ul className="space-y-0.5">
          {readout.rows.map((row) => (
            <li key={row.key} className="flex items-center gap-2">
              {swatch && row.color && (
                <ChartSwatch color={row.color} shape={swatch} />
              )}
              <span className="min-w-0 flex-1 truncate text-muted-foreground">
                {row.label}
              </span>
              <span className="font-medium tabular-nums">{row.value}</span>
            </li>
          ))}
        </ul>
      )}
      {readout.total && (
        <div className="mt-1 flex items-center gap-2 border-t pt-1">
          <span className="min-w-0 flex-1 truncate text-muted-foreground">
            {readout.total.label}
          </span>
          <span className="font-medium tabular-nums">
            {readout.total.value}
          </span>
        </div>
      )}
    </>
  );
}

/**
 * A screen-reader-only live region with the active readout. Keep it mounted
 * while the chart is (a live region inserted with its content is often not
 * announced), so moving between buckets with the keyboard is read out.
 */
export function ChartAnnouncer({ readout }: { readout: ChartReadout | null }) {
  return (
    <div role="status" className="sr-only">
      {readout && <ReadoutBody readout={readout} />}
    </div>
  );
}

type ChartTooltipProps = {
  readout: ChartReadout;
  anchor: Anchor;
  /** The chart container's size, which the tooltip stays inside. */
  bounds: Size;
  placement?: ChartTooltipPlacement;
  /** Distance from the anchor, e.g. half a bar's width plus air. */
  offset?: number;
  swatch?: ChartSwatchShape;
};

/**
 * The visual hover and focus readout of a chart, positioned absolutely
 * inside the chart container (which must be `relative`). Screen readers get
 * the same content from `ChartAnnouncer`, so this copy is hidden from them.
 */
export default function ChartTooltip({
  readout,
  anchor,
  bounds,
  placement = "above",
  offset = OFFSET,
  swatch = "square",
}: ChartTooltipProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });

  // Re-measure after every render: the content changes with the anchor.
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const next = { width: element.offsetWidth, height: element.offsetHeight };
    setSize((current) =>
      current.width === next.width && current.height === next.height
        ? current
        : next,
    );
  });

  const position = placeTooltip({ anchor, size, bounds, placement, offset });

  return (
    <div
      ref={ref}
      aria-hidden
      data-slot="chart-tooltip"
      className="pointer-events-none absolute z-10 min-w-32 max-w-64 rounded-md border bg-popover px-2 py-1 text-popover-foreground text-xs shadow-md/5"
      style={{ left: position.left, top: position.top }}
    >
      <ReadoutBody readout={readout} swatch={swatch} />
    </div>
  );
}
