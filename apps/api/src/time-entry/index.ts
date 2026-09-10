import {
  apiRouter,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { requireProjectFeature } from "../project/features";
import {
  hasWorkspacePermission,
  requireWorkspacePermission,
} from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import { visibleTimeEntry } from "./access";
import createTimeEntry from "./controllers/create-time-entry";
import deleteTimeEntry from "./controllers/delete-time-entry";
import getTimeEntriesByTaskId from "./controllers/get-time-entries";
import getTimeEntry from "./controllers/get-time-entry";
import updateTimeEntry from "./controllers/update-time-entry";
import { timeEntryListSchema, timeEntrySchema } from "./response";
import {
  createTimeEntryBody,
  taskIdParam,
  timeEntryParam,
  updateTimeEntryBody,
} from "./schema";

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
    400: errorResponse(
      "Unknown task, or its workspace could not be determined",
    ),
    403: errorResponse(
      "No access to the task's workspace, or time tracking is turned off for the project",
    ),
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
    400: errorResponse(
      "Unknown entry, or its workspace could not be determined",
    ),
    403: errorResponse(
      "No access to the entry's workspace, or time tracking is turned off for the project",
    ),
  },
});

const createTimeEntryRoute = createRoute({
  method: "post",
  operationId: "createTimeEntry",
  path: "/",
  tags: ["Time Entries"],
  summary: "Create time entry",
  description:
    "Log time against a task. Omit endTime to start a running entry that can be closed later with an update. Answers 403 while time tracking is turned off for the task's project.",
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
    200: jsonResponse("The created time entry", timeEntrySchema),
    400: errorResponse("Invalid timestamps, or unknown task"),
    403: errorResponse(
      "No workspace access, missing task:update permission, or time tracking is turned off for the project",
    ),
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

const timeEntry = apiRouter()
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
