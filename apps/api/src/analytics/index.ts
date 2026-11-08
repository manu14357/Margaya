import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import type { WeekStart } from "../task-query/dates";
import { boundedRequestBody } from "../utils/bounded-request-body";
import { readJsonBody } from "../utils/destination-project";
import {
  hasWorkspacePermission,
  projectsCappedAgainst,
  requireWorkspacePermission,
} from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import { getAnalyticsCycles } from "./controllers/get-cycles";
import { getAnalyticsIntake } from "./controllers/get-intake";
import { getAnalyticsModules } from "./controllers/get-modules";
import { getAnalyticsOverview } from "./controllers/get-overview";
import { getAnalyticsWorkload } from "./controllers/get-workload";
import { queryAnalyticsChart } from "./controllers/query-chart";
import { queryAnalyticsTrend } from "./controllers/query-trend";
import {
  analyticsChartResultSchema,
  analyticsCyclesSchema,
  analyticsIntakeSchema,
  analyticsModulesSchema,
  analyticsOverviewSchema,
  analyticsTrendResultSchema,
  analyticsWorkloadSchema,
} from "./response";
import {
  analyticsChartRequestSchema,
  analyticsIntakeQuerySchema,
  analyticsScopeQuerySchema,
  analyticsTrendRequestSchema,
  MAX_ANALYTICS_BODY_BYTES,
  parseProjectIdsParam,
} from "./schema";

// Read-only analytics over the task query engine's task set (B8). Every
// route needs analytics:read and task:read; the cycles, modules and intake
// tabs also need that resource's read. Nothing here publishes events.

const TAGS = ["Analytics"];
const TASK_ANALYTICS = { analytics: ["read"], task: ["read"] };

/**
 * A project role caps analytics like any right (restricted projects, guests):
 * naming a project whose role doesn't grant `permissions` is refused, and a
 * workspace-wide scope leaves those projects out. Reads the raw query or body
 * because route middleware runs before the validators.
 */
function capByProjectRoles(
  permissions: Record<string, string[]>,
  source: "query" | "body",
) {
  return async (c: Context, next: Next) => {
    const capped = await projectsCappedAgainst(c, permissions);
    if (capped.length > 0) {
      const raw =
        source === "query"
          ? (c.req.query("projectIds") ?? "").split(",")
          : obj((await readJsonBody(c)).scope).projectIds;
      const named = Array.isArray(raw)
        ? raw.filter((id): id is string => typeof id === "string")
        : [];
      if (named.some((id) => capped.includes(id.trim()))) {
        throw new HTTPException(403, { message: CAPPED_PROJECT });
      }
      c.set("analyticsExcludedProjectIds", capped);
    }
    return next();
  };
}

const obj = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const SCOPE_400 =
  "Invalid query, an unknown time zone, or not 1–100 comma-separated project ids";
const FORBIDDEN =
  "No workspace access, missing analytics:read or task:read permission, or a scope project whose project role lacks them";
const CAPPED_PROJECT =
  "Your project role in a scope project doesn't allow these analytics";
const NOT_FOUND = "A project id is not in the workspace";
const TIMEOUT = "Analytics took too long; narrow the filters and try again";

const RULES =
  " Totals count distinct tasks: a task with several assignees, labels or modules counts once in each of their buckets, so buckets (and stacked cells) can sum to more than the total. `none` is the bucket of tasks without a value, and a feature that is off in a project reads as none (points as 0). Archived tasks are left out unless archived is include or only; triage tasks never count. Completion % is completed ÷ (all − cancelled).";

const getOverviewRoute = createRoute({
  method: "get",
  operationId: "getAnalyticsOverview",
  path: "/overview",
  tags: TAGS,
  summary: "Get the analytics overview",
  description:
    "Headline numbers for the scope projects: members by role (workspace-wide), projects and their features, visible tasks per group with progress and overdue (open tasks due before today in timeZone), one row per project, and cycle, module and intake counts. Those three sections are null when no scope project has the feature on or the caller lacks its read permission. Archived and triage tasks are left out.",
  middleware: [
    workspaceAccess.fromQuery(),
    requireWorkspacePermission(TASK_ANALYTICS),
    capByProjectRoles(TASK_ANALYTICS, "query"),
  ] as const,
  request: { query: analyticsScopeQuerySchema },
  responses: {
    200: jsonResponse("The overview numbers", analyticsOverviewSchema),
    400: errorResponse(SCOPE_400),
    401: errorResponse("Not signed in"),
    403: errorResponse(FORBIDDEN),
    404: errorResponse(NOT_FOUND),
    503: errorResponse(TIMEOUT),
  },
});

const getWorkloadRoute = createRoute({
  method: "get",
  operationId: "getAnalyticsWorkload",
  path: "/workload",
  tags: TAGS,
  summary: "Get per-person workload",
  description:
    "Open work per assignee over the scope projects you can see, heaviest first: estimate points when a scope project has a points system and most open tasks are sized, otherwise task counts. A task with several assignees counts for each. Each person also gets a check against their own usual: what they finished in the last 56 days in the same scope projects, scaled to 28 days. Above it is over; without history it is unknown, never over. Archived and triage tasks are left out of open work. Computed, no AI.",
  middleware: [
    workspaceAccess.fromQuery(),
    requireWorkspacePermission(TASK_ANALYTICS),
    capByProjectRoles(TASK_ANALYTICS, "query"),
  ] as const,
  request: { query: analyticsScopeQuerySchema },
  responses: {
    200: jsonResponse("Open work per person", analyticsWorkloadSchema),
    400: errorResponse(SCOPE_400),
    401: errorResponse("Not signed in"),
    403: errorResponse(FORBIDDEN),
    404: errorResponse(NOT_FOUND),
    503: errorResponse(TIMEOUT),
  },
});

const queryChartRoute = createRoute({
  method: "post",
  operationId: "queryAnalyticsChart",
  path: "/chart",
  tags: TAGS,
  summary: "Query an analytics chart",
  description: `Counts tasks (or sums estimate points or a number custom field) by an x-axis dimension, optionally segmented by a second category dimension, over the task set that the task query filters describe. Buckets come in the dimension's natural order with none last (a dropdown custom field: its option order, removed options still on tasks after them); dates are bucketed by week or month in context.timeZone and zero-filled. At most 50 category buckets (120 date buckets, the most recent) are returned; segments beyond the top 5 (8 for labels) fold into \`other\`, whose cells are sums. A charted custom field must belong to a scope project the caller can see.${RULES}`,
  middleware: [
    boundedRequestBody(MAX_ANALYTICS_BODY_BYTES),
    workspaceAccess.fromBody(),
    requireWorkspacePermission(TASK_ANALYTICS),
    capByProjectRoles(TASK_ANALYTICS, "body"),
  ] as const,
  request: {
    body: {
      required: true,
      content: {
        "application/json": { schema: analyticsChartRequestSchema },
      },
    },
  },
  responses: {
    200: jsonResponse(
      "The chart's buckets and segments",
      analyticsChartResultSchema,
    ),
    400: errorResponse(
      "Invalid body, a segment equal to the x-axis or a date segment, status without exactly one project, an unknown custom field or one of the wrong type (a dimension must be a dropdown, a summed metric a number), an invalid filter tree, or an unknown time zone",
    ),
    401: errorResponse("Not signed in"),
    403: errorResponse(FORBIDDEN),
    404: errorResponse(NOT_FOUND),
    413: errorResponse("The body is larger than 32 KB"),
    503: errorResponse(TIMEOUT),
  },
});

const queryTrendRoute = createRoute({
  method: "post",
  operationId: "queryAnalyticsTrend",
  path: "/trend",
  tags: TAGS,
  summary: "Query created vs completed",
  description: `Per week or month from \`from\` to \`to\` (local days in context.timeZone, inclusive; the first and last buckets may be partial): tasks created, and tasks completed by their completedAt while still in the completed group, so a reopened task stops counting. At most five years, 106 weeks or 60 months.${RULES}`,
  middleware: [
    boundedRequestBody(MAX_ANALYTICS_BODY_BYTES),
    workspaceAccess.fromBody(),
    requireWorkspacePermission(TASK_ANALYTICS),
    capByProjectRoles(TASK_ANALYTICS, "body"),
  ] as const,
  request: {
    body: {
      required: true,
      content: {
        "application/json": { schema: analyticsTrendRequestSchema },
      },
    },
  },
  responses: {
    200: jsonResponse("The series and totals", analyticsTrendResultSchema),
    400: errorResponse(
      "Invalid body, an invalid date or range, too many buckets, an invalid filter tree, or an unknown time zone",
    ),
    401: errorResponse("Not signed in"),
    403: errorResponse(FORBIDDEN),
    404: errorResponse(NOT_FOUND),
    413: errorResponse("The body is larger than 32 KB"),
    503: errorResponse(TIMEOUT),
  },
});

const getCyclesRoute = createRoute({
  method: "get",
  operationId: "getAnalyticsCycles",
  path: "/cycles",
  tags: TAGS,
  summary: "Get cycle analytics",
  description:
    "Current, upcoming and draft cycles plus cycles completed in the last 180 days, of scope projects with cycles on (at most 300, by status then project). Counts follow the cycle progress route; a frozen cycle reports its snapshot. With exactly one such project, velocity lists its last 12 completed cycles (archived included), oldest first. Committed is total − cancelled. Points are null unless the project has estimates on with a points system. Dates use the server's UTC today.",
  middleware: [
    workspaceAccess.fromQuery(),
    requireWorkspacePermission({ ...TASK_ANALYTICS, cycle: ["read"] }),
    capByProjectRoles({ ...TASK_ANALYTICS, cycle: ["read"] }, "query"),
  ] as const,
  request: { query: analyticsScopeQuerySchema },
  responses: {
    200: jsonResponse(
      "Cycle rows, summary and velocity",
      analyticsCyclesSchema,
    ),
    400: errorResponse(SCOPE_400),
    401: errorResponse("Not signed in"),
    403: errorResponse(`${FORBIDDEN}, or missing cycle:read`),
    404: errorResponse(NOT_FOUND),
    503: errorResponse(TIMEOUT),
  },
});

const getModulesRoute = createRoute({
  method: "get",
  operationId: "getAnalyticsModules",
  path: "/modules",
  tags: TAGS,
  summary: "Get module analytics",
  description:
    "Non-archived modules of scope projects with modules on (at most 300; by project, status, target date and name) with counts following the module progress route, overdue flags (target date before the server's UTC today, not completed or cancelled) and a summary by status.",
  middleware: [
    workspaceAccess.fromQuery(),
    requireWorkspacePermission({ ...TASK_ANALYTICS, module: ["read"] }),
    capByProjectRoles({ ...TASK_ANALYTICS, module: ["read"] }, "query"),
  ] as const,
  request: { query: analyticsScopeQuerySchema },
  responses: {
    200: jsonResponse("Module rows and summary", analyticsModulesSchema),
    400: errorResponse(SCOPE_400),
    401: errorResponse("Not signed in"),
    403: errorResponse(`${FORBIDDEN}, or missing module:read`),
    404: errorResponse(NOT_FOUND),
    503: errorResponse(TIMEOUT),
  },
});

const getIntakeRoute = createRoute({
  method: "get",
  operationId: "getAnalyticsIntake",
  path: "/intake",
  tags: TAGS,
  summary: "Get intake analytics",
  description:
    "Over scope projects with intake on: all-time counts by effective status (an expired snooze is pending), requests submitted per bucket, requests decided per bucket by their latest decision time and current decision, the median hours from submission to decision, and submissions by source in the range. byProject is null when exactly one project is in scope. Same range limits as the trend.",
  middleware: [
    workspaceAccess.fromQuery(),
    requireWorkspacePermission({ ...TASK_ANALYTICS, intake: ["read"] }),
    capByProjectRoles({ ...TASK_ANALYTICS, intake: ["read"] }, "query"),
  ] as const,
  request: { query: analyticsIntakeQuerySchema },
  responses: {
    200: jsonResponse("Intake counts and series", analyticsIntakeSchema),
    400: errorResponse(
      `${SCOPE_400}, an invalid date or range, or too many buckets`,
    ),
    401: errorResponse("Not signed in"),
    403: errorResponse(`${FORBIDDEN}, or missing intake:read`),
    404: errorResponse(NOT_FOUND),
    503: errorResponse(TIMEOUT),
  },
});

type Variables = BaseVariables & {
  workspaceId: string;
  analyticsExcludedProjectIds?: string[];
};

const callerOf = (c: Context<{ Variables: Variables }>) => ({
  workspaceId: c.get("workspaceId"),
  userId: c.get("userId"),
  excludedProjectIds: c.get("analyticsExcludedProjectIds") ?? [],
});

const analytics = apiRouter<Variables>()
  .openapi(getOverviewRoute, async (c) => {
    const query = c.req.valid("query");
    const projectIds = parseProjectIdsParam(query.projectIds);
    const can = (resource: string) =>
      hasWorkspacePermission(c, { [resource]: ["read"] });
    const result = await getAnalyticsOverview(callerOf(c), {
      projectIds,
      timeZone: query.timeZone,
      sections: {
        cycles: await can("cycle"),
        modules: await can("module"),
        intake: await can("intake"),
      },
    });
    return c.json(result, 200);
  })
  .openapi(getWorkloadRoute, async (c) => {
    const query = c.req.valid("query");
    const result = await getAnalyticsWorkload(callerOf(c), {
      projectIds: parseProjectIdsParam(query.projectIds),
      timeZone: query.timeZone,
    });
    return c.json(result, 200);
  })
  .openapi(queryChartRoute, async (c) =>
    c.json(await queryAnalyticsChart(c.req.valid("json"), callerOf(c)), 200),
  )
  .openapi(queryTrendRoute, async (c) =>
    c.json(await queryAnalyticsTrend(c.req.valid("json"), callerOf(c)), 200),
  )
  .openapi(getCyclesRoute, async (c) => {
    const query = c.req.valid("query");
    const result = await getAnalyticsCycles(callerOf(c), {
      projectIds: parseProjectIdsParam(query.projectIds),
      timeZone: query.timeZone,
    });
    return c.json(result, 200);
  })
  .openapi(getModulesRoute, async (c) => {
    const query = c.req.valid("query");
    const result = await getAnalyticsModules(callerOf(c), {
      projectIds: parseProjectIdsParam(query.projectIds),
      timeZone: query.timeZone,
    });
    return c.json(result, 200);
  })
  .openapi(getIntakeRoute, async (c) => {
    const query = c.req.valid("query");
    const result = await getAnalyticsIntake(callerOf(c), {
      projectIds: parseProjectIdsParam(query.projectIds),
      timeZone: query.timeZone,
      from: query.from,
      to: query.to,
      bucket: query.bucket,
      weekStartsOn: Number(query.weekStartsOn ?? 0) as WeekStart,
    });
    return c.json(result, 200);
  });

export default analytics;

// Contracts for other slices: the web reads these shapes through the typed
// client; an MCP tool can call the chart the same way.
export { queryAnalyticsChart } from "./controllers/query-chart";
export { queryAnalyticsTrend } from "./controllers/query-trend";
export type {
  AnalyticsChartResult,
  AnalyticsCycleRow,
  AnalyticsCycles,
  AnalyticsIntake,
  AnalyticsMeta,
  AnalyticsModuleRow,
  AnalyticsModules,
  AnalyticsOverview,
  AnalyticsTrendResult,
  AnalyticsVelocityPoint,
  AnalyticsWorkload,
} from "./response";
