// The web's typed model of the task query engine (POST /api/task-query):
// filter trees, display options and display properties. It mirrors the
// engine's request schema; the engine stays the authority on validation.

export const ARCHIVED_FILTERS = ["exclude", "include", "only"] as const;
export type ArchivedFilter = (typeof ARCHIVED_FILTERS)[number];

export const FILTER_GROUP_OPS = ["and", "or"] as const;
export type FilterGroupOp = (typeof FILTER_GROUP_OPS)[number];

export const DATE_UNITS = ["days", "weeks", "months"] as const;
export type DateUnit = (typeof DATE_UNITS)[number];

export const DATE_PRESETS = [
  "today",
  "yesterday",
  "tomorrow",
  "thisWeek",
  "lastWeek",
  "nextWeek",
  "thisMonth",
  "lastMonth",
  "nextMonth",
  "past",
  "future",
  "none",
] as const;
export type DatePreset = (typeof DATE_PRESETS)[number];

export const SET_OPERATORS = ["in", "notIn"] as const;
export type SetOperator = (typeof SET_OPERATORS)[number];

export const ROLLING_OPERATORS = [
  "withinLast",
  "withinNext",
  "moreThanAgo",
  "moreThanAhead",
] as const;
export type RollingOperator = (typeof ROLLING_OPERATORS)[number];

export const EXACT_DATE_OPERATORS = [
  "on",
  "onOrBefore",
  "onOrAfter",
  "between",
] as const;
export type ExactDateOperator = (typeof EXACT_DATE_OPERATORS)[number];

export type DateOperator =
  | ExactDateOperator
  | RollingOperator
  | "in"
  | "empty"
  | "notEmpty";

export type FilterCondition = {
  key: string;
  operator: string;
  values?: string[];
  date?: string;
  from?: string;
  to?: string;
  amount?: number;
  unit?: DateUnit;
  fieldId?: string;
};

export type FilterGroup = {
  op: FilterGroupOp;
  children: FilterNode[];
};

export type FilterNode = FilterGroup | FilterCondition;

export function isFilterGroup(node: FilterNode): node is FilterGroup {
  return "op" in node;
}

/** Set keys: `in` / `notIn` over ids and tokens. */
export const SET_FILTER_KEYS = [
  "status",
  "group",
  "priority",
  "assignee",
  "createdBy",
  "label",
  "cycle",
  "module",
  "estimate",
  "project",
  "parent",
  "customField",
  "subscriber",
  "mention",
] as const;
export type SetFilterKey = (typeof SET_FILTER_KEYS)[number];

export const DATE_FILTER_KEYS = [
  "startDate",
  "dueDate",
  "createdAt",
  "updatedAt",
  "completedAt",
] as const;
export type DateFilterKey = (typeof DATE_FILTER_KEYS)[number];

export type FilterKey = SetFilterKey | DateFilterKey;

export function isDateFilterKey(key: string): key is DateFilterKey {
  return (DATE_FILTER_KEYS as readonly string[]).includes(key);
}

/** The value meaning "has no value" for set keys. */
export const NONE_VALUE = "none";
/** Resolved to the caller at query time. */
export const ME_VALUE = "me";
/** The current cycle of each task's project. */
export const CURRENT_CYCLE_VALUE = "current";
/** Label values without a workspace label: `name:<label name>`. */
export const LABEL_NAME_PREFIX = "name:";

export const GROUP_BY_KEYS = [
  "status",
  "group",
  "priority",
  "assignee",
  "createdBy",
  "label",
  "cycle",
  "module",
  "estimate",
  "project",
] as const;
export type GroupByKey = (typeof GROUP_BY_KEYS)[number];

export const ORDER_BY_FIELDS = [
  "manual",
  "createdAt",
  "updatedAt",
  "completedAt",
  "startDate",
  "dueDate",
  "priority",
  "title",
  "number",
  "status",
  "assignee",
  "label",
  "cycle",
  "module",
  "estimate",
  "subTaskCount",
  // Archives only: meaningful for archived tasks (nulls last).
  "archivedAt",
] as const;
export type OrderByField = (typeof ORDER_BY_FIELDS)[number];

export type OrderDirection = "asc" | "desc";

export type OrderBy = { field: OrderByField; direction: OrderDirection };

/** The engine's default direction per order field. */
export const DEFAULT_ORDER_DIRECTION: Record<OrderByField, OrderDirection> = {
  manual: "asc",
  createdAt: "desc",
  updatedAt: "desc",
  completedAt: "desc",
  startDate: "asc",
  dueDate: "asc",
  priority: "desc",
  title: "asc",
  number: "asc",
  status: "asc",
  assignee: "asc",
  label: "asc",
  cycle: "asc",
  module: "asc",
  estimate: "desc",
  subTaskCount: "desc",
  archivedAt: "desc",
};

export const TASK_LAYOUTS = [
  "list",
  "board",
  "spreadsheet",
  "calendar",
  "gantt",
] as const;
export type TaskLayout = (typeof TASK_LAYOUTS)[number];

export type TaskDisplay = {
  layout: TaskLayout;
  groupBy: GroupByKey | null;
  subGroupBy: GroupByKey | null;
  orderBy: OrderBy;
  showSubTasks: boolean;
  showEmptyGroups: boolean;
};

export const DISPLAY_PROPERTY_KEYS = [
  "key",
  "status",
  "priority",
  "assignee",
  "labels",
  "startDate",
  "dueDate",
  "estimate",
  "cycle",
  "modules",
  "subTaskCount",
  "checklist",
  "createdAt",
  "updatedAt",
] as const;
export type DisplayPropertyKey = (typeof DISPLAY_PROPERTY_KEYS)[number];

export type DisplayProperties = Record<DisplayPropertyKey, boolean> & {
  /** Custom field ids shown as spreadsheet columns (project scope). */
  customFields: string[];
};

/** Where a task list runs: one project, or the workspace's projects. */
export type TaskQueryScope =
  | { kind: "project"; projectId: string }
  | { kind: "workspace"; projectIds?: string[] };

/** Everything a task list's toolbar edits; saved views store the same. */
export type TaskQueryState = {
  filters: FilterNode | null;
  archived: ArchivedFilter;
  display: TaskDisplay;
  displayProperties: DisplayProperties;
};
