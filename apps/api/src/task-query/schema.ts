import { z } from "../openapi";
import { DATE_UNITS, type DateUnit } from "./dates";

// The task query request. Zod checks the shape; the filter tree's rules
// (known keys, operators, limits, dates) are checked by validate.ts with the
// engine's own messages. Saved views reuse these schemas, so a view can only
// store what the engine can run.

export const TASK_QUERY_MODES = ["rows", "ids", "counts"] as const;
export type TaskQueryMode = (typeof TASK_QUERY_MODES)[number];

export const ARCHIVED_FILTERS = ["exclude", "include", "only"] as const;
export type ArchivedFilter = (typeof ARCHIVED_FILTERS)[number];

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

// A custom field groups or sorts as `customField:<field id>`. A field id in
// the key keeps saved views and cursors working on one string; a task only
// holds values of its own project's fields, so an unknown or foreign id just
// reads as "no value".
export const CUSTOM_FIELD_KEY_PREFIX = "customField:";
export type CustomFieldDisplayKey = `customField:${string}`;
const CUSTOM_FIELD_KEY_PATTERN = /^customField:[\w-]{1,128}$/;

export function isCustomFieldDisplayKey(
  value: unknown,
): value is CustomFieldDisplayKey {
  return typeof value === "string" && CUSTOM_FIELD_KEY_PATTERN.test(value);
}

export function customFieldIdOfKey(key: CustomFieldDisplayKey): string {
  return key.slice(CUSTOM_FIELD_KEY_PREFIX.length);
}

// Typed as the template literal for the client; a plain pattern at runtime,
// which the OpenAPI generator can describe.
export const customFieldDisplayKeySchema = z
  .string()
  .regex(CUSTOM_FIELD_KEY_PATTERN) as unknown as z.ZodType<
  CustomFieldDisplayKey,
  CustomFieldDisplayKey
>;

export type GroupByKey = (typeof GROUP_BY_KEYS)[number] | CustomFieldDisplayKey;

export const groupByKeySchema = z.union([
  z.enum(GROUP_BY_KEYS),
  customFieldDisplayKeySchema,
]);

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
  "archivedAt",
  // Public board votes (B12): ups minus downs, then ups.
  "voteScore",
] as const;
export type BuiltInOrderField = (typeof ORDER_BY_FIELDS)[number];
export type OrderByField = BuiltInOrderField | CustomFieldDisplayKey;

export const orderByFieldSchema = z.union([
  z.enum(ORDER_BY_FIELDS),
  customFieldDisplayKeySchema,
]);

export const ORDER_DIRECTIONS = ["asc", "desc"] as const;
export type OrderDirection = (typeof ORDER_DIRECTIONS)[number];

export const TASK_QUERY_INCLUDES = [
  "labels",
  "assignees",
  "cycle",
  "modules",
  "estimate",
  "subTasks",
  "customFields",
  "externalLinks",
] as const;
export type TaskQueryInclude = (typeof TASK_QUERY_INCLUDES)[number];

export const FILTER_GROUP_OPS = ["and", "or"] as const;

export const MAX_FILTER_DEPTH = 3;
export const MAX_FILTER_CONDITIONS = 50;
export const MAX_GROUP_CHILDREN = 20;
export const MAX_CONDITION_VALUES = 100;
export const MAX_VALUE_LENGTH = 128;
export const MAX_SCOPE_PROJECTS = 100;
export const MAX_ROWS_PER_GROUP = 200;
export const DEFAULT_ROWS_PER_GROUP = 50;
export const MAX_TASK_QUERY_BODY_BYTES = 32 * 1024;

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
  op: (typeof FILTER_GROUP_OPS)[number];
  children: FilterNode[];
};

export type FilterNode = FilterGroup | FilterCondition;

export function isFilterGroup(node: FilterNode): node is FilterGroup {
  return "op" in node;
}

export const filterConditionSchema = z
  .object({
    key: z.string().min(1).max(64).openapi({
      description:
        "status, group, priority, assignee, createdBy, label, cycle, module, estimate, project, parent, blocked, customField, startDate, dueDate, createdAt, updatedAt or completedAt.",
    }),
    operator: z.string().min(1).max(32).openapi({
      description:
        "Set keys: in (is any of) or notIn (is none of). Date keys: on, onOrBefore, onOrAfter, between, withinLast, withinNext, moreThanAgo, moreThanAhead, in (presets), empty or notEmpty.",
    }),
    values: z.array(z.string()).optional().openapi({
      description:
        "Set keys: ids or tokens, OR-ed; `none` means no value and `me` the caller (assignee, createdBy). Label values are workspace label ids or `name:<label name>`; cycle values may be `current`; blocked takes `true` (an open task with an open blocker, not on public boards) or `false`. Date `in`: presets today, yesterday, tomorrow, thisWeek, lastWeek, nextWeek, thisMonth, lastMonth, nextMonth, past, future, none. At most 100 values of at most 128 characters.",
    }),
    date: z
      .string()
      .optional()
      .openapi({ description: "YYYY-MM-DD, for on, onOrBefore, onOrAfter." }),
    from: z
      .string()
      .optional()
      .openapi({ description: "YYYY-MM-DD, first day of between." }),
    to: z
      .string()
      .optional()
      .openapi({ description: "YYYY-MM-DD, last day of between." }),
    amount: z.number().int().optional().openapi({
      description:
        "1–365, for withinLast, withinNext, moreThanAgo, moreThanAhead.",
    }),
    unit: z.enum(DATE_UNITS).optional(),
    fieldId: z
      .string()
      .min(1)
      .max(128)
      .optional()
      .openapi({ description: "The custom field, for customField only." }),
  })
  .strict()
  .openapi("TaskQueryCondition", {
    description:
      "One condition. Only the fields its operator needs are allowed. Unknown ids match nothing (in) and exclude nothing (notIn).",
  });

export const filterNodeSchema: z.ZodType<FilterNode> = z
  .lazy(() => z.union([filterGroupSchema, filterConditionSchema]))
  .openapi("TaskQueryFilterNode", {
    description:
      "A condition, or an and/or group of 1–20 nodes. At most 3 levels (the root group is level 1) and 50 conditions in total.",
  });

const filterGroupSchema = z
  .object({
    op: z.enum(FILTER_GROUP_OPS),
    children: z.array(filterNodeSchema),
  })
  .strict()
  .openapi("TaskQueryFilterGroup");

export const taskQueryOrderBySchema = z
  .object({
    field: orderByFieldSchema.openapi({
      description:
        "A built-in field, or customField:<field id> to sort by a custom field's value.",
    }),
    direction: z.enum(ORDER_DIRECTIONS).optional().openapi({
      description:
        "Defaults per field: asc for manual, startDate, dueDate, title, number, status, assignee, label, cycle, module and custom fields; desc for the rest (archivedAt included). Nulls always come last.",
    }),
  })
  .strict()
  .openapi("TaskQueryOrderBy");

export const taskQueryDisplaySchema = z
  .object({
    groupBy: groupByKeySchema.nullable().optional().openapi({
      description:
        "A built-in key, or customField:<field id> to group by a custom field's value. status needs exactly one project in scope. Ignored in ids mode.",
    }),
    subGroupBy: groupByKeySchema.nullable().optional().openapi({
      description: "Needs groupBy and must differ from it.",
    }),
    orderBy: taskQueryOrderBySchema.optional().openapi({
      description:
        "Defaults to manual (asc) with projectIds in scope, createdAt (desc) for the whole workspace. Ties break by createdAt desc, then id.",
    }),
    showSubTasks: z.boolean().optional().openapi({
      description: "false keeps only tasks without a parent. Default true.",
    }),
    showEmptyGroups: z.boolean().optional().openapi({
      description:
        "Also list the key's empty groups (for example every priority). Default false.",
    }),
  })
  .strict()
  .openapi("TaskQueryDisplay");

export const taskQueryPageSchema = z
  .object({
    limit: z.number().int().min(1).max(MAX_ROWS_PER_GROUP).optional().openapi({
      description: "Rows per group (per cell when sub-grouped). Default 50.",
    }),
    group: z.string().min(1).max(512).optional().openapi({
      description:
        "Load the next slice of this group only (`all` when ungrouped).",
    }),
    subGroup: z.string().min(1).max(512).optional().openapi({
      description: "With group: load the next slice of this cell only.",
    }),
    cursor: z.string().min(1).max(64).optional().openapi({
      description: "The group's (or cell's) nextCursor.",
    }),
  })
  .strict()
  .openapi("TaskQueryPage");

export const taskQueryContextSchema = z
  .object({
    timeZone: z.string().min(1).max(64).optional().openapi({
      description: "IANA zone that date filters and `today` use. Default UTC.",
    }),
    weekStartsOn: z
      .union([z.literal(0), z.literal(1), z.literal(6)])
      .optional()
      .openapi({
        description: "0 Sunday, 1 Monday or 6 Saturday. Default 0.",
      }),
  })
  .strict()
  .openapi("TaskQueryContext");

export const taskQueryRequestSchema = z
  .object({
    workspaceId: z.string().min(1),
    scope: z
      .object({
        projectIds: z
          .array(z.string().min(1).max(128))
          .min(1)
          .max(MAX_SCOPE_PROJECTS)
          .optional()
          .openapi({
            description:
              "Projects of the workspace to search. Omitted means every non-archived project; archived projects are searched only when listed.",
          }),
      })
      .strict()
      .optional(),
    filters: filterNodeSchema.nullable().optional(),
    archived: z.enum(ARCHIVED_FILTERS).optional().openapi({
      description:
        "exclude (default) hides archived tasks, include adds them, only returns just them.",
    }),
    search: z.string().max(256).optional().openapi({
      description:
        "Title contains the text (case-insensitive), or a task key such as WEB-12, #12 or 12.",
    }),
    display: taskQueryDisplaySchema.optional(),
    include: z.array(z.enum(TASK_QUERY_INCLUDES)).optional().openapi({
      description:
        "Extra row data: labels, assignees, cycle, modules, estimate, subTasks (parentId and subTaskCount), customFields, externalLinks.",
    }),
    page: taskQueryPageSchema.optional(),
    mode: z.enum(TASK_QUERY_MODES).optional().openapi({
      description:
        "rows (default): groups, rows and meta. ids: every matching task id (at most 20,000), no grouping. counts: group counts only.",
    }),
    context: taskQueryContextSchema.optional(),
  })
  .strict()
  .openapi("TaskQueryRequest");

export type TaskQueryRequest = z.infer<typeof taskQueryRequestSchema>;
