import { HTTPException } from "hono/http-exception";
import { z } from "../openapi";
import {
  ARCHIVED_FILTERS,
  filterNodeSchema,
  MAX_SCOPE_PROJECTS,
  taskQueryContextSchema,
} from "../task-query/schema";
import { DATE_BUCKETS } from "./buckets";
import { ANALYTICS_DIMENSIONS } from "./dimensions";
import { ANALYTICS_METRICS } from "./metrics";

// Analytics requests (B8 §3.3). The task set fields (scope, filters,
// archived, sub-tasks, context) are the task query engine's own, so a
// filter means the same thing on a board, in a view and in a chart.

export const MAX_ANALYTICS_BODY_BYTES = 32 * 1024;
export const MAX_PROJECT_ID_LENGTH = 128;

export const PROJECT_IDS_MESSAGE = "Provide between 1 and 100 project ids";
export const SEGMENT_MUST_DIFFER = "The segment must differ from the x-axis";
export const DATES_ONLY_ON_X = "Dates can only be used on the x-axis";
export const STATUS_NEEDS_ONE_PROJECT =
  "Status needs a single project; use Group instead";
export const ANALYTICS_TIMEOUT =
  "Analytics took too long; narrow the filters and try again";

const projectIdsSchema = z
  .array(z.string().min(1).max(MAX_PROJECT_ID_LENGTH))
  .min(1, PROJECT_IDS_MESSAGE)
  .max(MAX_SCOPE_PROJECTS, PROJECT_IDS_MESSAGE)
  .optional()
  .openapi({
    description:
      "1–100 projects of the workspace. Omitted means every non-archived project; archived projects count only when listed.",
  });

const taskSetFields = {
  workspaceId: z.string().min(1),
  scope: z.object({ projectIds: projectIdsSchema }).strict().optional(),
  filters: filterNodeSchema.nullable().optional().openapi({
    description:
      "The task query filter tree, with the same keys, operators, limits and messages.",
  }),
  archived: z.enum(ARCHIVED_FILTERS).optional().openapi({
    description:
      "exclude (default) leaves archived tasks out, include adds them, only counts just them.",
  }),
  showSubTasks: z.boolean().optional().openapi({
    description: "false counts top-level tasks only. Default true.",
  }),
  context: taskQueryContextSchema.optional(),
};

export const analyticsDimensionSchema = z
  .enum(ANALYTICS_DIMENSIONS)
  .openapi("AnalyticsDimension", {
    description:
      "status (one project only), group, priority, assignee, createdBy, label, cycle, module, estimate, project, or a date: createdAt, completedAt, startDate, dueDate (x-axis only).",
  });

export const analyticsMetricSchema = z
  .enum(ANALYTICS_METRICS)
  .openapi("AnalyticsMetric", {
    description:
      "taskCount counts distinct tasks; estimatePoints sums point values of projects with estimates on and an active points system (0 otherwise).",
  });

export const analyticsDateBucketSchema = z
  .enum(DATE_BUCKETS)
  .openapi("AnalyticsDateBucket");

export const analyticsChartRequestSchema = z
  .object({
    ...taskSetFields,
    xAxis: analyticsDimensionSchema,
    segment: analyticsDimensionSchema.nullable().optional().openapi({
      description:
        "A category dimension other than the x-axis, or null for none.",
    }),
    metric: analyticsMetricSchema.optional(),
    dateBucket: analyticsDateBucketSchema.optional().openapi({
      description: "Used when the x-axis is a date. Default month.",
    }),
    includeNone: z.boolean().optional().openapi({
      description:
        "false hides the none bucket and segment from the output only; totals still count those tasks. Default true.",
    }),
  })
  .strict()
  .openapi("AnalyticsChartRequest");

export type AnalyticsChartRequest = z.infer<typeof analyticsChartRequestSchema>;

export const analyticsTrendRequestSchema = z
  .object({
    ...taskSetFields,
    from: z.string().min(1).max(32).openapi({
      description: "First local day, YYYY-MM-DD (inclusive).",
    }),
    to: z.string().min(1).max(32).openapi({
      description: "Last local day, YYYY-MM-DD (inclusive).",
    }),
    bucket: analyticsDateBucketSchema,
    metric: analyticsMetricSchema.optional(),
  })
  .strict()
  .openapi("AnalyticsTrendRequest");

export type AnalyticsTrendRequest = z.infer<typeof analyticsTrendRequestSchema>;

const scopeQueryFields = {
  workspaceId: z.string().min(1),
  projectIds: z.string().optional().openapi({
    description:
      "Comma-separated project ids (1–100). Omitted means every non-archived project of the workspace.",
  }),
  timeZone: z.string().max(64).optional().openapi({
    description:
      "IANA time zone for local days. Default: the workspace's time zone (UTC unless set in workspace settings).",
  }),
};

export const analyticsScopeQuerySchema = z.object(scopeQueryFields);

export const analyticsIntakeQuerySchema = z.object({
  ...scopeQueryFields,
  from: z.string().min(1).max(32).openapi({
    description: "First local day, YYYY-MM-DD (inclusive).",
  }),
  to: z.string().min(1).max(32).openapi({
    description: "Last local day, YYYY-MM-DD (inclusive).",
  }),
  bucket: analyticsDateBucketSchema,
  weekStartsOn: z.enum(["0", "1", "6"]).optional().openapi({
    description: "0 Sunday (default), 1 Monday or 6 Saturday.",
  }),
});

/**
 * A comma-separated `projectIds` query value: trimmed and de-duplicated,
 * 1–100 ids of at most 128 characters, no empty entries.
 */
export function parseProjectIdsParam(
  raw: string | undefined,
): string[] | undefined {
  if (raw === undefined) return undefined;
  const ids = raw.split(",").map((id) => id.trim());
  const unique = [...new Set(ids)];
  if (
    unique.length < 1 ||
    unique.length > MAX_SCOPE_PROJECTS ||
    unique.some((id) => id === "" || id.length > MAX_PROJECT_ID_LENGTH)
  ) {
    throw new HTTPException(400, { message: PROJECT_IDS_MESSAGE });
  }
  return unique;
}
