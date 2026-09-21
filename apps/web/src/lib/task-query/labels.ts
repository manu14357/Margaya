import { LABEL_NAME_PREFIX } from "./model";

// Label filter values (B4 K5): the workspace label (the row without a task)
// of a name, else a `name:` literal that matches the task copies directly.

export type LabelRow = {
  id: string;
  name: string;
  color: string;
  taskId?: string | null;
};

export type LabelValue = { value: string; name: string; color: string };

/** One value per label name, sorted by name. */
export function labelValues(labels: readonly LabelRow[]): LabelValue[] {
  const byName = new Map<string, LabelValue>();
  // Workspace labels first, so they win over the copies of their name.
  const sorted = [...labels].sort(
    (a, b) => Number(Boolean(a.taskId)) - Number(Boolean(b.taskId)),
  );
  for (const label of sorted) {
    if (byName.has(label.name)) continue;
    byName.set(label.name, {
      value: label.taskId ? `${LABEL_NAME_PREFIX}${label.name}` : label.id,
      name: label.name,
      color: label.color,
    });
  }
  return [...byName.values()].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );
}
