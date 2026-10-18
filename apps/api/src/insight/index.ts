import { cycleAccess, requireCyclesFeatureForCycle } from "../cycle/access";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { requireProjectFeature } from "../project/features";
import {
  requireWorkspacePermission,
  workspacePermissionChecker,
} from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import { getCalibration, getEstimateSuggestion } from "./calibration";
import { getCycleCapacity } from "./capacity";
import { computeMyBrief } from "./my-brief";
import {
  cycleCapacitySchema,
  estimateCalibrationSchema,
  estimateSuggestionSchema,
  myBriefSchema,
  retroFactsSchema,
} from "./response";
import { computeRetroFacts } from "./retro";
import {
  cycleIdParam,
  projectIdParam,
  suggestionQuery,
  workspaceIdQuery,
} from "./schema";

// Planning insights (report 03, #9, #10, #15, #18), computed without any
// model: estimate suggestions and calibration, the cycle capacity check,
// retrospective facts and My brief. Read-only; nothing here publishes
// events. The optional AI narration of these facts lives in insight/ai.ts.

const TAGS = ["Insights"];
const FEATURE_OFF = "the project's feature is off";

const estimateRead = [
  workspaceAccess.fromProject("projectId", {
    notFoundMessage: "Project not found",
  }),
  requireWorkspacePermission({ task: ["read"] }),
  requireProjectFeature("estimates"),
] as const;

const cycleInsight = [
  cycleAccess("cycleId"),
  requireWorkspacePermission({
    cycle: ["read"],
    task: ["read"],
    analytics: ["read"],
  }),
  requireCyclesFeatureForCycle,
] as const;

const suggestionRoute = createRoute({
  method: "get",
  operationId: "getEstimateSuggestion",
  path: "/estimate/project/{projectId}/suggestion",
  tags: TAGS,
  summary: "Suggest an estimate from similar tasks",
  description:
    "The estimate that similar completed tasks of the project usually had, with their actual cycle times (first start to completion). Similar means a full-text match on the title (run as you, so only what you can see) plus shared labels; the value is the weighted mode of their estimates. Needs at least 3 similar completed, estimated tasks. Computed, no AI.",
  middleware: [...estimateRead] as const,
  request: { params: projectIdParam, query: suggestionQuery },
  responses: {
    200: jsonResponse("The suggestion", estimateSuggestionSchema),
    400: errorResponse("Neither taskId nor title"),
    403: errorResponse(
      `No workspace access, missing task:read, or ${FEATURE_OFF}`,
    ),
    404: errorResponse("Unknown project or task, or one you can't see"),
  },
});

const calibrationRoute = createRoute({
  method: "get",
  operationId: "getEstimateCalibration",
  path: "/estimate/project/{projectId}/calibration",
  tags: TAGS,
  summary: "Get the team's estimate calibration",
  description:
    "Estimate against actual cycle time: for each value of the active estimate system, the quartiles and range of the cycle times of tasks completed at that size in the last 180 days (at most 500 tasks). Computed, no AI.",
  middleware: [
    workspaceAccess.fromProject("projectId", {
      notFoundMessage: "Project not found",
    }),
    requireWorkspacePermission({ task: ["read"], analytics: ["read"] }),
    requireProjectFeature("estimates"),
  ] as const,
  request: { params: projectIdParam },
  responses: {
    200: jsonResponse("The calibration", estimateCalibrationSchema),
    403: errorResponse(
      `No workspace access, missing task:read or analytics:read, or ${FEATURE_OFF}`,
    ),
    404: errorResponse("Unknown project, or one you can't see"),
  },
});

const capacityRoute = createRoute({
  method: "get",
  operationId: "getCycleCapacity",
  path: "/capacity/cycle/{cycleId}",
  tags: TAGS,
  summary: "Check a cycle's capacity",
  description:
    "The cycle's committed work (tasks not cancelled; estimate points when the system is numeric and most tasks are sized) against what the team finished in comparable time: up to 6 ended cycles of the project scaled to this cycle's length, else daily throughput over the last 56 days. Over a usual cycle (the median), it suggests not-started tasks to defer, lowest priority and fewest dependants first. Per-assignee load is returned only to people with cycle:update. Computed, no AI.",
  middleware: [...cycleInsight] as const,
  request: { params: cycleIdParam },
  responses: {
    200: jsonResponse("The capacity check", cycleCapacitySchema),
    401: errorResponse("Not signed in"),
    403: errorResponse(
      `No workspace access, missing cycle:read, task:read or analytics:read, or ${FEATURE_OFF}`,
    ),
    404: errorResponse("Unknown cycle, or a project you can't see"),
  },
});

const retroRoute = createRoute({
  method: "get",
  operationId: "getRetroFacts",
  path: "/retro/cycle/{cycleId}",
  tags: TAGS,
  summary: "Get a cycle's retrospective facts",
  description:
    "Team-level facts of a cycle, computed from its history: work committed at the start and done (say/do), scope added and removed during the cycle, work carried over to another cycle or left open, reopened tasks, cycle-time outliers (above the project's 85th percentile), blocked tasks and how the earliest shared forecast held. No per-person figures. Computed, no AI.",
  middleware: [...cycleInsight] as const,
  request: { params: cycleIdParam },
  responses: {
    200: jsonResponse("The facts", retroFactsSchema),
    401: errorResponse("Not signed in"),
    403: errorResponse(
      `No workspace access, missing cycle:read, task:read or analytics:read, or ${FEATURE_OFF}`,
    ),
    404: errorResponse("Unknown cycle, or a project you can't see"),
    409: errorResponse("The cycle has no dates"),
  },
});

const myBriefRoute = createRoute({
  method: "get",
  operationId: "getMyBrief",
  path: "/my-brief",
  tags: TAGS,
  summary: "Get my brief",
  description:
    "Your daily brief in a workspace, from what you can see: your open tasks due today (in your time zone) or overdue, unread mentions of the last 7 days, your open tasks waiting on an open blocker, and changes by others in the last 24 hours to tasks you follow (watched, or assigned and not muted). Computed, no AI.",
  middleware: [
    workspaceAccess.fromQuery(),
    requireWorkspacePermission({ task: ["read"] }),
  ] as const,
  request: { query: workspaceIdQuery },
  responses: {
    200: jsonResponse("The brief", myBriefSchema),
    401: errorResponse("Not signed in"),
    403: errorResponse("No workspace access, or missing task:read"),
  },
});

type Variables = BaseVariables & { workspaceId: string; projectId?: string };

const insight = apiRouter<Variables>()
  .openapi(suggestionRoute, async (c) => {
    const { projectId } = c.req.valid("param");
    const { taskId, title } = c.req.valid("query");
    return c.json(
      await getEstimateSuggestion({
        userId: c.get("userId"),
        workspaceId: c.get("workspaceId"),
        projectId,
        taskId,
        title,
        can: await workspacePermissionChecker(c),
      }),
      200,
    );
  })
  .openapi(calibrationRoute, async (c) =>
    c.json(await getCalibration(c.req.valid("param").projectId), 200),
  )
  .openapi(capacityRoute, async (c) => {
    const can = await workspacePermissionChecker(c);
    return c.json(
      await getCycleCapacity(c.req.valid("param").cycleId, {
        includeMembers: can({ cycle: ["update"] }),
      }),
      200,
    );
  })
  .openapi(retroRoute, async (c) =>
    c.json(
      await computeRetroFacts({
        cycleId: c.req.valid("param").cycleId,
        userId: c.get("userId"),
        workspaceId: c.get("workspaceId"),
      }),
      200,
    ),
  )
  .openapi(myBriefRoute, async (c) =>
    c.json(
      await computeMyBrief({
        userId: c.get("userId"),
        workspaceId: c.get("workspaceId"),
      }),
      200,
    ),
  );

export default insight;
