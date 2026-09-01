import type { LucideIcon } from "lucide-react";
import { ChevronRight, Ruler } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "../lib/cn";

/*
 * Planning pieces, modelled on the app's cycles, modules and estimates:
 * the progress ring, the stacked group bar, the burn chart, the estimate
 * chip, tone badges, cards and the collapsible section bar.
 */

/** The app's 16px progress ring (stroke animates on change). */
export function ProgressRing({
  percent,
  size = 16,
  strokeWidth = 2,
}: {
  percent: number;
  size?: number;
  strokeWidth?: number;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset =
    circumference * (1 - Math.min(Math.max(percent, 0), 100) / 100);
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      className="shrink-0 -rotate-90"
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        className="text-border"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        className={cn(
          "transition-[stroke-dashoffset] duration-500 motion-reduce:transition-none",
          percent >= 100 ? "text-success-foreground" : "text-primary",
        )}
      />
    </svg>
  );
}

export type GroupCounts = {
  completed: number;
  started: number;
  unstarted: number;
  backlog: number;
};

const SEGMENTS: { id: keyof GroupCounts; className: string }[] = [
  { id: "completed", className: "bg-success" },
  { id: "started", className: "bg-warning" },
  { id: "unstarted", className: "bg-info" },
  { id: "backlog", className: "bg-muted-foreground/40" },
];

/** Work by column group as one stacked bar, like cycles and modules. */
export function GroupProgressBar({
  counts,
  className,
}: {
  counts: GroupCounts;
  className?: string;
}) {
  const scope =
    counts.completed + counts.started + counts.unstarted + counts.backlog;
  return (
    <div
      aria-hidden
      className={cn(
        "flex h-2 min-w-0 flex-1 gap-0.5 overflow-hidden rounded-full bg-muted",
        className,
      )}
    >
      {scope > 0 &&
        SEGMENTS.filter((segment) => counts[segment.id] > 0).map((segment) => (
          <div
            key={segment.id}
            className={cn(
              "h-full transition-[width] duration-500 first:rounded-l-full last:rounded-r-full motion-reduce:transition-none",
              segment.className,
            )}
            style={{ width: `${(counts[segment.id] / scope) * 100}%` }}
          />
        ))}
    </div>
  );
}

/**
 * A burn-down in plain SVG: the remaining work per day against the dashed
 * ideal line. `drawn` reveals the line with a stroke animation, so the
 * chart draws itself when it first shows.
 */
export function BurnChart({
  remaining,
  scope,
  days,
  width,
  height,
  drawn = true,
  startLabel,
  endLabel,
  labels,
}: {
  /** Remaining work for each elapsed day, today last. */
  remaining: readonly number[];
  scope: number;
  /** Days in the whole range. */
  days: number;
  width: number;
  height: number;
  drawn?: boolean;
  startLabel: ReactNode;
  endLabel: ReactNode;
  labels: { actual: ReactNode; reference: ReactNode };
}) {
  const padding = { top: 8, right: 8, bottom: 20, left: 24 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const xFor = (index: number) =>
    padding.left + (plotWidth * index) / Math.max(days - 1, 1);
  const yFor = (value: number) =>
    padding.top + plotHeight * (1 - value / Math.max(scope, 1));
  const ticks = [0, Math.round(scope / 3), Math.round((scope * 2) / 3), scope];
  const actual = remaining
    .map(
      (value, index) =>
        `${index === 0 ? "M" : "L"}${xFor(index).toFixed(1)},${yFor(value).toFixed(1)}`,
    )
    .join(" ");
  const lastIndex = remaining.length - 1;
  const area = `${actual} L${xFor(lastIndex).toFixed(1)},${yFor(0).toFixed(1)} L${xFor(0).toFixed(1)},${yFor(0).toFixed(1)} Z`;
  const today = xFor(lastIndex);

  return (
    <div className="w-full">
      <svg
        aria-hidden="true"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="block overflow-visible"
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={padding.left}
              x2={width - padding.right}
              y1={yFor(tick)}
              y2={yFor(tick)}
              className="stroke-border"
              strokeWidth={1}
            />
            <text
              x={padding.left - 6}
              y={yFor(tick)}
              textAnchor="end"
              dominantBaseline="middle"
              className="fill-muted-foreground text-[10px]"
            >
              {tick}
            </text>
          </g>
        ))}
        <text
          x={padding.left}
          y={height - 4}
          className="fill-muted-foreground text-[10px]"
        >
          {startLabel}
        </text>
        <text
          x={width - padding.right}
          y={height - 4}
          textAnchor="end"
          className="fill-muted-foreground text-[10px]"
        >
          {endLabel}
        </text>
        <line
          x1={today}
          x2={today}
          y1={padding.top}
          y2={height - padding.bottom}
          className="stroke-muted-foreground/60"
          strokeDasharray="2 3"
          strokeWidth={1}
        />
        <path
          d={`M${xFor(0)},${yFor(scope)} L${xFor(days - 1)},${yFor(0)}`}
          fill="none"
          stroke="currentColor"
          strokeWidth={1}
          strokeDasharray="4 4"
          className="text-muted-foreground"
        />
        <g className="text-chart-2">
          <path
            d={area}
            fill="currentColor"
            className={cn(
              "transition-[opacity,d] delay-700 duration-500 motion-reduce:transition-none",
              drawn ? "opacity-10" : "opacity-0",
            )}
          />
          <path
            d={actual}
            pathLength={1}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            strokeDasharray="1"
            strokeDashoffset={drawn ? 0 : 1}
            className="transition-[stroke-dashoffset,d] duration-[1400ms] ease-out motion-reduce:transition-none"
          />
          <circle
            cx={today}
            cy={yFor(remaining[lastIndex] ?? 0)}
            r={3.5}
            fill="currentColor"
            className={cn(
              "stroke-background transition-[cy,opacity] duration-500 motion-reduce:transition-none",
              drawn ? "opacity-100 delay-1000" : "opacity-0",
            )}
            strokeWidth={2}
          />
        </g>
      </svg>
      <div className="mt-2 flex flex-wrap items-center gap-3 text-muted-foreground text-xs">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="h-0.5 w-3 rounded-full bg-chart-2" />
          {labels.actual}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            className="w-3 border-muted-foreground border-t border-dashed"
          />
          {labels.reference}
        </span>
      </div>
    </div>
  );
}

/** A task's estimate chip: the ruler and the value, like the board card. */
export function EstimateChip({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1 rounded border border-border/70 bg-muted/55 px-1.5 font-medium text-[10px] text-muted-foreground",
        className,
      )}
    >
      <Ruler aria-hidden className="size-3" />
      <span className="max-w-20 truncate">{children}</span>
    </span>
  );
}

const TONES = {
  info: "bg-info/8 text-info-foreground dark:bg-info/16",
  success: "bg-success/8 text-success-foreground dark:bg-success/16",
  warning: "bg-warning/8 text-warning-foreground dark:bg-warning/16",
  error: "bg-destructive/8 text-destructive-foreground dark:bg-destructive/16",
  outline: "border-input bg-background text-foreground dark:bg-input/32",
  secondary: "bg-secondary text-secondary-foreground",
} as const;

export type BadgeTone = keyof typeof TONES;

/** The app's small badge in one of its tones. */
export function ToneBadge({
  tone,
  icon: Icon,
  children,
  className,
}: {
  tone: BadgeTone;
  icon?: LucideIcon;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-4.5 shrink-0 items-center justify-center gap-1 whitespace-nowrap rounded-sm border border-transparent px-1 font-medium text-xs",
        TONES[tone],
        className,
      )}
    >
      {Icon && <Icon aria-hidden className="size-3 opacity-80" />}
      {children}
    </span>
  );
}

/** The app's card surface. */
export function ReplicaCard({
  className,
  children,
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      {...props}
      className={cn(
        "relative flex flex-col rounded-2xl border bg-card text-card-foreground shadow-xs/5",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** A planning list's group bar: chevron, icon, overline title, count. */
export function SectionBar({
  icon: Icon,
  title,
  count,
  open = true,
  className,
}: {
  icon?: LucideIcon;
  title: ReactNode;
  count?: number;
  open?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex h-8 shrink-0 items-center border-border/50 border-b bg-muted px-3",
        className,
      )}
    >
      <span className="flex items-center gap-1.5 font-semibold text-[11px] text-muted-foreground uppercase tracking-wide">
        <ChevronRight
          aria-hidden
          className={cn("size-3 transition-transform", open && "rotate-90")}
        />
        {Icon && <Icon aria-hidden className="size-3.5 shrink-0" />}
        <span>{title}</span>
        {count !== undefined && (
          <span className="font-medium tabular-nums">{count}</span>
        )}
      </span>
    </div>
  );
}
