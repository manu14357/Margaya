import {
  type FilterCondition,
  type FilterNode,
  LABEL_NAME_PREFIX,
  type OrderBy,
} from "./model";

// One-time conversion of the board's old stored filters and sort
// (margaya:board-filters:{scope}, margaya:board-sort:{projectId}) into the
// engine's filter tree and order. Unreadable parts are dropped.

export type LegacyLabel = {
  id: string;
  name: string;
  taskId?: string | null;
};

const LEGACY_DUE_DATES: Record<string, string> = {
  dueThisWeek: "thisWeek",
  dueNextWeek: "nextWeek",
  noDueDate: "none",
};

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter(
        (item): item is string => typeof item === "string" && item.length > 0,
      ),
    ),
  ];
}

function setCondition(key: string, values: string[]): FilterCondition[] {
  return values.length > 0 ? [{ key, operator: "in", values }] : [];
}

/**
 * Label filters stored label row ids. Each becomes the workspace label (the
 * row without a task) of the same name, or a `name:` literal.
 */
export function convertLegacyLabels(
  ids: readonly string[],
  labels: readonly LegacyLabel[],
): string[] {
  const values: string[] = [];
  for (const id of ids) {
    const row = labels.find((label) => label.id === id);
    if (!row) continue;
    const workspaceLabel = labels.find(
      (label) => label.name === row.name && !label.taskId,
    );
    values.push(
      workspaceLabel ? workspaceLabel.id : `${LABEL_NAME_PREFIX}${row.name}`,
    );
  }
  return [...new Set(values)];
}

/** True when the stored value names label row ids to resolve first. */
export function legacyFiltersNeedLabels(raw: unknown): boolean {
  if (!raw || typeof raw !== "object") return false;
  return stringList((raw as Record<string, unknown>).labels).length > 0;
}

/** The old board filters as one root "and" group, or null when empty. */
export function convertLegacyBoardFilters(
  raw: unknown,
  labels: readonly LegacyLabel[] = [],
): FilterNode | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const legacy = raw as Record<string, unknown>;
  const conditions: FilterCondition[] = [
    ...setCondition("status", stringList(legacy.status)),
    ...setCondition("priority", stringList(legacy.priority)),
    ...setCondition("assignee", stringList(legacy.assignee)),
  ];

  const dueDates = stringList(legacy.dueDate)
    .map((value) => LEGACY_DUE_DATES[value])
    .filter((value): value is string => Boolean(value));
  if (dueDates.length > 0) {
    conditions.push({ key: "dueDate", operator: "in", values: dueDates });
  }

  conditions.push(
    ...setCondition(
      "label",
      convertLegacyLabels(stringList(legacy.labels), labels),
    ),
  );

  const customFields = legacy.customFields;
  if (
    customFields &&
    typeof customFields === "object" &&
    !Array.isArray(customFields)
  ) {
    for (const [fieldId, values] of Object.entries(customFields)) {
      const list = stringList(values);
      if (fieldId && list.length > 0) {
        conditions.push({
          key: "customField",
          operator: "in",
          values: list,
          fieldId,
        });
      }
    }
  }

  conditions.push(
    ...setCondition("cycle", stringList(legacy.cycle)),
    ...setCondition("module", stringList(legacy.module)),
    ...setCondition("estimate", stringList(legacy.estimate)),
  );

  return conditions.length > 0 ? { op: "and", children: conditions } : null;
}

const LEGACY_SORT_FIELDS: Record<string, OrderBy["field"]> = {
  position: "manual",
  createdAt: "createdAt",
  priority: "priority",
  estimate: "estimate",
  dueDate: "dueDate",
  title: "title",
  number: "number",
};

/** The old board sort as an order; position becomes manual. */
export function convertLegacySort(raw: unknown): OrderBy | null {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as { field?: unknown; direction?: unknown };
  const field =
    typeof candidate.field === "string"
      ? LEGACY_SORT_FIELDS[candidate.field]
      : undefined;
  if (!field) return null;
  if (field === "manual") return { field, direction: "asc" };
  const direction =
    candidate.direction === "desc" || candidate.direction === "asc"
      ? candidate.direction
      : "asc";
  return { field, direction };
}
