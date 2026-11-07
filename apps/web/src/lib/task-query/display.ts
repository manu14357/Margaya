import {
  ARCHIVED_FILTERS,
  type ArchivedFilter,
  DISPLAY_PROPERTY_KEYS,
  type DisplayProperties,
  type DisplayPropertyKey,
  defaultOrderDirection,
  GROUP_BY_KEYS,
  type GroupByKey,
  isCustomFieldKey,
  ORDER_BY_FIELDS,
  type OrderBy,
  type OrderByField,
  TASK_LAYOUTS,
  type TaskDisplay,
  type TaskLayout,
} from "./model";

// Display options and display properties: defaults per scope, defensive
// normalization of stored values, and the mapping to the global display
// toggles that surfaces without a saved view keep using (B4 K13).

export type DisplayScope = "project" | "workspace";

export function defaultDisplay(scope: DisplayScope): TaskDisplay {
  return scope === "project"
    ? {
        layout: "list",
        groupBy: "status",
        subGroupBy: null,
        orderBy: { field: "manual", direction: "asc" },
        showSubTasks: true,
        showEmptyGroups: false,
      }
    : {
        layout: "spreadsheet",
        groupBy: null,
        subGroupBy: null,
        orderBy: { field: "createdAt", direction: "desc" },
        showSubTasks: true,
        showEmptyGroups: false,
      };
}

export const DEFAULT_DISPLAY_PROPERTIES: DisplayProperties = {
  key: true,
  status: true,
  priority: true,
  assignee: true,
  labels: true,
  startDate: false,
  dueDate: true,
  estimate: true,
  cycle: true,
  modules: true,
  subTaskCount: true,
  checklist: true,
  createdAt: false,
  updatedAt: false,
  customFields: [],
};

function isOneOf<T extends string>(
  list: readonly T[],
  value: unknown,
): value is T {
  return (
    typeof value === "string" && (list as readonly string[]).includes(value)
  );
}

export function isGroupByKey(value: unknown): value is GroupByKey {
  return isOneOf(GROUP_BY_KEYS, value) || isCustomFieldKey(value);
}

export function isOrderByField(value: unknown): value is OrderByField {
  return isOneOf(ORDER_BY_FIELDS, value) || isCustomFieldKey(value);
}

export function isArchivedFilter(value: unknown): value is ArchivedFilter {
  return isOneOf(ARCHIVED_FILTERS, value);
}

export function normalizeOrderBy(value: unknown, fallback: OrderBy): OrderBy {
  if (!value || typeof value !== "object") return fallback;
  const candidate = value as { field?: unknown; direction?: unknown };
  if (!isOrderByField(candidate.field)) return fallback;
  const direction =
    candidate.direction === "asc" || candidate.direction === "desc"
      ? candidate.direction
      : defaultOrderDirection(candidate.field);
  return { field: candidate.field, direction };
}

/** A stored display with unknown or invalid parts replaced by defaults. */
export function normalizeDisplay(
  value: unknown,
  scope: DisplayScope,
  allowedLayouts: readonly TaskLayout[] = TASK_LAYOUTS,
): TaskDisplay {
  const defaults = defaultDisplay(scope);
  if (!value || typeof value !== "object") return defaults;
  const candidate = value as Record<string, unknown>;
  const layout = isOneOf(allowedLayouts, candidate.layout)
    ? candidate.layout
    : allowedLayouts.includes(defaults.layout)
      ? defaults.layout
      : (allowedLayouts[0] ?? defaults.layout);
  let groupBy =
    candidate.groupBy === null
      ? null
      : isGroupByKey(candidate.groupBy)
        ? candidate.groupBy
        : defaults.groupBy;
  // Group by status or a custom field needs one project.
  const needsOneProject = (key: GroupByKey | null) =>
    key === "status" || isCustomFieldKey(key);
  if (scope === "workspace" && needsOneProject(groupBy)) groupBy = null;
  let subGroupBy = isGroupByKey(candidate.subGroupBy)
    ? candidate.subGroupBy
    : null;
  if (!groupBy || subGroupBy === groupBy) subGroupBy = null;
  if (scope === "workspace" && needsOneProject(subGroupBy)) subGroupBy = null;
  const orderBy = normalizeOrderBy(candidate.orderBy, defaults.orderBy);
  return {
    layout,
    groupBy,
    subGroupBy,
    orderBy:
      scope === "workspace" && isCustomFieldKey(orderBy.field)
        ? defaults.orderBy
        : orderBy,
    showSubTasks:
      typeof candidate.showSubTasks === "boolean"
        ? candidate.showSubTasks
        : defaults.showSubTasks,
    showEmptyGroups:
      typeof candidate.showEmptyGroups === "boolean"
        ? candidate.showEmptyGroups
        : defaults.showEmptyGroups,
  };
}

/** Known boolean properties and custom field ids; everything else dropped. */
export function normalizeDisplayProperties(value: unknown): DisplayProperties {
  const normalized: DisplayProperties = {
    ...DEFAULT_DISPLAY_PROPERTIES,
    customFields: [],
  };
  if (!value || typeof value !== "object") return normalized;
  const candidate = value as Record<string, unknown>;
  for (const key of DISPLAY_PROPERTY_KEYS) {
    if (typeof candidate[key] === "boolean") {
      normalized[key] = candidate[key] as boolean;
    }
  }
  if (Array.isArray(candidate.customFields)) {
    normalized.customFields = [
      ...new Set(
        candidate.customFields.filter(
          (id): id is string => typeof id === "string" && id.length > 0,
        ),
      ),
    ];
  }
  return normalized;
}

/** The global display toggles (store/user-preferences) a property mirrors. */
export const PREFERENCE_FOR_PROPERTY = {
  key: "showTaskNumbers",
  priority: "showPriority",
  assignee: "showAssignees",
  labels: "showLabels",
  dueDate: "showDueDates",
  estimate: "showEstimates",
  checklist: "showTaskItemCounts",
} as const satisfies Partial<Record<DisplayPropertyKey, string>>;

type MirroredProperty = keyof typeof PREFERENCE_FOR_PROPERTY;
type PreferenceName = (typeof PREFERENCE_FOR_PROPERTY)[MirroredProperty];
export type DisplayPreferences = Record<PreferenceName, boolean>;

export function isMirroredProperty(
  key: DisplayPropertyKey,
): key is MirroredProperty {
  return key in PREFERENCE_FOR_PROPERTY;
}

/**
 * The properties a surface without a saved view shows: its own stored
 * properties, with the mirrored ones read from the global toggles.
 */
export function withPreferences(
  properties: DisplayProperties,
  preferences: DisplayPreferences,
): DisplayProperties {
  const merged = { ...properties };
  for (const [property, preference] of Object.entries(
    PREFERENCE_FOR_PROPERTY,
  ) as Array<[MirroredProperty, PreferenceName]>) {
    merged[property] = preferences[preference];
  }
  return merged;
}

/** Order fields the classic board sorts in the browser. */
const CLIENT_SORT_FIELDS = new Set<OrderByField>([
  "manual",
  "createdAt",
  "priority",
  "dueDate",
  "title",
  "number",
  "estimate",
]);

/**
 * Classic mode (B4 K9): the default board and list over the full-load cache,
 * with drag and drop. Anything else (another grouping, a sub-group, an order
 * the browser can't apply, archived tasks) runs in query mode.
 */
export function isClassicDisplay(
  display: TaskDisplay,
  archived: ArchivedFilter,
): boolean {
  return (
    display.groupBy === "status" &&
    display.subGroupBy === null &&
    archived === "exclude" &&
    CLIENT_SORT_FIELDS.has(display.orderBy.field)
  );
}

/** The engine order as the classic board's sort (manual is position). */
export function toSortConfig(orderBy: OrderBy): {
  field:
    | "position"
    | "createdAt"
    | "priority"
    | "estimate"
    | "dueDate"
    | "title"
    | "number";
  direction: "asc" | "desc";
} {
  switch (orderBy.field) {
    case "createdAt":
    case "priority":
    case "estimate":
    case "dueDate":
    case "title":
    case "number":
      return { field: orderBy.field, direction: orderBy.direction };
    default:
      return { field: "position", direction: "asc" };
  }
}
