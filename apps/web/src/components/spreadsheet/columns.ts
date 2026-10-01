import type {
  DisplayProperties,
  DisplayPropertyKey,
  OrderByField,
} from "@/lib/task-query/model";

// The spreadsheet's columns in their fixed order (B4 §6.5). Each one is a
// display property; the first column (key and title) is always shown.

export type SpreadsheetColumn = {
  property: DisplayPropertyKey;
  labelKey: string;
  sortField: OrderByField | null;
  width: number;
};

export const SPREADSHEET_COLUMNS: readonly SpreadsheetColumn[] = [
  {
    property: "status",
    labelKey: "tasks:display.props.status",
    sortField: "status",
    width: 160,
  },
  {
    property: "priority",
    labelKey: "tasks:display.props.priority",
    sortField: "priority",
    width: 120,
  },
  {
    property: "assignee",
    labelKey: "tasks:display.props.assignee",
    sortField: "assignee",
    width: 160,
  },
  {
    property: "labels",
    labelKey: "tasks:display.props.labels",
    sortField: "label",
    width: 200,
  },
  {
    property: "modules",
    labelKey: "tasks:display.props.modules",
    sortField: "module",
    width: 180,
  },
  {
    property: "cycle",
    labelKey: "tasks:display.props.cycle",
    sortField: "cycle",
    width: 160,
  },
  {
    property: "estimate",
    labelKey: "tasks:display.props.estimate",
    sortField: "estimate",
    width: 110,
  },
  {
    property: "startDate",
    labelKey: "tasks:display.props.startDate",
    sortField: "startDate",
    width: 130,
  },
  {
    property: "dueDate",
    labelKey: "tasks:display.props.dueDate",
    sortField: "dueDate",
    width: 130,
  },
  {
    property: "subTaskCount",
    labelKey: "tasks:display.props.subTaskCount",
    sortField: "subTaskCount",
    width: 100,
  },
  {
    property: "createdAt",
    labelKey: "tasks:display.props.createdAt",
    sortField: "createdAt",
    width: 130,
  },
  {
    property: "updatedAt",
    labelKey: "tasks:display.props.updatedAt",
    sortField: "updatedAt",
    width: 130,
  },
];

export const CUSTOM_FIELD_COLUMN_WIDTH = 160;
export const FIRST_COLUMN_WIDTH = 360;

/** The visible columns: shown properties the surface offers, in order. */
export function visibleColumns(
  properties: DisplayProperties,
  available: readonly DisplayPropertyKey[],
): SpreadsheetColumn[] {
  return SPREADSHEET_COLUMNS.filter(
    (column) =>
      properties[column.property] && available.includes(column.property),
  );
}
