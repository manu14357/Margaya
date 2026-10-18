import { requireEntitlement } from "../billing/require-entitlement-middleware";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
} from "../openapi";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import { taskRecurrenceResultSchema } from "./response";
import {
  getTaskRecurrence,
  removeTaskRecurrence,
  setTaskRecurrence,
} from "./rules";
import { setTaskRecurrenceBody, taskIdParam } from "./schema";
import "./subscribers";

const getTaskRecurrenceRoute = createRoute({
  method: "get",
  operationId: "getTaskRecurrence",
  path: "/{taskId}",
  tags: ["Tasks"],
  summary: "Get a task's repeat rule",
  description:
    "The repeat rule of a task, or null when it does not repeat. Only the series' current instance holds the rule.",
  middleware: [
    workspaceAccess.fromTaskId("taskId", { notFoundMessage: "Task not found" }),
    requireWorkspacePermission({ task: ["read"] }),
  ] as const,
  request: { params: taskIdParam },
  responses: {
    200: jsonResponse("The task's repeat rule", taskRecurrenceResultSchema),
    403: errorResponse("No workspace access, or missing task:read permission"),
    404: errorResponse("Task not found"),
  },
});

const setTaskRecurrenceRoute = createRoute({
  method: "put",
  operationId: "setTaskRecurrence",
  path: "/{taskId}",
  tags: ["Tasks"],
  summary: "Make a task repeat",
  description:
    "Sets or replaces the task's repeat rule: daily, weekly on chosen weekdays, monthly on a day of the month, or yearly, every `interval` periods, with an optional end date or number of times. The pattern counts from the task's due date (else its start date, else today) in the workspace's time zone. The next instance copies the title, description, labels, assignees still in the workspace, priority and estimate, starts in the entry column, and has its dates moved to the next occurrence; the rule then moves to it. Needs task:update.",
  middleware: [
    workspaceAccess.fromTaskId("taskId", { notFoundMessage: "Task not found" }),
    requireWorkspacePermission({ task: ["update"] }),
    requireEntitlement,
  ] as const,
  request: {
    params: taskIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: setTaskRecurrenceBody } },
    },
  },
  responses: {
    200: jsonResponse("The saved repeat rule", taskRecurrenceResultSchema),
    400: errorResponse(
      "Invalid body: weekdays outside a weekly repeat, monthDay outside a monthly or yearly one, or both an end date and a count",
    ),
    403: errorResponse(
      "No workspace access, or missing task:update permission",
    ),
    404: errorResponse("Task not found"),
    409: errorResponse("The task is waiting in intake"),
  },
});

const removeTaskRecurrenceRoute = createRoute({
  method: "delete",
  operationId: "removeTaskRecurrence",
  path: "/{taskId}",
  tags: ["Tasks"],
  summary: "Stop a task repeating",
  description:
    "Removes the task's repeat rule, so no further instances are created. Instances created already stay. Removing a rule that does not exist does nothing. Needs task:update.",
  middleware: [
    workspaceAccess.fromTaskId("taskId", { notFoundMessage: "Task not found" }),
    requireWorkspacePermission({ task: ["update"] }),
  ] as const,
  request: { params: taskIdParam },
  responses: {
    200: jsonResponse(
      "The task no longer repeats (recurrence is null)",
      taskRecurrenceResultSchema,
    ),
    403: errorResponse(
      "No workspace access, or missing task:update permission",
    ),
    404: errorResponse("Task not found"),
  },
});

const taskRecurrence = apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(getTaskRecurrenceRoute, async (c) =>
    c.json(await getTaskRecurrence(c.req.valid("param").taskId), 200),
  )
  .openapi(setTaskRecurrenceRoute, async (c) =>
    c.json(
      await setTaskRecurrence({
        taskId: c.req.valid("param").taskId,
        userId: c.get("userId"),
        input: c.req.valid("json"),
      }),
      200,
    ),
  )
  .openapi(removeTaskRecurrenceRoute, async (c) =>
    c.json(
      await removeTaskRecurrence({
        taskId: c.req.valid("param").taskId,
        userId: c.get("userId"),
      }),
      200,
    ),
  );

export default taskRecurrence;
