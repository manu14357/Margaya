import {
  ChevronDown,
  ChevronsUp,
  ChevronUp,
  CircleAlert,
  type LucideIcon,
  Minus,
} from "lucide-react";
import type { CSSProperties, JSX } from "react";
import { cn } from "@/lib/cn";
import { columnGroupOf } from "@/lib/column-groups";

/**
 * The colour a schedule bar or chip takes from its task's column, using the
 * semantic status palette (`styles/semantic-colors.css`). "review" is the hue
 * for every started column after the first (e.g. In review), so two started
 * columns stay distinguishable.
 */
export type StatusTone =
  | "backlog"
  | "unstarted"
  | "started"
  | "review"
  | "completed"
  | "cancelled";

export type ToneInfo = {
  tone: StatusTone;
  /** The column's own colour, when it has one; it replaces the tone's hues. */
  color?: string;
};

type ToneColumn = {
  id?: string;
  slug?: string;
  group?: string | null;
  isFinal?: boolean | null;
  position?: number | null;
  color?: string | null;
};

const HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

// The default columns, for surfaces that render before columns load.
const FALLBACK_TONES: Record<string, StatusTone> = {
  planned: "backlog",
  backlog: "backlog",
  "to-do": "unstarted",
  "in-progress": "started",
  "in-review": "review",
  done: "completed",
  cancelled: "cancelled",
};

/** Each column's tone, keyed by the status slug its tasks carry. */
export function buildStatusTones(
  columns: readonly ToneColumn[] | undefined | null,
): ReadonlyMap<string, ToneInfo> {
  const tones = new Map<string, ToneInfo>();
  if (!columns) return tones;
  const ordered = columns
    .map((column, index) => ({ column, index }))
    .sort(
      (a, b) =>
        (a.column.position ?? a.index) - (b.column.position ?? b.index) ||
        a.index - b.index,
    );
  let startedSeen = 0;
  for (const { column } of ordered) {
    const slug = column.slug ?? column.id;
    if (!slug) continue;
    const group = columnGroupOf({
      slug,
      group: column.group,
      isFinal: column.isFinal,
    });
    let tone: StatusTone;
    if (group === "started") {
      tone = startedSeen > 0 ? "review" : "started";
      startedSeen += 1;
    } else if (group === "triage") {
      tone = "backlog";
    } else {
      tone = group;
    }
    const color =
      typeof column.color === "string" && HEX_COLOR.test(column.color)
        ? column.color
        : undefined;
    tones.set(slug, color ? { tone, color } : { tone });
  }
  return tones;
}

export function toneOf(
  status: string,
  tones?: ReadonlyMap<string, ToneInfo>,
): ToneInfo {
  return tones?.get(status) ?? { tone: FALLBACK_TONES[status] ?? "unstarted" };
}

export function isClosedTone(tone: StatusTone): boolean {
  return tone === "completed" || tone === "cancelled";
}

/**
 * Sets `--tone` (solid), `--tone-tint` (surface) and `--tone-fg` (text on the
 * tint) for an element and its children, so classes can stay static.
 */
export function toneStyle(info: ToneInfo): CSSProperties {
  if (info.color) {
    return {
      "--tone": info.color,
      "--tone-tint": `color-mix(in srgb, ${info.color} 14%, var(--card))`,
      "--tone-fg": `color-mix(in srgb, ${info.color} 45%, var(--foreground))`,
    } as CSSProperties;
  }
  return {
    "--tone": `var(--status-${info.tone})`,
    "--tone-tint": `var(--status-${info.tone}-tint)`,
    "--tone-fg": `var(--status-${info.tone}-fg)`,
  } as CSSProperties;
}

const PRIORITIES: Record<string, { icon: LucideIcon; color: string }> = {
  urgent: { icon: CircleAlert, color: "var(--priority-urgent)" },
  high: { icon: ChevronsUp, color: "var(--priority-high)" },
  medium: { icon: ChevronUp, color: "var(--priority-medium)" },
  low: { icon: ChevronDown, color: "var(--priority-low)" },
};

/** The priority's colour, or null for none (which shows nothing). */
export function priorityColor(
  priority: string | null | undefined,
): string | null {
  return (priority && PRIORITIES[priority]?.color) || null;
}

/** A small dot in the priority colour; decorative, the label carries it. */
export function PriorityDot({
  priority,
  className,
}: {
  priority: string | null | undefined;
  className?: string;
}): JSX.Element | null {
  const color = priorityColor(priority);
  if (!color) return null;
  return (
    <span
      aria-hidden="true"
      data-priority={priority}
      className={cn("size-1.5 shrink-0 rounded-full", className)}
      style={{ backgroundColor: color }}
    />
  );
}

/** The priority's icon in its colour, named for assistive technology. */
export function PriorityGlyph({
  priority,
  label,
  className,
}: {
  priority: string | null | undefined;
  label: string;
  className?: string;
}): JSX.Element {
  const meta = priority ? PRIORITIES[priority] : undefined;
  const Icon = meta?.icon ?? Minus;
  return (
    <Icon
      role="img"
      aria-label={label}
      data-priority={priority ?? "no-priority"}
      className={cn("size-3.5 shrink-0", className)}
      style={{ color: meta?.color ?? "var(--priority-none)" }}
    >
      <title>{label}</title>
    </Icon>
  );
}
