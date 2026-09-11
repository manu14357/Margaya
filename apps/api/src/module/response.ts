import { CREATABLE_COLUMN_GROUPS } from "../column/groups";
import { estimateTotalsSchema } from "../estimate/response";
import { nullableResponseTimestamp, responseTimestamp, z } from "../openapi";
import {
  calendarDaySchema,
  nullableCalendarDaySchema,
  progressResponseSchemas,
} from "../task/progress-response";
import { moduleStatusSchema } from "./schema";

const progressSchemas = progressResponseSchemas("Module");

export const moduleCountsSchema = progressSchemas.counts;

const moduleUserSchema = z
  .object({ id: z.string(), name: z.string(), image: z.string().nullable() })
  .openapi("ModuleUser");

export const moduleSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    status: moduleStatusSchema,
    startDate: nullableCalendarDaySchema,
    targetDate: nullableCalendarDaySchema,
    leadId: z.string().nullable(),
    lead: moduleUserSchema.nullable(),
    memberIds: z.array(z.string()),
    position: z.number().openapi({
      description: "Manual order, ascending; new modules go first.",
    }),
    archivedAt: nullableResponseTimestamp,
    counts: moduleCountsSchema,
    pending: z.number().openapi({
      description: "Unfinished tasks: backlog + unstarted + started.",
    }),
    progress: z.number().openapi({
      description:
        "Percent done, 0–100: completed ÷ (total − cancelled), rounded. 0 without tasks, 100 when every task is cancelled.",
    }),
    createdBy: z.string().nullable(),
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
  })
  .openapi("Module");

export const moduleListSchema = z.array(moduleSchema);

export const moduleLinkSchema = z
  .object({
    id: z.string(),
    moduleId: z.string(),
    url: z.string(),
    title: z.string().nullable(),
    createdBy: z.string().nullable(),
    createdAt: responseTimestamp,
    updatedAt: responseTimestamp,
  })
  .openapi("ModuleLink");

export const moduleLinkListSchema = z.array(moduleLinkSchema);

export const moduleDetailSchema = moduleSchema
  .extend({
    links: z.array(moduleLinkSchema).openapi({
      description: "Newest first.",
    }),
    members: z.array(moduleUserSchema).openapi({
      description:
        "Ordered by name. Users who left the workspace are still listed.",
    }),
  })
  .openapi("ModuleDetail");

export const moduleProgressSchema = z
  .object({
    moduleId: z.string(),
    today: calendarDaySchema.openapi({
      description: "The server's UTC date the chart was computed against.",
    }),
    counts: moduleCountsSchema,
    pending: z.number(),
    progress: z.number(),
    chart: progressSchemas.chart.nullable().openapi({
      description:
        "Burn-down and burn-up data over every day from the start to the target date. Null when either date is missing, when no task is in scope, or when the range covers more than 731 days.",
    }),
    assignees: z.array(progressSchemas.assignee),
    labels: z.array(progressSchemas.label),
    priorities: z.array(progressSchemas.priority),
    estimates: estimateTotalsSchema.nullable().openapi({
      description:
        "Estimate totals over the same tasks. enabled is false while the project's estimates feature is off or no system is active.",
    }),
    estimateChart: progressSchemas.chart.nullable().openapi({
      description:
        "The chart in points mode: every number sums estimate values (minutes for time systems) instead of counting tasks, and tasks without an estimate weigh 0. Null when chart is null, or unless a numeric system is active and some task in scope is estimated.",
    }),
  })
  .openapi("ModuleProgress");

export const moduleTaskMapSchema = z.array(
  z
    .object({ taskId: z.string(), moduleId: z.string() })
    .openapi("ModuleTaskMapEntry"),
);

export const taskModuleRefListSchema = z.array(
  z
    .object({ id: z.string(), name: z.string(), status: moduleStatusSchema })
    .openapi("TaskModuleRef"),
);

export const moduleTaskChangeSchema = z
  .object({
    moduleId: z.string(),
    added: z.array(z.string()),
    removed: z.array(z.string()),
    unchanged: z.array(z.string()).openapi({
      description: "Already in this module (add), or not in it (remove).",
    }),
    ignored: z.array(z.string()).openapi({
      description:
        "Not a visible task of the module's project. Not an error, so repeated bulk calls stay safe.",
    }),
  })
  .openapi("ModuleTaskChange");

export const moduleTaskPageSchema = z
  .object({
    tasks: z.array(
      z
        .object({
          id: z.string(),
          number: z.number().nullable(),
          title: z.string(),
          status: z.string(),
          group: z.enum(CREATABLE_COLUMN_GROUPS),
          priority: z.string(),
          userId: z
            .string()
            .nullable()
            .openapi({ description: "The first assignee, or null." }),
          assigneeIds: z.array(z.string()).openapi({
            description: "Every assignee's user id, first assignee first.",
          }),
          dueDate: nullableResponseTimestamp,
        })
        .openapi("ModuleTask"),
    ),
    pagination: z
      .object({
        total: z.number(),
        page: z.number(),
        pageSize: z.number(),
        totalPages: z.number(),
      })
      .openapi("ModuleTaskPagination"),
  })
  .openapi("ModuleTaskPage");

export const moduleDeleteResultSchema = z
  .object({
    id: z.string(),
    projectId: z.string(),
    removedTaskIds: z.array(z.string()).openapi({
      description: "The tasks the module held; they stay in the project.",
    }),
  })
  .openapi("ModuleDeleteResult");

export const moduleLinkDeleteResultSchema = z
  .object({ id: z.string() })
  .openapi("ModuleLinkDeleteResult");
