import { cycleAccess, requireCyclesFeatureForCycle } from "../cycle/access";
import { moduleAccess, requireModulesFeatureForModule } from "../module/access";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import { getForecast } from "./forecast";
import {
  deliveryForecastSchema,
  homeRisksSchema,
  riskRadarSchema,
} from "./response";
import { getHomeRisks, getScopeRisks } from "./risk";
import {
  cycleIdParam,
  homeRisksQuery,
  moduleIdParam,
  projectIdParam,
} from "./schema";

// Delivery forecast (A2) and risk radar (A3): read-only, computed, no LLM.
// Same audience as analytics (analytics:read and task:read), plus the
// cycle or module read and feature gate for those scopes. Nothing here
// publishes events; the web refreshes them with planning progress.

const TAGS = ["Delivery"];
const READ = { analytics: ["read"], task: ["read"] };
const TIMEOUT = "The computation took too long; retry later";
const FORBIDDEN = "No workspace access, or missing analytics:read or task:read";
const FEATURE_OFF = "the project's feature is off";

const FORECAST_DESCRIPTION =
  "Monte Carlo forecast of when the open tasks are done: the project's tasks completed per day over the last 56 days (from its start or first completion, if later; yesterday is the last day) are drawn at random, 10,000 times, with a generator seeded by the scope, today and the open count, so results are stable within a day. Returns the 50th, 85th and 95th percentile dates and, with an end date, the share of runs done by it. Below 14 days of history, 5 completions or 3 days with a completion, status is insufficient_history. Counts only.";

const RISKS_DESCRIPTION =
  "Computed risks of the open scope, ranked by severity: blocked chains (task relations blocks), the critical path over blocks and finish-before relations to the end date (weighted by the project's median cycle time), ageing work in progress past the p85 cycle time, overdue clusters and unassigned work due within 3 days. Blockers in projects you can't see are counted but never named.";

const cycleMiddleware = [
  cycleAccess("cycleId"),
  requireWorkspacePermission({ ...READ, cycle: ["read"] }),
  requireCyclesFeatureForCycle,
] as const;

const moduleMiddleware = [
  moduleAccess("moduleId"),
  requireWorkspacePermission({ ...READ, module: ["read"] }),
  requireModulesFeatureForModule,
] as const;

const projectMiddleware = [
  workspaceAccess.fromProject("projectId", {
    notFoundMessage: "Project not found",
  }),
  requireWorkspacePermission(READ),
] as const;

const getCycleForecastRoute = createRoute({
  method: "get",
  operationId: "getCycleForecast",
  path: "/cycle/{cycleId}/forecast",
  tags: TAGS,
  summary: "Forecast a cycle",
  description: FORECAST_DESCRIPTION,
  middleware: [...cycleMiddleware] as const,
  request: { params: cycleIdParam },
  responses: {
    200: jsonResponse("The forecast", deliveryForecastSchema),
    401: errorResponse("Not signed in"),
    403: errorResponse(`${FORBIDDEN} or cycle:read, or ${FEATURE_OFF}`),
    404: errorResponse("Unknown cycle, or a project you can't see"),
    503: errorResponse(TIMEOUT),
  },
});

const getModuleForecastRoute = createRoute({
  method: "get",
  operationId: "getModuleForecast",
  path: "/module/{moduleId}/forecast",
  tags: TAGS,
  summary: "Forecast a module",
  description: FORECAST_DESCRIPTION,
  middleware: [...moduleMiddleware] as const,
  request: { params: moduleIdParam },
  responses: {
    200: jsonResponse("The forecast", deliveryForecastSchema),
    401: errorResponse("Not signed in"),
    403: errorResponse(`${FORBIDDEN} or module:read, or ${FEATURE_OFF}`),
    404: errorResponse("Unknown module, or a project you can't see"),
    503: errorResponse(TIMEOUT),
  },
});

const getProjectForecastRoute = createRoute({
  method: "get",
  operationId: "getProjectForecast",
  path: "/project/{projectId}/forecast",
  tags: TAGS,
  summary: "Forecast a project's open work",
  description: FORECAST_DESCRIPTION,
  middleware: [...projectMiddleware] as const,
  request: { params: projectIdParam },
  responses: {
    200: jsonResponse("The forecast", deliveryForecastSchema),
    401: errorResponse("Not signed in"),
    403: errorResponse(FORBIDDEN),
    404: errorResponse("Unknown project, or one you can't see"),
    503: errorResponse(TIMEOUT),
  },
});

const getCycleRisksRoute = createRoute({
  method: "get",
  operationId: "getCycleRisks",
  path: "/cycle/{cycleId}/risks",
  tags: TAGS,
  summary: "Get a cycle's risk radar",
  description: RISKS_DESCRIPTION,
  middleware: [...cycleMiddleware] as const,
  request: { params: cycleIdParam },
  responses: {
    200: jsonResponse("The risk radar", riskRadarSchema),
    401: errorResponse("Not signed in"),
    403: errorResponse(`${FORBIDDEN} or cycle:read, or ${FEATURE_OFF}`),
    404: errorResponse("Unknown cycle, or a project you can't see"),
    503: errorResponse(TIMEOUT),
  },
});

const getModuleRisksRoute = createRoute({
  method: "get",
  operationId: "getModuleRisks",
  path: "/module/{moduleId}/risks",
  tags: TAGS,
  summary: "Get a module's risk radar",
  description: RISKS_DESCRIPTION,
  middleware: [...moduleMiddleware] as const,
  request: { params: moduleIdParam },
  responses: {
    200: jsonResponse("The risk radar", riskRadarSchema),
    401: errorResponse("Not signed in"),
    403: errorResponse(`${FORBIDDEN} or module:read, or ${FEATURE_OFF}`),
    404: errorResponse("Unknown module, or a project you can't see"),
    503: errorResponse(TIMEOUT),
  },
});

const getProjectRisksRoute = createRoute({
  method: "get",
  operationId: "getProjectRisks",
  path: "/project/{projectId}/risks",
  tags: TAGS,
  summary: "Get a project's risk radar",
  description: `${RISKS_DESCRIPTION} A project has no end date, so there is no critical-path deadline; at most 2000 open tasks are read.`,
  middleware: [...projectMiddleware] as const,
  request: { params: projectIdParam },
  responses: {
    200: jsonResponse("The risk radar", riskRadarSchema),
    401: errorResponse("Not signed in"),
    403: errorResponse(FORBIDDEN),
    404: errorResponse("Unknown project, or one you can't see"),
    503: errorResponse(TIMEOUT),
  },
});

const getHomeRisksRoute = createRoute({
  method: "get",
  operationId: "getHomeRisks",
  path: "/home/risks",
  tags: TAGS,
  summary: "Get the top risks for Home",
  description:
    "The 8 highest risks across the current cycles (at most 20, latest started first) of the workspace's projects you can see that have cycles on. Each signal names its project and cycle.",
  middleware: [
    workspaceAccess.fromQuery(),
    requireWorkspacePermission({ ...READ, cycle: ["read"] }),
  ] as const,
  request: { query: homeRisksQuery },
  responses: {
    200: jsonResponse("The top risks", homeRisksSchema),
    401: errorResponse("Not signed in"),
    403: errorResponse(`${FORBIDDEN} or cycle:read`),
    503: errorResponse(TIMEOUT),
  },
});

type Variables = BaseVariables & { workspaceId: string };

const delivery = apiRouter<Variables>()
  .openapi(getCycleForecastRoute, async (c) =>
    c.json(await getForecast("cycle", c.req.valid("param").cycleId), 200),
  )
  .openapi(getModuleForecastRoute, async (c) =>
    c.json(await getForecast("module", c.req.valid("param").moduleId), 200),
  )
  .openapi(getProjectForecastRoute, async (c) =>
    c.json(await getForecast("project", c.req.valid("param").projectId), 200),
  )
  .openapi(getCycleRisksRoute, async (c) =>
    c.json(
      await getScopeRisks(
        "cycle",
        c.req.valid("param").cycleId,
        c.get("userId"),
      ),
      200,
    ),
  )
  .openapi(getModuleRisksRoute, async (c) =>
    c.json(
      await getScopeRisks(
        "module",
        c.req.valid("param").moduleId,
        c.get("userId"),
      ),
      200,
    ),
  )
  .openapi(getProjectRisksRoute, async (c) =>
    c.json(
      await getScopeRisks(
        "project",
        c.req.valid("param").projectId,
        c.get("userId"),
      ),
      200,
    ),
  )
  .openapi(getHomeRisksRoute, async (c) =>
    c.json(
      await getHomeRisks({
        workspaceId: c.get("workspaceId"),
        userId: c.get("userId"),
      }),
      200,
    ),
  );

export default delivery;
