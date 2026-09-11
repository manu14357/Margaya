import type {
  ArchivedFilter,
  FilterNode,
  GroupByKey,
  OrderByField,
  OrderDirection,
} from "../task-query/schema";

// Saved views store the task query engine's own filter and display model, so
// anything a view holds can run as a task query (B4 §4.2).

export const VIEW_ACCESS = ["private", "workspace"] as const;
export type ViewAccess = (typeof VIEW_ACCESS)[number];

export const VIEW_LAYOUTS = [
  "list",
  "board",
  "spreadsheet",
  "calendar",
  "gantt",
] as const;
export type ViewLayout = (typeof VIEW_LAYOUTS)[number];

/** Workspace views span projects, which calendar and gantt can't show. */
export const WORKSPACE_VIEW_LAYOUTS: readonly ViewLayout[] = [
  "list",
  "board",
  "spreadsheet",
];

/** The boolean display properties, in the spreadsheet's column order. */
export const DISPLAY_PROPERTY_FLAGS = [
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
  "linkCount",
  "attachmentCount",
] as const;
export type DisplayPropertyFlag = (typeof DISPLAY_PROPERTY_FLAGS)[number];

export const MAX_VIEW_CUSTOM_FIELD_COLUMNS = 50;

export type ViewFilters = {
  version: 1;
  root: FilterNode | null;
  archived: ArchivedFilter;
};

export type ViewDisplay = {
  layout: ViewLayout;
  groupBy: GroupByKey | null;
  subGroupBy: GroupByKey | null;
  orderBy: { field: OrderByField; direction: OrderDirection };
  showSubTasks: boolean;
  showEmptyGroups: boolean;
};

export type ViewDisplayProperties = Record<DisplayPropertyFlag, boolean> & {
  /** Custom field ids shown as spreadsheet columns (project views only). */
  customFields: string[];
};

/** Project views have a project; workspace views span the workspace. */
export type ViewScope = "project" | "workspace";
