import { requireEntitlement } from "../billing/require-entitlement-middleware";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import {
  hasWorkspacePermission,
  requireWorkspacePermission,
} from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import {
  cycleAccess,
  requireCyclesFeatureForCycle,
  requireCyclesFeatureForProject,
  requireCyclesFeatureForTask,
} from "./access";
import addCycleTasks from "./controllers/add-cycle-tasks";
import { archiveCycle, unarchiveCycle } from "./controllers/archive-cycle";
import createCycle from "./controllers/create-cycle";
import deleteCycle from "./controllers/delete-cycle";
import getCycleProgress from "./controllers/get-cycle-progress";
import listCycles from "./controllers/list-cycles";
import removeCycleTasks from "./controllers/remove-cycle-tasks";
import setTaskCycle from "./controllers/set-task-cycle";
import { getCycleResponse } from "./controllers/shared";
import transferCycleTasks from "./controllers/transfer-cycle-tasks";
import updateCycle from "./controllers/update-cycle";
import {
  cycleDeleteResultSchema,
  cycleListSchema,
  cycleProgressSchema,
  cycleSchema,
  cycleTaskChangeSchema,
  cycleTransferResultSchema,
  taskCycleAssignmentSchema,
} from "./response";
import {
  createCycleBody,
  cycleParam,
  listCyclesQuery,
  projectIdParam,
  setTaskCycleBody,
  taskIdParam,
  taskIdsBody,
  transferBody,
  updateCycleBody,
} from "./schema";

// Every route, reads included, answers 403 while the project's cycles
// feature is off. Cycle dates are inclusive calendar days, and "today" is the
// server's UTC date.

const TAGS = ["Cycles"];
const FEATURE_OFF = "the Cycles feature is turned off for this project";
const readCycle = [
  cycleAccess(),
  requireWorkspacePermission({ cycle: ["read"] }),
  requireCyclesFeatureForCycle,
] as const;
const updateCycleMiddleware = [
  cycleAccess(),
  requireWorkspacePermission({ cycle: ["update"] }),
  requireCyclesFeatureForCycle,
] as const;

function jsonBody<T>(schema: T) {
  return {
    required: true,
    content: { "application/json": { schema } },
  };
}

const listCyclesRoute = createRoute({
  method: "get",
  operationId: "listCycles",
  path: "/project/{projectId}",
  tags: TAGS,
  summary: "List cycles",
  description:
    "List a project's cycles with their derived status, counts and progress, ordered current, upcoming, draft, completed (the archived view: newest archive first). Not paginated; at most 1000 cycles.",
  middleware: [
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ cycle: ["read"] }),
    requireCyclesFeatureForProject,
  ] as const,
  request: { params: projectIdParam, query: listCyclesQuery },
  responses: {
    200: jsonResponse("The project's cycles", cycleListSchema),
    400: errorResponse("Invalid query, or unknown project"),
    403: errorResponse(
      `No workspace access, missing cycle:read permission, or ${FEATURE_OFF}`,
    ),
  },
});

const createCycleRoute = createRoute({
  method: "post",
  operationId: "createCycle",
  path: "/project/{projectId}",
  tags: TAGS,
  summary: "Create cycle",
  description:
    "Create a cycle. Without dates it is a draft; with dates (inclusive calendar days, at most 366) it must not overlap another dated cycle of the project, archived ones included.",
  middleware: [
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ cycle: ["create"] }),
    requireCyclesFeatureForProject,
    requireEntitlement,
  ] as const,
  request: { params: projectIdParam, body: jsonBody(createCycleBody) },
  responses: {
    200: jsonResponse("The created cycle", cycleSchema),
    400: errorResponse(
      "Invalid body or dates, an owner outside the workspace, or unknown project",
    ),
    403: errorResponse(
      `No workspace access, missing cycle:create permission, or ${FEATURE_OFF}`,
    ),
    409: errorResponse("Another cycle already covers some of these dates"),
  },
});

const setTaskCycleRoute = createRoute({
  method: "put",
  operationId: "setTaskCycle",
  path: "/task/{taskId}",
  tags: TAGS,
  summary: "Set task cycle",
  description:
    "Put a task in a draft, upcoming or current cycle of its project, moving it out of any other cycle, or pass null to take it out. Tasks can always leave a cycle.",
  middleware: [
    workspaceAccess.fromTaskId("taskId"),
    requireWorkspacePermission({ cycle: ["update"] }),
    requireCyclesFeatureForTask,
  ] as const,
  request: { params: taskIdParam, body: jsonBody(setTaskCycleBody) },
  responses: {
    200: jsonResponse(
      "The task's cycle before and after",
      taskCycleAssignmentSchema,
    ),
    400: errorResponse("Invalid body, or the cycle belongs to another project"),
    403: errorResponse(
      `No workspace access, missing cycle:update permission, or ${FEATURE_OFF}`,
    ),
    404: errorResponse("Unknown task or cycle"),
    409: errorResponse(
      "The cycle is completed or archived, or the task is archived or in triage",
    ),
  },
});

const getCycleRoute = createRoute({
  method: "get",
  operationId: "getCycle",
  path: "/{id}",
  tags: TAGS,
  summary: "Get cycle",
  description: "Get one cycle, archived ones included.",
  middleware: [...readCycle] as const,
  request: { params: cycleParam },
  responses: {
    200: jsonResponse("The cycle", cycleSchema),
    403: errorResponse(
      `No workspace access, missing cycle:read permission, or ${FEATURE_OFF}`,
    ),
    404: errorResponse("Cycle not found"),
  },
});

const updateCycleRoute = createRoute({
  method: "put",
  operationId: "updateCycle",
  path: "/{id}",
  tags: TAGS,
  summary: "Update cycle",
  description:
    "Change a cycle; omitted fields stay unchanged. Send startDate and endDate together (both null turns an upcoming cycle into a draft). A current cycle keeps its start date and can't end before today; completed cycles only accept sortOrder; archived cycles can't change.",
  middleware: [...updateCycleMiddleware, requireEntitlement] as const,
  request: { params: cycleParam, body: jsonBody(updateCycleBody) },
  responses: {
    200: jsonResponse("The updated cycle", cycleSchema),
    400: errorResponse(
      "Invalid body or dates, a running cycle ending in the past, or an owner outside the workspace",
    ),
    403: errorResponse(
      `No workspace access, missing cycle:update permission, or ${FEATURE_OFF}`,
    ),
    404: errorResponse("Cycle not found"),
    409: errorResponse(
      "Overlapping dates, or a change the cycle's status doesn't allow",
    ),
  },
});

const deleteCycleRoute = createRoute({
  method: "delete",
  operationId: "deleteCycle",
  path: "/{id}",
  tags: TAGS,
  summary: "Delete cycle",
  description:
    "Delete a cycle. Needs cycle:delete, or cycle:update for the cycle's owner. Its tasks stay in the project; their membership, and favorites and recent visits of the cycle, are removed.",
  middleware: [...updateCycleMiddleware] as const,
  request: { params: cycleParam },
  responses: {
    200: jsonResponse(
      "The deleted cycle and the tasks it held",
      cycleDeleteResultSchema,
    ),
    403: errorResponse(
      `No workspace access, not an admin or the cycle's owner, or ${FEATURE_OFF}`,
    ),
    404: errorResponse("Cycle not found"),
  },
});

const archiveCycleRoute = createRoute({
  method: "post",
  operationId: "archiveCycle",
  path: "/{id}/archive",
  tags: TAGS,
  summary: "Archive cycle",
  description:
    "Archive a completed cycle. It leaves the default list and its favorites are hidden until it is restored.",
  middleware: [...updateCycleMiddleware] as const,
  request: { params: cycleParam },
  responses: {
    200: jsonResponse("The archived cycle", cycleSchema),
    403: errorResponse(
      `No workspace access, missing cycle:update permission, or ${FEATURE_OFF}`,
    ),
    404: errorResponse("Cycle not found"),
    409: errorResponse("The cycle is not completed, or already archived"),
  },
});

const unarchiveCycleRoute = createRoute({
  method: "post",
  operationId: "unarchiveCycle",
  path: "/{id}/unarchive",
  tags: TAGS,
  summary: "Restore cycle",
  description: "Restore an archived cycle.",
  middleware: [...updateCycleMiddleware] as const,
  request: { params: cycleParam },
  responses: {
    200: jsonResponse("The restored cycle", cycleSchema),
    403: errorResponse(
      `No workspace access, missing cycle:update permission, or ${FEATURE_OFF}`,
    ),
    404: errorResponse("Cycle not found"),
    409: errorResponse("The cycle is not archived"),
  },
});

const addCycleTasksRoute = createRoute({
  method: "post",
  operationId: "addCycleTasks",
  path: "/{id}/tasks",
  tags: TAGS,
  summary: "Add tasks to cycle",
  description:
    "Add up to 200 tasks to a draft, upcoming or current cycle. Tasks in another cycle move here. Ids that are not visible tasks of the project come back as ignored, which is not an error.",
  middleware: [...updateCycleMiddleware, requireEntitlement] as const,
  request: { params: cycleParam, body: jsonBody(taskIdsBody) },
  responses: {
    200: jsonResponse("What changed for each id", cycleTaskChangeSchema),
    400: errorResponse("Invalid body"),
    403: errorResponse(
      `No workspace access, missing cycle:update permission, or ${FEATURE_OFF}`,
    ),
    404: errorResponse("Cycle not found"),
    409: errorResponse("The cycle is completed or archived"),
  },
});

const removeCycleTasksRoute = createRoute({
  method: "delete",
  operationId: "removeCycleTasks",
  path: "/{id}/tasks",
  tags: TAGS,
  summary: "Remove tasks from cycle",
  description:
    "Take up to 200 tasks out of a cycle, whatever its status: tasks can always leave a cycle. Ids that are not visible tasks of the project come back as ignored, which is not an error.",
  middleware: [...updateCycleMiddleware] as const,
  request: { params: cycleParam, body: jsonBody(taskIdsBody) },
  responses: {
    200: jsonResponse("What changed for each id", cycleTaskChangeSchema),
    400: errorResponse("Invalid body"),
    403: errorResponse(
      `No workspace access, missing cycle:update permission, or ${FEATURE_OFF}`,
    ),
    404: errorResponse("Cycle not found"),
  },
});

const transferCycleTasksRoute = createRoute({
  method: "post",
  operationId: "transferCycleTasks",
  path: "/{id}/transfer",
  tags: TAGS,
  summary: "Transfer unfinished tasks",
  description:
    "Move a completed cycle's unfinished tasks (backlog, not started, started) to a draft, upcoming or current cycle of the same project. The source's progress report is frozen first and keeps its numbers; completed and cancelled tasks stay.",
  middleware: [...updateCycleMiddleware, requireEntitlement] as const,
  request: { params: cycleParam, body: jsonBody(transferBody) },
  responses: {
    200: jsonResponse("The moved tasks", cycleTransferResultSchema),
    400: errorResponse("Invalid body, or the target is the source"),
    403: errorResponse(
      `No workspace access, missing cycle:update permission, or ${FEATURE_OFF}`,
    ),
    404: errorResponse("Cycle or target cycle not found"),
    409: errorResponse(
      "The source is not completed or is archived, or the target is completed or archived",
    ),
  },
});

const getCycleProgressRoute = createRoute({
  method: "get",
  operationId: "getCycleProgress",
  path: "/{id}/progress",
  tags: TAGS,
  summary: "Get cycle progress",
  description:
    "Counts, progress, the burn-down/burn-up chart and breakdowns by assignee, label and priority over the cycle's visible tasks. Cancelled tasks are counted apart and never in progress. A frozen cycle returns its frozen report.",
  middleware: [...readCycle] as const,
  request: { params: cycleParam },
  responses: {
    200: jsonResponse("The cycle's progress report", cycleProgressSchema),
    403: errorResponse(
      `No workspace access, missing cycle:read permission, or ${FEATURE_OFF}`,
    ),
    404: errorResponse("Cycle not found"),
  },
});

type CycleVariables = BaseVariables & {
  workspaceId: string;
  projectId: string;
};

// Literal first segments (project, task) are registered before the {id} routes.
const cycle = apiRouter<CycleVariables>()
  .openapi(listCyclesRoute, async (c) =>
    c.json(
      await listCycles(c.req.valid("param").projectId, c.req.valid("query")),
      200,
    ),
  )
  .openapi(createCycleRoute, async (c) =>
    c.json(
      await createCycle({
        ...c.req.valid("json"),
        projectId: c.req.valid("param").projectId,
        workspaceId: c.get("workspaceId"),
        userId: c.get("userId"),
      }),
      200,
    ),
  )
  .openapi(setTaskCycleRoute, async (c) =>
    c.json(
      await setTaskCycle({
        taskId: c.req.valid("param").taskId,
        cycleId: c.req.valid("json").cycleId,
        workspaceId: c.get("workspaceId"),
        userId: c.get("userId"),
      }),
      200,
    ),
  )
  .openapi(getCycleRoute, async (c) =>
    c.json(await getCycleResponse(c.req.valid("param").id), 200),
  )
  .openapi(updateCycleRoute, async (c) =>
    c.json(
      await updateCycle({
        cycleId: c.req.valid("param").id,
        projectId: c.get("projectId"),
        workspaceId: c.get("workspaceId"),
        userId: c.get("userId"),
        input: c.req.valid("json"),
      }),
      200,
    ),
  )
  .openapi(deleteCycleRoute, async (c) =>
    c.json(
      await deleteCycle({
        cycleId: c.req.valid("param").id,
        userId: c.get("userId"),
        canDeleteAnyCycle: await hasWorkspacePermission(c, {
          cycle: ["delete"],
        }),
      }),
      200,
    ),
  )
  .openapi(archiveCycleRoute, async (c) =>
    c.json(await archiveCycle(c.req.valid("param").id, c.get("userId")), 200),
  )
  .openapi(unarchiveCycleRoute, async (c) =>
    c.json(await unarchiveCycle(c.req.valid("param").id, c.get("userId")), 200),
  )
  .openapi(addCycleTasksRoute, async (c) =>
    c.json(
      await addCycleTasks({
        cycleId: c.req.valid("param").id,
        userId: c.get("userId"),
        taskIds: c.req.valid("json").taskIds,
      }),
      200,
    ),
  )
  .openapi(removeCycleTasksRoute, async (c) =>
    c.json(
      await removeCycleTasks({
        cycleId: c.req.valid("param").id,
        userId: c.get("userId"),
        taskIds: c.req.valid("json").taskIds,
      }),
      200,
    ),
  )
  .openapi(transferCycleTasksRoute, async (c) =>
    c.json(
      await transferCycleTasks({
        sourceCycleId: c.req.valid("param").id,
        targetCycleId: c.req.valid("json").targetCycleId,
        workspaceId: c.get("workspaceId"),
        userId: c.get("userId"),
      }),
      200,
    ),
  )
  .openapi(getCycleProgressRoute, async (c) =>
    c.json(
      await getCycleProgress(c.req.valid("param").id, c.get("workspaceId")),
      200,
    ),
  );

export default cycle;
