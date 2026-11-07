import { parseProjectIdsParam } from "../analytics/schema";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
  lookupNotFound,
} from "../openapi";
import { requireProjectFeature } from "../project/features";
import { requestHiddenProjectIds } from "../project/visibility";
import {
  hasWorkspacePermission,
  requireWorkspacePermission,
} from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import { visibleTimeEntry } from "./access";
import createTimeEntry from "./controllers/create-time-entry";
import deleteTimeEntry from "./controllers/delete-time-entry";
import getRunningTimeEntry from "./controllers/get-running-time-entry";
import getTimeEntriesByTaskId from "./controllers/get-time-entries";
import getTimeEntry from "./controllers/get-time-entry";
import getTimeReport from "./controllers/get-time-report";
import stopTimeEntry from "./controllers/stop-time-entry";
import updateTimeEntry from "./controllers/update-time-entry";
import {
  createdTimeEntrySchema,
  runningTimeEntrySchema,
  timeEntryListSchema,
  timeEntrySchema,
  timeReportSchema,
} from "./response";
import {
  createTimeEntryBody,
  runningTimeEntryQuery,
  taskIdParam,
  timeEntryParam,
  timeReportQuery,
  updateTimeEntryBody,
} from "./schema";

const getRunningTimeEntryRoute = createRoute({
  method: "get",
  operationId: "getRunningTimeEntry",
  path: "/running",
  tags: ["Time Entries"],
  summary: "Get your running timer",
  description:
    "The caller's running timer in this workspace, with its task's title and number. Null when none is running, or when it is on a trashed task, in a project the caller can't see, or in a project with time tracking off.",
  middleware: [
    workspaceAccess.fromQuery(),
    requireWorkspacePermission({ task: ["read"] }),
  ] as const,
  request: { query: runningTimeEntryQuery },
  responses: {
    200: jsonResponse("The running timer, if any", runningTimeEntrySchema),
    400: errorResponse("Invalid query"),
    403: errorResponse("No workspace access, or missing task:read permission"),
  },
});

const getTimeReportRoute = createRoute({
  method: "get",
  operationId: "getTimeReport",
  path: "/report",
  tags: ["Time Entries"],
  summary: "Get time totals",
  description:
    "Time logged by person and by project, over projects with time tracking on, counted on the local day each entry started. Finished entries only: running entries are reported as a count and join the totals once stopped. Trashed and triage tasks are left out. At most five years.",
  middleware: [
    workspaceAccess.fromQuery(),
    requireWorkspacePermission({ analytics: ["read"], task: ["read"] }),
  ] as const,
  request: { query: timeReportQuery },
  responses: {
    200: jsonResponse("Totals by person and project", timeReportSchema),
    400: errorResponse(
      "Invalid query, an invalid date or range, not 1–100 comma-separated project ids, or an unknown time zone",
    ),
    403: errorResponse(
      "No workspace access, or missing analytics:read or task:read permission",
    ),
    404: errorResponse("A project id is not in the workspace"),
    503: errorResponse(
      "The report took too long; narrow the range or projects",
    ),
  },
});

const getTaskTimeEntriesRoute = createRoute({
  method: "get",
  operationId: "getTaskTimeEntries",
  path: "/task/{taskId}",
  tags: ["Time Entries"],
  summary: "Get task time entries",
  description:
    "Get every time entry logged against a task. Answers 403 while time tracking is turned off for the task's project.",
  middleware: [
    workspaceAccess.fromTaskId(),
    requireProjectFeature("timeTracking", { resource: "task", key: "taskId" }),
  ] as const,
  request: { params: taskIdParam },
  responses: {
    200: jsonResponse("List of time entries for the task", timeEntryListSchema),
    403: errorResponse(
      "No access to the task's workspace, or time tracking is turned off for the project",
    ),
    404: lookupNotFound("task"),
  },
});

const getTimeEntryRoute = createRoute({
  method: "get",
  operationId: "getTimeEntry",
  path: "/{id}",
  tags: ["Time Entries"],
  summary: "Get time entry",
  description:
    "Get a single time entry by ID. Answers 403 while time tracking is turned off for the entry's project.",
  middleware: [
    workspaceAccess.fromTimeEntry(),
    requireProjectFeature("timeTracking", { resource: "timeEntry", key: "id" }),
  ] as const,
  request: { params: timeEntryParam },
  responses: {
    200: jsonResponse("Time entry details", timeEntrySchema),
    403: errorResponse(
      "No access to the entry's workspace, or time tracking is turned off for the project",
    ),
    404: lookupNotFound("timeEntry"),
  },
});

const createTimeEntryRoute = createRoute({
  method: "post",
  operationId: "createTimeEntry",
  path: "/",
  tags: ["Time Entries"],
  summary: "Create time entry",
  description:
    "Log time against a task. Omit endTime to start a running entry, which can be stopped later. A person has one running entry at a time, so starting one stops any other they have running, wherever it is, and lists it in stoppedEntries. A project-limited API key only stops and lists entries in its own projects. Answers 403 while time tracking is turned off for the task's project.",
  middleware: [
    workspaceAccess.fromTaskId(),
    requireWorkspacePermission({ task: ["update"] }),
    requireProjectFeature("timeTracking", {
      resource: "task",
      key: "taskId",
      in: "body",
    }),
  ] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: createTimeEntryBody } },
    },
  },
  responses: {
    200: jsonResponse("The created time entry", createdTimeEntrySchema),
    400: errorResponse("Invalid body or timestamps"),
    403: errorResponse(
      "No workspace access, missing task:update permission, or time tracking is turned off for the project",
    ),
    404: lookupNotFound("task"),
  },
});

const updateTimeEntryRoute = createRoute({
  method: "put",
  operationId: "updateTimeEntry",
  path: "/{id}",
  tags: ["Time Entries"],
  summary: "Update time entry",
  description:
    "Replace a time entry's start, end, and description. Setting endTime closes a running entry and fills in its duration. Whoever logged the entry may change it; changing someone else's entry needs task:delete (workspace admins and owners by default). Answers 403 while time tracking is turned off for the entry's project.",
  middleware: [
    visibleTimeEntry(),
    requireWorkspacePermission({ task: ["update"] }),
    requireProjectFeature("timeTracking", { resource: "timeEntry", key: "id" }),
  ] as const,
  request: {
    params: timeEntryParam,
    body: {
      required: true,
      content: { "application/json": { schema: updateTimeEntryBody } },
    },
  },
  responses: {
    200: jsonResponse("The updated time entry", timeEntrySchema),
    400: errorResponse("Invalid timestamps"),
    403: errorResponse(
      "Someone else's entry without task:delete, missing task:update permission, or time tracking is turned off for the project",
    ),
    404: errorResponse(
      "No such entry, or it is in a workspace the caller can't access",
    ),
  },
});

const stopTimeEntryRoute = createRoute({
  method: "post",
  operationId: "stopTimeEntry",
  path: "/{id}/stop",
  tags: ["Time Entries"],
  summary: "Stop a running time entry",
  description:
    "Ends a running entry now, by the server's clock, and fills in its duration. An entry that already ended is returned unchanged. Whoever logged the entry may stop it; stopping someone else's needs task:delete (workspace admins and owners by default). Answers 403 while time tracking is turned off for the entry's project.",
  middleware: [
    visibleTimeEntry(),
    requireWorkspacePermission({ task: ["update"] }),
    requireProjectFeature("timeTracking", { resource: "timeEntry", key: "id" }),
  ] as const,
  request: { params: timeEntryParam },
  responses: {
    200: jsonResponse("The stopped time entry", timeEntrySchema),
    403: errorResponse(
      "Someone else's entry without task:delete, missing task:update permission, or time tracking is turned off for the project",
    ),
    404: errorResponse(
      "No such entry, or it is in a workspace the caller can't access",
    ),
  },
});

const deleteTimeEntryRoute = createRoute({
  method: "delete",
  operationId: "deleteTimeEntry",
  path: "/{id}",
  tags: ["Time Entries"],
  summary: "Delete time entry",
  description:
    "Delete a time entry. Whoever logged it may delete it; deleting someone else's entry needs task:delete (workspace admins and owners by default). Answers 403 while time tracking is turned off for the entry's project.",
  middleware: [
    visibleTimeEntry(),
    requireWorkspacePermission({ task: ["update"] }),
    requireProjectFeature("timeTracking", { resource: "timeEntry", key: "id" }),
  ] as const,
  request: { params: timeEntryParam },
  responses: {
    200: jsonResponse("The deleted time entry", timeEntrySchema),
    403: errorResponse(
      "Someone else's entry without task:delete, missing task:update permission, or time tracking is turned off for the project",
    ),
    404: errorResponse(
      "No such entry, or it is in a workspace the caller can't access",
    ),
  },
});

type Variables = BaseVariables & { workspaceId: string };

const timeEntry = apiRouter<Variables>()
  // Before "/{id}", which would otherwise take these paths for an entry id.
  .openapi(getRunningTimeEntryRoute, async (c) =>
    c.json(
      await getRunningTimeEntry({
        workspaceId: c.get("workspaceId"),
        userId: c.get("userId"),
        hiddenProjectIds: await requestHiddenProjectIds(c),
      }),
      200,
    ),
  )
  .openapi(getTimeReportRoute, async (c) => {
    const { projectIds, timeZone, from, to } = c.req.valid("query");
    return c.json(
      await getTimeReport(
        { workspaceId: c.get("workspaceId"), userId: c.get("userId") },
        { projectIds: parseProjectIdsParam(projectIds), timeZone, from, to },
      ),
      200,
    );
  })
  .openapi(getTaskTimeEntriesRoute, async (c) =>
    c.json(await getTimeEntriesByTaskId(c.req.valid("param").taskId), 200),
  )
  .openapi(getTimeEntryRoute, async (c) =>
    c.json(await getTimeEntry(c.req.valid("param").id), 200),
  )
  .openapi(createTimeEntryRoute, async (c) => {
    const { taskId, startTime, endTime, description } = c.req.valid("json");
    return c.json(
      await createTimeEntry({
        taskId,
        userId: c.get("userId"),
        startTime: new Date(startTime),
        endTime: endTime ? new Date(endTime) : undefined,
        description,
        stopWithinProjects: c.get("apiKey")?.projectIds,
      }),
      200,
    );
  })
  .openapi(updateTimeEntryRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { startTime, endTime, description } = c.req.valid("json");
    return c.json(
      await updateTimeEntry({
        timeEntryId: id,
        userId: c.get("userId"),
        mayChangeOthers: () => hasWorkspacePermission(c, { task: ["delete"] }),
        startTime: new Date(startTime),
        endTime: endTime ? new Date(endTime) : undefined,
        description,
      }),
      200,
    );
  })
  .openapi(stopTimeEntryRoute, async (c) =>
    c.json(
      await stopTimeEntry({
        timeEntryId: c.req.valid("param").id,
        userId: c.get("userId"),
        mayChangeOthers: () => hasWorkspacePermission(c, { task: ["delete"] }),
      }),
      200,
    ),
  )
  .openapi(deleteTimeEntryRoute, async (c) =>
    c.json(
      await deleteTimeEntry({
        timeEntryId: c.req.valid("param").id,
        userId: c.get("userId"),
        mayDeleteOthers: () => hasWorkspacePermission(c, { task: ["delete"] }),
      }),
      200,
    ),
  );

export default timeEntry;
