import { CREATABLE_COLUMN_GROUPS } from "@/lib/column-groups";
import type {
  AnalyticsBucket,
  AnalyticsChartResult,
  AnalyticsTrendResult,
} from "@/types/analytics";
import { isDateDimension } from "./dimensions";
import type { Translate } from "./labels";
import { NONE_KEY } from "./labels";
import { sortTableRows, type TableSort } from "./sort";

// One model per analytics table (B8 §4.2): the columns and rows the screen
// shows are exactly the ones the CSV export writes. Cells hold raw values
// (numbers, YYYY-MM-DD days, translated names); the screen formats them.

export type TableColumnKind = "text" | "number" | "percent" | "date";

export type TableColumn = {
  id: string;
  label: string;
  kind: TableColumnKind;
};

export type TableCell = string | number | null;

export type TableRow = {
  id: string;
  /** The dimension key or entity id, for icons, avatars and links. */
  key: string;
  /** Natural order: ties and "no sort" fall back to it. */
  order: number;
  cells: Record<string, TableCell>;
  /** Shown in destructive text (an overdue module's target date). */
  alert?: readonly string[];
};

export type TableModel = {
  columns: TableColumn[];
  rows: TableRow[];
  /** The distinct totals, never a sum of the rows (K6). */
  total?: TableRow;
};

export const TOTAL_ROW_ID = "__total__";
export const SEGMENT_COLUMN_PREFIX = "segment:";

export function segmentColumnId(key: string): string {
  return `${SEGMENT_COLUMN_PREFIX}${key}`;
}

export function isNumericColumn(column: TableColumn): boolean {
  return column.kind === "number" || column.kind === "percent";
}

export function applyTableSort(model: TableModel, sort: TableSort): TableModel {
  return { ...model, rows: sortTableRows(model.rows, sort) };
}

type ChartTableOptions = {
  t: Translate;
  /** The x dimension's column title, e.g. "Assignee". */
  dimensionLabel: string;
  /** "Tasks" or "Estimate points". */
  metricLabel: string;
  labelOf: (dimension: AnalyticsChartResult["xAxis"], key: string) => string;
  /** Buckets in display order (after "Sort by value"); defaults to the result's. */
  buckets?: readonly AnalyticsBucket[];
};

function periodCells(
  bucket: Pick<AnalyticsBucket, "key" | "rangeStart" | "rangeEnd">,
  label: string,
): Record<string, TableCell> {
  if (bucket.key === NONE_KEY) {
    return { periodStart: label, periodEnd: null };
  }
  return {
    periodStart: bucket.rangeStart ?? bucket.key,
    periodEnd: bucket.rangeEnd ?? null,
  };
}

/** The builder's table: x label, metric, tasks (points only), segments, progress. */
export function chartTableModel(
  result: AnalyticsChartResult,
  options: ChartTableOptions,
): TableModel {
  const { t, labelOf } = options;
  const isDate = isDateDimension(result.xAxis);
  const isPoints = result.metric === "estimatePoints";
  const segment = result.segment;
  const withProgress = segment === "group";

  const columns: TableColumn[] = isDate
    ? [
        {
          id: "periodStart",
          label: t("analytics:table.periodStart"),
          kind: "date",
        },
        {
          id: "periodEnd",
          label: t("analytics:table.periodEnd"),
          kind: "date",
        },
      ]
    : [{ id: "name", label: options.dimensionLabel, kind: "text" }];
  columns.push({ id: "value", label: options.metricLabel, kind: "number" });
  if (isPoints) {
    columns.push({
      id: "taskCount",
      label: t("analytics:table.tasks"),
      kind: "number",
    });
  }
  if (segment) {
    for (const entry of result.segments) {
      columns.push({
        id: segmentColumnId(entry.key),
        label: labelOf(segment, entry.key),
        kind: "number",
      });
    }
  }
  if (withProgress) {
    columns.push({
      id: "progress",
      label: t("analytics:table.progress"),
      kind: "percent",
    });
  }

  const buckets = options.buckets ?? result.buckets;
  const rows: TableRow[] = buckets.map((bucket, order) => {
    const label = labelOf(result.xAxis, bucket.key);
    const cells: Record<string, TableCell> = isDate
      ? periodCells(bucket, label)
      : { name: label };
    cells.value = bucket.value;
    if (isPoints) cells.taskCount = bucket.taskCount;
    if (segment) {
      for (const entry of result.segments) {
        cells[segmentColumnId(entry.key)] = bucket.cells?.[entry.key] ?? 0;
      }
    }
    if (withProgress) cells.progress = bucket.progress;
    return { id: bucket.key, key: bucket.key, order, cells };
  });

  if (rows.length === 0) return { columns, rows };

  const totalLabel = t("analytics:table.total");
  const totalCells: Record<string, TableCell> = isDate
    ? { periodStart: totalLabel, periodEnd: null }
    : { name: totalLabel };
  totalCells.value = result.totalValue;
  if (isPoints) totalCells.taskCount = result.totalCount;
  if (segment) {
    for (const entry of result.segments) {
      totalCells[segmentColumnId(entry.key)] = entry.value;
    }
  }
  if (withProgress) totalCells.progress = result.progress;
  return {
    columns,
    rows,
    total: {
      id: TOTAL_ROW_ID,
      key: TOTAL_ROW_ID,
      order: rows.length,
      cells: totalCells,
    },
  };
}

export type BreakdownGroup = (typeof CREATABLE_COLUMN_GROUPS)[number];

type BreakdownOptions = {
  t: Translate;
  dimensionLabel: string;
  labelOf: (dimension: AnalyticsChartResult["xAxis"], key: string) => string;
  /** The group columns; defaults to all five. */
  groups?: readonly BreakdownGroup[];
  buckets?: readonly AnalyticsBucket[];
  /** Adds the completion column (default true). */
  withProgress?: boolean;
};

/** Rows by a dimension, one column per group, total and progress. */
export function breakdownTableModel(
  result: AnalyticsChartResult,
  options: BreakdownOptions,
): TableModel {
  const { t, labelOf, withProgress = true } = options;
  const groups = options.groups ?? CREATABLE_COLUMN_GROUPS;
  const columns: TableColumn[] = [
    { id: "name", label: options.dimensionLabel, kind: "text" },
    ...groups.map(
      (group): TableColumn => ({
        id: segmentColumnId(group),
        label: t(`tasks:columnGroups.${group}.label`),
        kind: "number",
      }),
    ),
    { id: "value", label: t("analytics:table.total"), kind: "number" },
  ];
  if (withProgress) {
    columns.push({
      id: "progress",
      label: t("analytics:table.progress"),
      kind: "percent",
    });
  }

  const buckets = options.buckets ?? result.buckets;
  const rows: TableRow[] = buckets.map((bucket, order) => {
    const cells: Record<string, TableCell> = {
      name: labelOf(result.xAxis, bucket.key),
    };
    for (const group of groups) {
      cells[segmentColumnId(group)] = bucket.cells?.[group] ?? 0;
    }
    cells.value = bucket.value;
    if (withProgress) cells.progress = bucket.progress;
    return { id: bucket.key, key: bucket.key, order, cells };
  });
  if (rows.length === 0) return { columns, rows };

  const segmentTotal = (key: string) =>
    result.segments.find((entry) => entry.key === key)?.value ?? 0;
  const totalCells: Record<string, TableCell> = {
    name: t("analytics:table.total"),
  };
  for (const group of groups) {
    totalCells[segmentColumnId(group)] = segmentTotal(group);
  }
  totalCells.value = result.totalValue;
  if (withProgress) totalCells.progress = result.progress;
  return {
    columns,
    rows,
    total: {
      id: TOTAL_ROW_ID,
      key: TOTAL_ROW_ID,
      order: rows.length,
      cells: totalCells,
    },
  };
}

type SeriesColumn<T> = {
  id: string;
  label: string;
  value: (point: T) => number;
  total?: number;
};

type PeriodPoint = { start: string; rangeStart: string; rangeEnd: string };

/** A time series as a table: period start and end, then one column per series. */
export function seriesTableModel<T extends PeriodPoint>(
  series: readonly T[],
  columnsOf: readonly SeriesColumn<T>[],
  t: Translate,
): TableModel {
  const columns: TableColumn[] = [
    {
      id: "periodStart",
      label: t("analytics:table.periodStart"),
      kind: "date",
    },
    { id: "periodEnd", label: t("analytics:table.periodEnd"), kind: "date" },
    ...columnsOf.map(
      (column): TableColumn => ({
        id: column.id,
        label: column.label,
        kind: "number",
      }),
    ),
  ];
  const rows: TableRow[] = series.map((point, order) => {
    const cells: Record<string, TableCell> = {
      periodStart: point.rangeStart,
      periodEnd: point.rangeEnd,
    };
    for (const column of columnsOf) cells[column.id] = column.value(point);
    return { id: point.start, key: point.start, order, cells };
  });
  if (
    rows.length === 0 ||
    columnsOf.every((column) => column.total === undefined)
  ) {
    return { columns, rows };
  }
  const totalCells: Record<string, TableCell> = {
    periodStart: t("analytics:table.total"),
    periodEnd: null,
  };
  for (const column of columnsOf) totalCells[column.id] = column.total ?? null;
  return {
    columns,
    rows,
    total: {
      id: TOTAL_ROW_ID,
      key: TOTAL_ROW_ID,
      order: rows.length,
      cells: totalCells,
    },
  };
}

/** Created vs completed as a table, with the range totals. */
export function trendTableModel(
  result: AnalyticsTrendResult,
  labels: { created: string; completed: string },
  t: Translate,
): TableModel {
  return seriesTableModel(
    result.series,
    [
      {
        id: "created",
        label: labels.created,
        value: (point) => point.created,
        total: result.totals.created,
      },
      {
        id: "completed",
        label: labels.completed,
        value: (point) => point.completed,
        total: result.totals.completed,
      },
    ],
    t,
  );
}

/** A table of entities (cycles, modules, projects) from plain column specs. */
export function entityTableModel<T extends { id: string }>(
  items: readonly T[],
  columnsOf: ReadonlyArray<
    TableColumn & {
      value: (item: T) => TableCell;
      alert?: (item: T) => boolean;
    }
  >,
): TableModel {
  const columns = columnsOf.map(({ id, label, kind }) => ({ id, label, kind }));
  const rows: TableRow[] = items.map((item, order) => {
    const cells: Record<string, TableCell> = {};
    const alert: string[] = [];
    for (const column of columnsOf) {
      cells[column.id] = column.value(item);
      if (column.alert?.(item)) alert.push(column.id);
    }
    return {
      id: item.id,
      key: item.id,
      order,
      cells,
      ...(alert.length ? { alert } : {}),
    };
  });
  return { columns, rows };
}
