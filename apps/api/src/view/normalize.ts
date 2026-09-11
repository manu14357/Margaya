import { DEFAULT_DIRECTIONS } from "../task-query/order";
import {
  ARCHIVED_FILTERS,
  type ArchivedFilter,
  type FilterNode,
  GROUP_BY_KEYS,
  type GroupByKey,
  ORDER_BY_FIELDS,
  ORDER_DIRECTIONS,
  type OrderByField,
  type OrderDirection,
} from "../task-query/schema";
import type {
  ViewDisplayInput,
  ViewDisplayPropertiesInput,
  ViewFiltersInput,
} from "./schema";
import {
  DISPLAY_PROPERTY_FLAGS,
  VIEW_LAYOUTS,
  type ViewDisplay,
  type ViewDisplayProperties,
  type ViewFilters,
  type ViewLayout,
  type ViewScope,
} from "./types";

// Defaults, lenient reads of stored JSON (unknown keys and values are
// dropped, missing ones defaulted) and shallow merges of partial input.
// Pure, so the rules are unit-tested without a database.

export function defaultViewFilters(): ViewFilters {
  return { version: 1, root: null, archived: "exclude" };
}

export function defaultViewDisplay(scope: ViewScope): ViewDisplay {
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

const DEFAULT_OFF_FLAGS = new Set<string>([
  "startDate",
  "createdAt",
  "updatedAt",
  "linkCount",
  "attachmentCount",
]);

export function defaultViewDisplayProperties(): ViewDisplayProperties {
  const flags = Object.fromEntries(
    DISPLAY_PROPERTY_FLAGS.map((flag) => [flag, !DEFAULT_OFF_FLAGS.has(flag)]),
  ) as Record<(typeof DISPLAY_PROPERTY_FLAGS)[number], boolean>;
  return { ...flags, customFields: [] };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function oneOf<T extends string>(
  values: readonly T[],
  value: unknown,
): T | undefined {
  return typeof value === "string" &&
    (values as readonly string[]).includes(value)
    ? (value as T)
    : undefined;
}

/** A sub-group only makes sense under a different group. */
function consistentSubGroup(
  groupBy: GroupByKey | null,
  subGroupBy: GroupByKey | null,
): GroupByKey | null {
  return groupBy && subGroupBy && subGroupBy !== groupBy ? subGroupBy : null;
}

function orderOf(
  field: OrderByField,
  direction: OrderDirection | undefined,
): ViewDisplay["orderBy"] {
  return { field, direction: direction ?? DEFAULT_DIRECTIONS[field] };
}

/** Stored filters as the API returns them. The tree was validated on write. */
export function readViewFilters(stored: unknown): ViewFilters {
  const raw = asRecord(stored);
  const root = asRecord(raw.root);
  return {
    version: 1,
    root: Object.keys(root).length > 0 ? (raw.root as FilterNode) : null,
    archived:
      oneOf<ArchivedFilter>(ARCHIVED_FILTERS, raw.archived) ?? "exclude",
  };
}

export function readViewDisplay(
  stored: unknown,
  scope: ViewScope,
): ViewDisplay {
  const raw = asRecord(stored);
  const defaults = defaultViewDisplay(scope);
  const nullableGroup = (value: unknown, fallback: GroupByKey | null) =>
    value === null ? null : (oneOf(GROUP_BY_KEYS, value) ?? fallback);
  const groupBy = nullableGroup(raw.groupBy, defaults.groupBy);
  const order = asRecord(raw.orderBy);
  const field = oneOf(ORDER_BY_FIELDS, order.field);
  return {
    layout: oneOf<ViewLayout>(VIEW_LAYOUTS, raw.layout) ?? defaults.layout,
    groupBy,
    subGroupBy: consistentSubGroup(
      groupBy,
      nullableGroup(raw.subGroupBy, null),
    ),
    orderBy: field
      ? orderOf(field, oneOf(ORDER_DIRECTIONS, order.direction))
      : defaults.orderBy,
    showSubTasks:
      typeof raw.showSubTasks === "boolean"
        ? raw.showSubTasks
        : defaults.showSubTasks,
    showEmptyGroups:
      typeof raw.showEmptyGroups === "boolean"
        ? raw.showEmptyGroups
        : defaults.showEmptyGroups,
  };
}

export function readViewDisplayProperties(
  stored: unknown,
): ViewDisplayProperties {
  const raw = asRecord(stored);
  const properties = defaultViewDisplayProperties();
  for (const flag of DISPLAY_PROPERTY_FLAGS) {
    if (typeof raw[flag] === "boolean") properties[flag] = raw[flag];
  }
  if (Array.isArray(raw.customFields)) {
    properties.customFields = [
      ...new Set(
        raw.customFields.filter(
          (id): id is string => typeof id === "string" && id.length > 0,
        ),
      ),
    ];
  }
  return properties;
}

export function mergeViewFilters(
  base: ViewFilters,
  input: ViewFiltersInput | undefined,
): ViewFilters {
  return {
    version: 1,
    root: input?.root !== undefined ? input.root : base.root,
    archived: input?.archived ?? base.archived,
  };
}

/**
 * Partial input over `base`. A sub-group the input sends is kept as sent, so
 * validation can reject it; a stored one that no longer fits the new group
 * is dropped.
 */
export function mergeViewDisplay(
  base: ViewDisplay,
  input: ViewDisplayInput | undefined,
): ViewDisplay {
  const groupBy = input?.groupBy !== undefined ? input.groupBy : base.groupBy;
  return {
    layout: input?.layout ?? base.layout,
    groupBy,
    subGroupBy:
      input?.subGroupBy !== undefined
        ? input.subGroupBy
        : consistentSubGroup(groupBy, base.subGroupBy),
    orderBy: input?.orderBy
      ? orderOf(input.orderBy.field, input.orderBy.direction)
      : base.orderBy,
    showSubTasks: input?.showSubTasks ?? base.showSubTasks,
    showEmptyGroups: input?.showEmptyGroups ?? base.showEmptyGroups,
  };
}

export function mergeViewDisplayProperties(
  base: ViewDisplayProperties,
  input: ViewDisplayPropertiesInput | undefined,
): ViewDisplayProperties {
  const properties = { ...base, customFields: [...base.customFields] };
  if (!input) return properties;
  for (const flag of DISPLAY_PROPERTY_FLAGS) {
    const value = input[flag];
    if (value !== undefined) properties[flag] = value;
  }
  if (input.customFields) {
    properties.customFields = [...new Set(input.customFields)];
  }
  return properties;
}

/**
 * JSON with object keys sorted, for equality checks: jsonb does not keep the
 * key order a client sent.
 */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

export function sameJson(a: unknown, b: unknown): boolean {
  return canonicalJson(a) === canonicalJson(b);
}
