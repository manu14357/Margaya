import { type SQL, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { alias } from "drizzle-orm/pg-core";
import {
  estimatePointTable,
  estimateTable,
  taskTable,
} from "../database/schema";
import { featureOn, type QueryContext } from "../task-query/context";
import type { WeekStart } from "../task-query/dates";
import {
  type GroupKeyExpression,
  groupKeyExpression,
  NONE_GROUP,
} from "../task-query/group";
import {
  type CustomFieldDisplayKey,
  type GroupByKey,
  isCustomFieldDisplayKey,
} from "../task-query/schema";
import type { DateBucket } from "./buckets";

// The dimension catalog (B8 §2A.1). Category keys reuse the task query
// engine's group keys, so a dimension means exactly what the same grouping
// means on a board; only the date keys and the cross-project estimate key
// are analytics' own. A dropdown custom field is a dimension too, as
// `customField:<field id>` with the board's `value:<option>` keys. Every key
// expression is correlated to the outer, unaliased `task` row with `column`
// LEFT JOINed through taskColumnJoin.

export const NONE_KEY = NONE_GROUP;

export const DATE_DIMENSIONS = [
  "createdAt",
  "completedAt",
  "startDate",
  "dueDate",
] as const;
export type DateDimension = (typeof DATE_DIMENSIONS)[number];

export const ANALYTICS_DIMENSIONS = [
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
  ...DATE_DIMENSIONS,
] as const;
export type BuiltInDimension = (typeof ANALYTICS_DIMENSIONS)[number];
export type AnalyticsDimension = BuiltInDimension | CustomFieldDisplayKey;
export type CategoryDimension = Exclude<AnalyticsDimension, DateDimension>;

export type DimensionInfo = {
  kind: "date" | "category";
  /** A task can hold several keys (K6). */
  many: boolean;
  /** The dimension has a `none` bucket (K5). */
  hasNone: boolean;
  /** At most this many x buckets; null: never truncated. */
  xCap: number | null;
  /** At most this many named segments before `other`; null: never folds. */
  segmentCap: number | null;
};

export const NOMINAL_X_CAP = 50;
export const DATE_X_CAP = 120;
export const SEGMENT_CAP = 5;
export const LABEL_SEGMENT_CAP = 8;

const nominal = (many: boolean, hasNone: boolean): DimensionInfo => ({
  kind: "category",
  many,
  hasNone,
  xCap: NOMINAL_X_CAP,
  segmentCap: SEGMENT_CAP,
});

const dated = (hasNone: boolean): DimensionInfo => ({
  kind: "date",
  many: false,
  hasNone,
  xCap: DATE_X_CAP,
  segmentCap: null,
});

export const DIMENSIONS: Record<BuiltInDimension, DimensionInfo> = {
  status: nominal(false, false),
  group: {
    kind: "category",
    many: false,
    hasNone: false,
    xCap: null,
    segmentCap: null,
  },
  priority: {
    kind: "category",
    many: false,
    hasNone: false,
    xCap: null,
    segmentCap: null,
  },
  assignee: nominal(true, true),
  createdBy: nominal(false, true),
  label: { ...nominal(true, true), segmentCap: LABEL_SEGMENT_CAP },
  cycle: nominal(false, true),
  module: nominal(true, true),
  estimate: nominal(false, true),
  project: nominal(false, false),
  createdAt: dated(false),
  completedAt: dated(true),
  startDate: dated(true),
  dueDate: dated(true),
};

/** A dropdown's values, like any single-valued category with no value. */
const CUSTOM_FIELD_DIMENSION = nominal(false, true);

export function dimensionInfo(dimension: AnalyticsDimension): DimensionInfo {
  return isCustomFieldDisplayKey(dimension)
    ? CUSTOM_FIELD_DIMENSION
    : DIMENSIONS[dimension];
}

export function isDateDimension(
  dimension: AnalyticsDimension,
): dimension is DateDimension {
  return (DATE_DIMENSIONS as readonly string[]).includes(dimension);
}

// --- date keys -------------------------------------------------------------

/**
 * The local calendar day of a timestamp in `timeZone`, as a SQL date. Task
 * timestamps are UTC wall times without a zone; intake timestamps carry one.
 */
export function localDaySql(
  column: AnyPgColumn | SQL,
  timeZone: string,
  withTimeZone = false,
): SQL {
  return withTimeZone
    ? sql`((${column}) at time zone ${timeZone})::date`
    : sql`(((${column}) at time zone 'UTC') at time zone ${timeZone})::date`;
}

/**
 * The bucket key ("YYYY-MM-DD" of the bucket's first day) of a SQL date, or
 * NULL for NULL. Weeks shift the day so the ISO (Monday) week lines up with
 * `weekStartsOn`, truncate, and shift back.
 */
export function bucketKeySql(
  day: SQL,
  bucket: DateBucket,
  weekStartsOn: WeekStart,
): SQL {
  if (bucket === "month") {
    return sql`to_char(date_trunc('month', (${day})::timestamp), 'YYYY-MM-DD')`;
  }
  // weekStartsOn is 0, 1 or 6, so the shift is a trusted small integer.
  const shift = sql.raw(String((7 + 1 - weekStartsOn) % 7));
  return sql`to_char(date_trunc('week', ((${day}) + ${shift})::timestamp) - interval '${shift} days', 'YYYY-MM-DD')`;
}

const DATE_COLUMNS: Record<DateDimension, AnyPgColumn> = {
  createdAt: taskTable.createdAt,
  completedAt: taskTable.completedAt,
  startDate: taskTable.startDate,
  dueDate: taskTable.dueDate,
};

function dateKeySql(
  dimension: DateDimension,
  context: QueryContext,
  bucket: DateBucket,
): SQL {
  const day = localDaySql(DATE_COLUMNS[dimension], context.timeZone);
  return sql`coalesce(${bucketKeySql(day, bucket, context.weekStartsOn)}, ${NONE_KEY}::text)`;
}

// --- estimate key ------------------------------------------------------------

const keyPoint = alias(estimatePointTable, "analytics_key_point");
const keyEstimate = alias(estimateTable, "analytics_key_estimate");

/** Types in estimate key order; points and time values are numbers. */
export const ESTIMATE_KEY_TYPES = ["points", "time", "categories"] as const;

/**
 * `<type>:<value>` of the task's point while its project has estimates on
 * and the point belongs to the project's active system. Numeric systems use
 * the number, so "3" in two projects is one bucket.
 */
function estimateKeySql(context: QueryContext): SQL {
  return sql`(case when ${featureOn("estimates", context)} and ${taskTable.estimatePointId} is not null then coalesce((
    select ${keyEstimate.type} || ':' || (case
      when ${keyEstimate.type} in ('points', 'time') and ${keyPoint.numericValue} is not null
        then ${keyPoint.numericValue}::text
      else ${keyPoint.value}
    end)
    from ${estimatePointTable} as ${sql.identifier("analytics_key_point")}
    inner join ${estimateTable} as ${sql.identifier("analytics_key_estimate")}
      on ${keyEstimate.id} = ${keyPoint.estimateId}
      and ${keyEstimate.projectId} = ${taskTable.projectId}
      and ${keyEstimate.isActive}
    where ${keyPoint.id} = ${taskTable.estimatePointId}
  ), ${NONE_KEY}::text) else ${NONE_KEY}::text end)`;
}

/**
 * The key expression of a dimension: text for single-valued dimensions, a
 * text array for many-valued ones (empty means `none`). Never NULL.
 */
export function dimensionKeySql(
  dimension: AnalyticsDimension,
  context: QueryContext,
  bucket: DateBucket,
): GroupKeyExpression {
  if (isDateDimension(dimension)) {
    return { many: false, sql: dateKeySql(dimension, context, bucket) };
  }
  if (dimension === "estimate") {
    return { many: false, sql: estimateKeySql(context) };
  }
  return groupKeyExpression(dimension satisfies GroupByKey, context);
}
