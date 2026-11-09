import { parseISO } from "date-fns";
import { COLUMN_GROUP_META, isColumnGroup } from "@/lib/column-groups";
import { formatEstimateValue } from "@/lib/estimate/format";
import { isEstimateType } from "@/lib/estimate/values";
import { formatDate, formatDateMedium, formatDateShort } from "@/lib/format";
import { resolveLabelColor } from "@/lib/label-color";
import type {
  AnalyticsDateBucket,
  AnalyticsDimension,
  AnalyticsMeta,
  AnalyticsMetric,
} from "@/types/analytics";
import {
  dimensionInfo,
  fieldIdOfDimension,
  isCustomFieldDimension,
  isDateDimension,
} from "./dimensions";

// Display names for analytics keys. Keys come from the API (ids, slugs,
// `name:<label>`, `<type>:<value>`, `value:<option>` for custom fields,
// bucket days, `none`, `other`); names
// come from the response's meta and from i18n. Bucket days are parsed with
// parseISO (local midnight), never `new Date(key)`, which would read them as
// UTC and show the previous day west of Greenwich.

export type Translate = (
  key: string,
  options?: Record<string, unknown>,
) => string;

export const NONE_KEY = "none";
export const OTHER_KEY = "other";
export const LABEL_KEY_PREFIX = "name:";
/** A custom field value's key: its text after the prefix. */
export const FIELD_VALUE_KEY_PREFIX = "value:";

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

export function isDayKey(value: unknown): value is string {
  return typeof value === "string" && DAY_KEY.test(value);
}

export type LabelContext = {
  t: Translate;
  meta?: Partial<AnalyticsMeta>;
  /** Date x-axes: how the keys were bucketed. */
  dateBucket?: AnalyticsDateBucket | null;
  /** The server's today (YYYY-MM-DD); months of this year drop the year. */
  today?: string;
  locale?: string;
};

/** "Mar 2026", or "Mar" in the current year; weeks read "Mar 3". */
export function formatBucketDay(
  key: string,
  bucket: AnalyticsDateBucket | null | undefined,
  { today, locale }: Pick<LabelContext, "today" | "locale"> = {},
): string {
  const date = parseISO(key);
  if (bucket === "month") {
    const sameYear = today?.slice(0, 4) === key.slice(0, 4);
    return formatDate(
      date,
      sameYear ? { month: "short" } : { month: "short", year: "numeric" },
      locale,
    );
  }
  return formatDateShort(date, locale);
}

/**
 * The tooltip title of a period: its (possibly clipped) range when known,
 * else "Week of Mar 3, 2026" or "March 2026".
 */
export function periodTitle(
  {
    start,
    rangeStart,
    rangeEnd,
  }: { start: string; rangeStart?: string; rangeEnd?: string },
  bucket: AnalyticsDateBucket | null | undefined,
  { t, locale }: Pick<LabelContext, "t" | "locale">,
): string {
  if (rangeStart && rangeEnd) {
    if (rangeStart === rangeEnd) {
      return formatDateMedium(parseISO(rangeStart), locale);
    }
    return t("analytics:buckets.range", {
      from: formatDateShort(parseISO(rangeStart), locale),
      to: formatDateMedium(parseISO(rangeEnd), locale),
    });
  }
  if (bucket === "month") {
    return formatDate(
      parseISO(start),
      { month: "long", year: "numeric" },
      locale,
    );
  }
  return t("analytics:buckets.weekOf", {
    date: formatDateMedium(parseISO(start), locale),
  });
}

function estimateLabel(key: string, context: LabelContext): string {
  const found = context.meta?.estimates?.find((entry) => entry.key === key);
  const separator = key.indexOf(":");
  const type = found?.type ?? key.slice(0, separator);
  const value = found?.value ?? key.slice(separator + 1);
  if (!isEstimateType(type)) return value;
  return formatEstimateValue(type, value, { withUnit: true, t: context.t });
}

/** The display name of one key of a dimension. */
export function bucketLabel(
  dimension: AnalyticsDimension,
  key: string,
  context: LabelContext,
): string {
  const { t, meta } = context;
  if (key === OTHER_KEY) return t("analytics:other");
  if (key === NONE_KEY) {
    const noneKey = dimensionInfo(dimension).noneKey;
    return noneKey ? t(noneKey) : key;
  }
  if (isCustomFieldDimension(dimension)) {
    return key.startsWith(FIELD_VALUE_KEY_PREFIX)
      ? key.slice(FIELD_VALUE_KEY_PREFIX.length)
      : key;
  }
  if (isDateDimension(dimension)) {
    return isDayKey(key)
      ? formatBucketDay(key, context.dateBucket, context)
      : key;
  }
  switch (dimension) {
    case "group":
      return isColumnGroup(key) ? t(COLUMN_GROUP_META[key].labelKey) : key;
    case "priority":
      return t(`tasks:priority.${key}`);
    case "status": {
      const column = meta?.columns?.find((entry) => entry.slug === key);
      if (column) return column.name;
      return key === "planned" ? t("tasks:status.planned") : key;
    }
    case "assignee":
    case "createdBy":
      return meta?.users?.find((user) => user.id === key)?.name ?? key;
    case "label":
      return (
        meta?.labels?.find((label) => label.key === key)?.name ??
        (key.startsWith(LABEL_KEY_PREFIX)
          ? key.slice(LABEL_KEY_PREFIX.length)
          : key)
      );
    case "cycle":
      return meta?.cycles?.find((cycle) => cycle.id === key)?.name ?? key;
    case "module":
      return meta?.modules?.find((found) => found.id === key)?.name ?? key;
    case "estimate":
      return estimateLabel(key, context);
    case "project":
      return meta?.projects?.find((project) => project.id === key)?.name ?? key;
    default:
      return key;
  }
}

/** "Tasks", "Estimate points" or "Sum of Budget". */
export function metricLabel(
  metric: AnalyticsMetric,
  t: Translate,
  fields?: readonly { id: string; name: string }[],
): string {
  if (metric === "estimatePoints") return t("analytics:metric.points");
  if (isCustomFieldDimension(metric)) {
    const id = fieldIdOfDimension(metric);
    const name = fields?.find((field) => field.id === id)?.name;
    return name
      ? t("analytics:metric.sumOf", { name })
      : t("analytics:metric.sum");
  }
  return t("analytics:metric.tasks");
}

/** Label keys' own colors, resolved to CSS colors for the charts. */
export function labelColors(
  meta: Partial<AnalyticsMeta> | undefined,
): Record<string, string> {
  return Object.fromEntries(
    (meta?.labels ?? []).map((label) => [
      label.key,
      resolveLabelColor(label.color),
    ]),
  );
}
