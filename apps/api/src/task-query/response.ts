import { columnGroupSchema } from "../column/response";
import { CYCLE_STATUSES } from "../cycle/types";
import { ESTIMATE_TYPES } from "../estimate/types";
import { MODULE_STATUSES } from "../module/types";
import { nullableResponseTimestamp, responseTimestamp, z } from "../openapi";
import { taskExternalLinkSchema } from "../task/response";
import { groupByKeySchema, TASK_QUERY_MODES } from "./schema";

export const taskQueryRowSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    number: z.number().nullable(),
    key: z.string().openapi({ description: "Project key and number: WEB-12." }),
    title: z.string(),
    status: z.string().openapi({
      description: "The column slug, or planned. Never archived.",
    }),
    columnId: z.string().nullable(),
    group: columnGroupSchema.openapi({
      description: "The column's group; planned tasks are backlog.",
    }),
    priority: z.string(),
    startDate: nullableResponseTimestamp,
    dueDate: nullableResponseTimestamp,
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
    completedAt: nullableResponseTimestamp,
    archivedAt: nullableResponseTimestamp.openapi({
      description: "Set while the task is archived; the column is kept.",
    }),
    createdBy: z.string().nullable().openapi({
      description: "Who created the task; null for integration-made tasks.",
    }),
    userId: z.string().nullable().openapi({
      description: "The first assignee, or null.",
    }),
    position: z.number().nullable(),
    isRecurring: z.boolean().optional().openapi({
      description:
        "True while the task repeats (it holds the series' repeat rule).",
    }),
    assigneeIds: z.array(z.string()).optional().openapi({
      description: "include=assignees: every assignee, first assignee first.",
    }),
    labels: z
      .array(z.object({ name: z.string(), color: z.string() }))
      .optional()
      .openapi({
        description:
          "include=labels: by name, with the workspace label's color when one has the name.",
      }),
    cycleId: z.string().nullable().optional().openapi({
      description: "include=cycle: null while the project's cycles are off.",
    }),
    moduleIds: z.array(z.string()).optional().openapi({
      description:
        "include=modules: active modules; empty while the project's modules are off.",
    }),
    estimatePointId: z.string().nullable().optional().openapi({
      description:
        "include=estimate: null while the project's estimates are off.",
    }),
    parentId: z.string().nullable().optional().openapi({
      description: "include=subTasks: the parent task (oldest subtask link).",
    }),
    subTaskCount: z.number().optional().openapi({
      description: "include=subTasks: visible sub-tasks.",
    }),
    customFieldValues: z
      .array(z.object({ fieldId: z.string(), value: z.string() }))
      .optional()
      .openapi({ description: "include=customFields." }),
    externalLinks: z
      .array(taskExternalLinkSchema)
      .optional()
      .openapi({ description: "include=externalLinks." }),
  })
  .openapi("TaskQueryRow");

export const taskQuerySubGroupSchema = z
  .object({
    key: z.string().openapi({
      description:
        "The group value: a column slug, group, priority, user, `name:<label>`, cycle, module, estimate point or project id, or `value:<value>` for a custom field; `none` for no value; `all` when ungrouped.",
    }),
    count: z.number().openapi({ description: "Exact distinct tasks." }),
    taskIds: z.array(z.string()).optional().openapi({
      description:
        "This page of the group, in order; empty for groups past the row cap. Omitted in counts mode.",
    }),
    nextCursor: z.string().nullable().openapi({
      description:
        "Send as page.cursor (with page.group, and page.subGroup for a cell) to load more.",
    }),
  })
  .openapi("TaskQuerySubGroup");

export const taskQueryGroupSchema = taskQuerySubGroupSchema
  .extend({
    subGroups: z.array(taskQuerySubGroupSchema).optional().openapi({
      description: "Cells of the group when sub-grouped; rows live there.",
    }),
  })
  .openapi("TaskQueryGroup");

export const taskQueryMetaSchema = z
  .object({
    users: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        image: z.string().nullable(),
      }),
    ),
    projects: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        slug: z.string(),
        icon: z.string().nullable(),
        position: z.number(),
        cyclesEnabled: z.boolean(),
        modulesEnabled: z.boolean(),
        estimatesEnabled: z.boolean(),
      }),
    ),
    columns: z.array(
      z.object({
        projectId: z.string(),
        slug: z.string(),
        name: z.string(),
        icon: z.string().nullable(),
        group: columnGroupSchema,
        position: z.number(),
        isFinal: z.boolean(),
      }),
    ),
    labels: z.array(
      z.object({
        key: z.string(),
        name: z.string(),
        color: z.string(),
        workspaceLabelId: z.string().nullable(),
      }),
    ),
    cycles: z.array(
      z.object({
        id: z.string(),
        projectId: z.string(),
        name: z.string(),
        status: z.enum(CYCLE_STATUSES),
      }),
    ),
    modules: z.array(
      z.object({
        id: z.string(),
        projectId: z.string(),
        name: z.string(),
        status: z.enum(MODULE_STATUSES),
      }),
    ),
    estimatePoints: z.array(
      z.object({
        id: z.string(),
        projectId: z.string(),
        value: z.string(),
        position: z.number(),
        type: z.enum(ESTIMATE_TYPES),
      }),
    ),
    customFields: z.array(
      z.object({
        id: z.string(),
        projectId: z.string(),
        name: z.string(),
        type: z.string(),
        required: z.boolean(),
        options: z.unknown().nullable(),
      }),
    ),
  })
  .openapi("TaskQueryMeta", {
    description:
      "Lookups for what the rows and group keys reference. Users are workspace members, without emails.",
  });

export const taskQueryResultSchema = z
  .object({
    mode: z.enum(TASK_QUERY_MODES),
    groupBy: groupByKeySchema.nullable(),
    subGroupBy: groupByKeySchema.nullable(),
    today: z.string().openapi({
      description: "The requester's date (YYYY-MM-DD) in context.timeZone.",
    }),
    totalCount: z.number().openapi({ description: "Distinct matching tasks." }),
    groups: z.array(taskQueryGroupSchema).openapi({
      description:
        "In display order; one `all` group when ungrouped; empty in ids mode.",
    }),
    hasMoreGroups: z.boolean().openapi({
      description: "More than 100 groups: the rest carry counts, not rows.",
    }),
    tasks: z.record(z.string(), taskQueryRowSchema).openapi({
      description: "Task id to row; a task in several groups appears once.",
    }),
    meta: taskQueryMetaSchema,
    ids: z.array(z.string()).optional().openapi({
      description:
        "ids mode: every matching task id, unordered; empty when truncated.",
    }),
    truncated: z.boolean().optional().openapi({
      description: "ids mode: more than 20,000 matches.",
    }),
  })
  .openapi("TaskQueryResult");
