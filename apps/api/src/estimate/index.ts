import db from "../database";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
  z,
} from "../openapi";
import { requireProjectFeature } from "../project/features";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import activateEstimate from "./controllers/activate-estimate";
import createEstimate from "./controllers/create-estimate";
import createEstimatePoint from "./controllers/create-estimate-point";
import deleteEstimate from "./controllers/delete-estimate";
import deleteEstimatePoint from "./controllers/delete-estimate-point";
import reorderEstimatePoints from "./controllers/reorder-estimate-points";
import updateEstimate from "./controllers/update-estimate";
import updateEstimatePoint from "./controllers/update-estimate-point";
import { listEstimates } from "./queries";
import {
  estimateActivateResultSchema,
  estimateDeleteResultSchema,
  estimateListSchema,
  estimatePointDeleteResultSchema,
  estimatePointInUseSchema,
  estimateSchema,
  estimateTotalsSchema,
  estimateValidationErrorSchema,
} from "./response";
import {
  activateEstimateBody,
  createEstimateBody,
  createPointBody,
  deletePointQuery,
  estimateParam,
  pointParam,
  projectIdParam,
  reorderPointsBody,
  totalsBody,
  updateEstimateBody,
  updatePointBody,
} from "./schema";
import { getEstimateTotals } from "./totals";

// Every route keeps {projectId} in its path and answers 403 while the
// project's estimates feature is off, reads included. Controllers then check
// that {estimateId} belongs to {projectId} and {pointId} to {estimateId}.

const TAGS = ["Estimates"];
const FEATURE_OFF = "the Estimates feature is turned off for this project";
const requireEstimatesFeature = requireProjectFeature("estimates");

const readEstimates = [
  workspaceAccess.fromProject("projectId"),
  requireEstimatesFeature,
] as const;

const manageEstimates = [
  workspaceAccess.fromProject("projectId"),
  requireWorkspacePermission({ project: ["update"] }),
  requireEstimatesFeature,
] as const;

const READ_FORBIDDEN = `No workspace access, or ${FEATURE_OFF}`;
const MANAGE_FORBIDDEN = `No workspace access, missing project:update permission, or ${FEATURE_OFF}`;

function jsonBody<T>(schema: T) {
  return {
    required: true,
    content: { "application/json": { schema } },
  };
}

function valueErrorResponse(description: string) {
  return {
    description,
    content: {
      "application/json": { schema: estimateValidationErrorSchema },
      "text/plain": { schema: z.string() },
    },
  };
}

const listEstimatesRoute = createRoute({
  method: "get",
  operationId: "listEstimates",
  path: "/{projectId}",
  tags: TAGS,
  summary: "List estimate systems",
  description:
    "The project's estimate systems with their values and how many tasks use each value. The active system comes first, then the others, newest first.",
  middleware: [...readEstimates] as const,
  request: { params: projectIdParam },
  responses: {
    200: jsonResponse("The project's estimate systems", estimateListSchema),
    400: errorResponse("Unknown project"),
    403: errorResponse(READ_FORBIDDEN),
  },
});

const estimateTotalsRoute = createRoute({
  method: "post",
  operationId: "getEstimateTotals",
  path: "/{projectId}/totals",
  tags: TAGS,
  summary: "Get estimate totals",
  description:
    "Estimate totals over the given tasks of the project: counts, sums per column group and per value. Only visible tasks (not archived, not in triage) count. enabled is false when no system is active.",
  middleware: [...readEstimates] as const,
  request: { params: projectIdParam, body: jsonBody(totalsBody) },
  responses: {
    200: jsonResponse("Totals over the tasks", estimateTotalsSchema),
    400: errorResponse("Invalid body, or unknown project"),
    403: errorResponse(READ_FORBIDDEN),
  },
});

const createEstimateRoute = createRoute({
  method: "post",
  operationId: "createEstimate",
  path: "/{projectId}",
  tags: TAGS,
  summary: "Create estimate system",
  description:
    "Create an estimate system with 2 to 10 values. Each value is validated before anything is written; a 400 lists every offending value with a code. The project's first system becomes active; later ones stay inactive until activated.",
  middleware: [...manageEstimates] as const,
  request: { params: projectIdParam, body: jsonBody(createEstimateBody) },
  responses: {
    200: jsonResponse("The created estimate system", estimateSchema),
    400: valueErrorResponse("Invalid body or values, or unknown project"),
    403: errorResponse(MANAGE_FORBIDDEN),
    409: errorResponse("An estimate system with this name already exists"),
  },
});

const updateEstimateRoute = createRoute({
  method: "put",
  operationId: "updateEstimate",
  path: "/{projectId}/{estimateId}",
  tags: TAGS,
  summary: "Rename estimate system",
  description:
    "Rename an estimate system. Its type never changes: create another system and activate it instead.",
  middleware: [...manageEstimates] as const,
  request: { params: estimateParam, body: jsonBody(updateEstimateBody) },
  responses: {
    200: jsonResponse("The renamed estimate system", estimateSchema),
    400: errorResponse("Invalid body"),
    403: errorResponse(MANAGE_FORBIDDEN),
    404: errorResponse("Estimate not found"),
    409: errorResponse("An estimate system with this name already exists"),
  },
});

const deleteEstimateRoute = createRoute({
  method: "delete",
  operationId: "deleteEstimate",
  path: "/{projectId}/{estimateId}",
  tags: TAGS,
  summary: "Delete estimate system",
  description:
    "Delete an estimate system and its values. Deleting the active system leaves its tasks without an estimate (recorded in their activity) and the project without an active system; no other system is activated.",
  middleware: [...manageEstimates] as const,
  request: { params: estimateParam },
  responses: {
    200: jsonResponse("What was deleted", estimateDeleteResultSchema),
    400: errorResponse("Unknown project"),
    403: errorResponse(MANAGE_FORBIDDEN),
    404: errorResponse("Estimate not found"),
    409: errorResponse("Another estimate change is in progress; retry"),
    503: errorResponse("The update took too long; retry later"),
  },
});

const activateEstimateRoute = createRoute({
  method: "post",
  operationId: "activateEstimate",
  path: "/{projectId}/{estimateId}/activate",
  tags: TAGS,
  summary: "Switch estimate system",
  description:
    "Make this the project's active system. Tasks on each value of the previous system move as mapped; unmapped values leave their tasks without an estimate. The previous system stays and can be activated again. Activating the active system changes nothing.",
  middleware: [...manageEstimates] as const,
  request: { params: estimateParam, body: jsonBody(activateEstimateBody) },
  responses: {
    200: jsonResponse("The switch result", estimateActivateResultSchema),
    400: errorResponse(
      "Invalid body, a mapping outside the two systems, a value mapped twice, or a mapping without an active system",
    ),
    403: errorResponse(MANAGE_FORBIDDEN),
    404: errorResponse("Estimate not found"),
    409: errorResponse("Another estimate change is in progress; retry"),
    503: errorResponse("The update took too long; retry later"),
  },
});

const reorderPointsRoute = createRoute({
  method: "put",
  operationId: "reorderEstimatePoints",
  path: "/{projectId}/{estimateId}/points/reorder",
  tags: TAGS,
  summary: "Reorder estimate values",
  description:
    "Put a categories system's values in a new order. Points and time systems are always ordered by value.",
  middleware: [...manageEstimates] as const,
  request: { params: estimateParam, body: jsonBody(reorderPointsBody) },
  responses: {
    200: jsonResponse("The reordered estimate system", estimateSchema),
    400: errorResponse(
      "Invalid body, not a categories system, or the ids are not exactly the system's values",
    ),
    403: errorResponse(MANAGE_FORBIDDEN),
    404: errorResponse("Estimate not found"),
  },
});

const createPointRoute = createRoute({
  method: "post",
  operationId: "createEstimatePoint",
  path: "/{projectId}/{estimateId}/points",
  tags: TAGS,
  summary: "Add estimate value",
  description:
    "Add a value to an estimate system (at most 10). Points and time slot in by value; categories go to the requested position, or last.",
  middleware: [...manageEstimates] as const,
  request: { params: estimateParam, body: jsonBody(createPointBody) },
  responses: {
    200: jsonResponse("The updated estimate system", estimateSchema),
    400: valueErrorResponse("Invalid body or value"),
    403: errorResponse(MANAGE_FORBIDDEN),
    404: errorResponse("Estimate not found"),
    409: errorResponse("The system already has 10 values"),
  },
});

const updatePointRoute = createRoute({
  method: "put",
  operationId: "updateEstimatePoint",
  path: "/{projectId}/{estimateId}/points/{pointId}",
  tags: TAGS,
  summary: "Edit estimate value",
  description:
    "Change a value's text. Tasks keep the value and show the new text; no task history is written.",
  middleware: [...manageEstimates] as const,
  request: { params: pointParam, body: jsonBody(updatePointBody) },
  responses: {
    200: jsonResponse("The updated estimate system", estimateSchema),
    400: valueErrorResponse("Invalid body or value"),
    403: errorResponse(MANAGE_FORBIDDEN),
    404: errorResponse("Estimate or estimate point not found"),
  },
});

const deletePointRoute = createRoute({
  method: "delete",
  operationId: "deleteEstimatePoint",
  path: "/{projectId}/{estimateId}/points/{pointId}",
  tags: TAGS,
  summary: "Delete estimate value",
  description:
    "Delete a value. When tasks use it, pass replacementPointId (another value of the same system) to move them, or clear=true to leave them without an estimate; each change is recorded in the task's activity. A system keeps at least 2 values.",
  middleware: [...manageEstimates] as const,
  request: { params: pointParam, query: deletePointQuery },
  responses: {
    200: jsonResponse("The result", estimatePointDeleteResultSchema),
    400: errorResponse(
      "Both options sent, or the replacement is not another value of the same system",
    ),
    403: errorResponse(MANAGE_FORBIDDEN),
    404: errorResponse("Estimate or estimate point not found"),
    409: {
      description:
        "Only 2 values are left (text), or tasks use the value and neither option was sent (JSON with taskCount)",
      content: {
        "application/json": { schema: estimatePointInUseSchema },
        "text/plain": { schema: z.string() },
      },
    },
    503: errorResponse("The update took too long; retry later"),
  },
});

type EstimateVariables = BaseVariables & { workspaceId: string };

// Literal segments (totals, points/reorder) are registered before the
// parameter routes they would otherwise match.
const estimate = apiRouter<EstimateVariables>()
  .openapi(listEstimatesRoute, async (c) =>
    c.json(await listEstimates(db, c.req.valid("param").projectId), 200),
  )
  .openapi(estimateTotalsRoute, async (c) => {
    const { projectId } = c.req.valid("param");
    const taskIds = [...new Set(c.req.valid("json").taskIds)];
    return c.json(
      await getEstimateTotals({
        projectId,
        taskScope: { kind: "ids", taskIds },
        db,
      }),
      200,
    );
  })
  .openapi(createEstimateRoute, async (c) =>
    c.json(
      await createEstimate({
        ...c.req.valid("json"),
        projectId: c.req.valid("param").projectId,
        userId: c.get("userId"),
      }),
      200,
    ),
  )
  .openapi(reorderPointsRoute, async (c) =>
    c.json(
      await reorderEstimatePoints({
        ...c.req.valid("param"),
        userId: c.get("userId"),
        pointIds: c.req.valid("json").pointIds,
      }),
      200,
    ),
  )
  .openapi(updateEstimateRoute, async (c) =>
    c.json(
      await updateEstimate({
        ...c.req.valid("param"),
        userId: c.get("userId"),
        name: c.req.valid("json").name,
      }),
      200,
    ),
  )
  .openapi(deleteEstimateRoute, async (c) =>
    c.json(
      await deleteEstimate({
        ...c.req.valid("param"),
        userId: c.get("userId"),
      }),
      200,
    ),
  )
  .openapi(activateEstimateRoute, async (c) =>
    c.json(
      await activateEstimate({
        ...c.req.valid("param"),
        userId: c.get("userId"),
        mapping: c.req.valid("json").mapping,
      }),
      200,
    ),
  )
  .openapi(createPointRoute, async (c) =>
    c.json(
      await createEstimatePoint({
        ...c.req.valid("param"),
        ...c.req.valid("json"),
        userId: c.get("userId"),
      }),
      200,
    ),
  )
  .openapi(updatePointRoute, async (c) =>
    c.json(
      await updateEstimatePoint({
        ...c.req.valid("param"),
        userId: c.get("userId"),
        value: c.req.valid("json").value,
      }),
      200,
    ),
  )
  .openapi(deletePointRoute, async (c) => {
    const { replacementPointId, clear } = c.req.valid("query");
    return c.json(
      await deleteEstimatePoint({
        ...c.req.valid("param"),
        userId: c.get("userId"),
        replacementPointId,
        clear: clear === "true",
      }),
      200,
    );
  });

export default estimate;
