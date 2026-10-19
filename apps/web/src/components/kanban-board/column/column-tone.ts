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
 * A column's status colour as the inherited `--col` custom property. The
 * board stays neutral; only the header's small status dot reads it.
 */
export type ColumnTone = { name: ToneName | "custom"; style: CSSProperties };

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
        ? { name: "custom", style: toneStyle(custom) }
        : { name, style: toneStyle(`var(--status-${name})`) },
    );
  }

  return tones;
}
