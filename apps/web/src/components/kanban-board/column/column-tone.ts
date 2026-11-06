import type { CSSProperties } from "react";
import { columnGroupOf } from "@/lib/column-groups";
import { FALLBACK_LABEL_COLOR, resolveLabelColor } from "@/lib/label-color";

/** The status hues of `styles/semantic-colors.css`. */
export type ToneName =
  | "backlog"
  | "unstarted"
  | "started"
  | "review"
  | "completed"
  | "cancelled";

type ToneColumn = {
  id: string;
  slug: string;
  group?: string | null;
  isFinal?: boolean | null;
};

/**
 * A column's status colour. The board stays neutral: only the header's small
 * status dot reads the inherited `--col` custom property. The list's group
 * bands use the hues directly, so both views show a column the same way.
 */
export type ColumnTone = {
  name: ToneName | "custom";
  style: CSSProperties;
  color: string;
  tint: string;
  foreground: string;
};

const toneStyle = (color: string) => ({ "--col": color }) as CSSProperties;

function resolveColumnColor(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  const resolved = resolveLabelColor(trimmed);
  return resolved === FALLBACK_LABEL_COLOR ? null : resolved;
}

/**
 * Tones for the board's columns, keyed by column id. A column's own colour
 * wins; otherwise its group's. The second and later started columns (such as
 * "In review") take the review hue so neighbouring stages stay distinct.
 */
export function columnTones(
  columns: readonly ToneColumn[],
  colorBySlug: ReadonlyMap<string, string | null> = new Map(),
): Map<string, ColumnTone> {
  const tones = new Map<string, ColumnTone>();
  let startedSeen = 0;

  for (const column of columns) {
    const group = columnGroupOf(column);
    let name: ToneName;
    if (group === "started") {
      name = startedSeen > 0 ? "review" : "started";
      startedSeen += 1;
    } else if (group === "triage") {
      name = "backlog";
    } else {
      name = group;
    }

    const custom = resolveColumnColor(colorBySlug.get(column.slug));
    tones.set(
      column.id,
      custom
        ? {
            name: "custom",
            style: toneStyle(custom),
            color: custom,
            tint: `color-mix(in srgb, ${custom} 14%, var(--card))`,
            foreground: `color-mix(in srgb, ${custom} 45%, var(--foreground))`,
          }
        : {
            name,
            style: toneStyle(`var(--status-${name})`),
            color: `var(--status-${name})`,
            tint: `var(--status-${name}-tint)`,
            foreground: `var(--status-${name}-fg)`,
          },
    );
  }

  return tones;
}
