import type { CSSProperties } from "react";
import { cn } from "@/lib/cn";
import { resolveLabelColor } from "@/lib/label-color";

type ChipLabel = { id: string; name: string; color: string };

/**
 * One label as a chip tinted from its own colour. Label colours are user
 * data (any hex), so the text stays `foreground` for contrast; the hue lives
 * in the dot, the border and a soft wash.
 */
export function LabelChip({
  label,
  className,
}: {
  label: ChipLabel;
  className?: string;
}) {
  const color = resolveLabelColor(label.color);
  return (
    <span
      className={cn(
        "inline-flex h-5 min-w-0 max-w-40 items-center gap-1 rounded-full border px-1.5 font-medium text-[10px] text-foreground",
        className,
      )}
      style={
        {
          backgroundColor: `color-mix(in srgb, ${color} 12%, var(--card))`,
          borderColor: `color-mix(in srgb, ${color} 38%, transparent)`,
        } as CSSProperties
      }
    >
      <span
        aria-hidden
        className="size-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: color }}
      />
      <span className="min-w-0 truncate" title={label.name}>
        {label.name}
      </span>
    </span>
  );
}

/** A row of label chips; renders nothing without labels. */
export function LabelChips({
  labels,
  max,
  className,
}: {
  labels: readonly ChipLabel[];
  /** Show at most this many, then `+N`. */
  max?: number;
  className?: string;
}) {
  if (!labels.length) return null;
  const shown = max === undefined ? labels : labels.slice(0, max);
  const extra = labels.length - shown.length;
  return (
    <span className={cn("flex min-w-0 flex-wrap gap-1", className)}>
      {shown.map((label) => (
        <LabelChip key={label.id} label={label} />
      ))}
      {extra > 0 && (
        <span className="inline-flex h-5 items-center rounded-full border border-border bg-muted px-1.5 font-medium text-[10px] text-muted-foreground tabular-nums">
          +{extra}
        </span>
      )}
    </span>
  );
}
