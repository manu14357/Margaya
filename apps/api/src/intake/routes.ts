import { requireEntitlement } from "../billing/require-entitlement-middleware";
import {
  createRoute,
  errorResponse,
  jsonResponse,
  lookupNotFound,
} from "../openapi";
import { requireWorkspacePermission } from "../utils/require-workspace-permission";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import {
  intakeItemAccess,
  requireIntakeFeatureForProject,
  requireIntakeFeatureForTask,
} from "./access";
import {
  intakeDeleteResultSchema,
  intakeItemListSchema,
  intakeItemSchema,
  intakeSummarySchema,
} from "./response";
import {
  acceptIntakeBody,
  createIntakeBody,
  declineIntakeBody,
  duplicateIntakeBody,
  intakeItemParam,
  listIntakeQuery,
  projectIdParam,
  snoozeIntakeBody,
  taskIdParam,
  updateIntakeBody,
} from "./schema";

// Route definitions of the Intake API (B7 §3.2). Every route, reads
// included, answers 403 while the project's intake feature is off.

const TAGS = ["Intake"];
const FEATURE_OFF = "the Intake feature is turned off for this project";
const VISIBILITY =
  "Callers with intake:read see every request of the project; callers with only intake:create see the requests they submitted; others get 403. intake:read limits this queue, not task reads: GET /task/{id} still works for any workspace member.";
const NO_ACCESS = `No workspace access, no intake:read or intake:create permission, or ${FEATURE_OFF}`;

function jsonBody<T>(schema: T) {
  return {
    required: true,
    content: { "application/json": { schema } },
  };
}

const triageMiddleware = [
  intakeItemAccess(),
  requireWorkspacePermission({ intake: ["triage"] }),
] as const;

const TRIAGE_FORBIDDEN = `No workspace access, missing intake:triage permission, or ${FEATURE_OFF}`;

export const listIntakeItemsRoute = createRoute({
  method: "get",
  operationId: "listIntakeItems",
  path: "/project/{projectId}",
  tags: TAGS,
  summary: "List intake requests",
  description: `List a project's requests, newest first by default. ${VISIBILITY} Statuses are effective: a snooze that has passed reads as pending immediately. counts ignore the tab and status filters.`,
  middleware: [
    workspaceAccess.fromProject("projectId"),
    requireIntakeFeatureForProject,
  ] as const,
  request: { params: projectIdParam, query: listIntakeQuery },
  responses: {
    200: jsonResponse("A page of requests", intakeItemListSchema),
    400: errorResponse(
      "Invalid query, a status outside the tab, or an unknown priority",
    ),
    403: errorResponse(NO_ACCESS),
    404: lookupNotFound("project"),
  },
});

export const getIntakeSummaryRoute = createRoute({
  method: "get",
  operationId: "getIntakeSummary",
  path: "/project/{projectId}/summary",
  tags: TAGS,
  summary: "Intake summary",
  description:
    "The project's open requests by effective status, for the Intake tab badge.",
  middleware: [
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ intake: ["read"] }),
    requireIntakeFeatureForProject,
  ] as const,
  request: { params: projectIdParam },
  responses: {
    200: jsonResponse("Open request counts", intakeSummarySchema),
    403: errorResponse(
      `No workspace access, missing intake:read permission, or ${FEATURE_OFF}`,
    ),
    404: lookupNotFound("project"),
  },
});

export const createIntakeItemRoute = createRoute({
  method: "post",
  operationId: "createIntakeItem",
  path: "/project/{projectId}",
  tags: TAGS,
  summary: "Submit request",
  description:
    "Submit a request: a task in the project's hidden triage column (created on the first submission) that stays off boards, search and reminders until accepted. Required custom fields get their defaults; none are required. Publishes intake.item_created, not task.created. The source is api for API keys, else in_app.",
  middleware: [
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ intake: ["create"] }),
    requireIntakeFeatureForProject,
    requireEntitlement,
  ] as const,
  request: { params: projectIdParam, body: jsonBody(createIntakeBody) },
  responses: {
    200: jsonResponse("The submitted request", intakeItemSchema),
    400: errorResponse("Invalid body"),
    403: errorResponse(
      `No workspace access, missing intake:create permission, or ${FEATURE_OFF}`,
    ),
    404: lookupNotFound("project"),
    409: errorResponse("The project is archived"),
  },
});

export const getIntakeItemByTaskRoute = createRoute({
  method: "get",
  operationId: "getIntakeItemByTask",
  path: "/task/{taskId}",
  tags: TAGS,
  summary: "Get request by task",
  description: `The request a task came from, accepted ones included. ${VISIBILITY}`,
  middleware: [
    workspaceAccess.fromTaskId("taskId"),
    requireIntakeFeatureForTask,
  ] as const,
  request: { params: taskIdParam },
  responses: {
    200: jsonResponse("The request", intakeItemSchema),
    403: errorResponse(NO_ACCESS),
    404: errorResponse(
      "Unknown task, a task in the trash, or one in a project the caller can't see; or the task didn't come from intake, or the caller can't see its request",
    ),
  },
});

export const getIntakeItemRoute = createRoute({
  method: "get",
  operationId: "getIntakeItem",
  path: "/item/{id}",
  tags: TAGS,
  summary: "Get request",
  description: `One request. ${VISIBILITY}`,
  middleware: [intakeItemAccess()] as const,
  request: { params: intakeItemParam },
  responses: {
    200: jsonResponse("The request", intakeItemSchema),
    403: errorResponse(NO_ACCESS),
    404: errorResponse("Request not found, or not visible to the caller"),
  },
});

export const updateIntakeItemRoute = createRoute({
  method: "patch",
  operationId: "updateIntakeItem",
  path: "/item/{id}",
  tags: TAGS,
  summary: "Edit request",
  description:
    "Change a request's title, description or priority through the ordinary task edits (same activity, realtime and integrations). Allowed with task:update, or for the requester (intake:create) while the request is open. Labels, assignees and dates use the task routes.",
  middleware: [intakeItemAccess(), requireEntitlement] as const,
  request: { params: intakeItemParam, body: jsonBody(updateIntakeBody) },
  responses: {
    200: jsonResponse("The request", intakeItemSchema),
    400: errorResponse("Invalid body, or no field to change"),
    403: errorResponse(
      `No workspace access, not the requester and no task:update permission, or ${FEATURE_OFF}`,
    ),
    404: errorResponse("Request not found"),
    409: errorResponse("The requester's request is closed"),
  },
});

export const acceptIntakeItemRoute = createRoute({
  method: "post",
  operationId: "acceptIntakeItem",
  path: "/item/{id}/accept",
  tags: TAGS,
  summary: "Accept request",
  description:
    "Move the request's task to the end of a board column, or to the backlog with planned; completedAt follows the column group. A task without assignees gets the project's default assignee, if one is set. The task then reaches the board, and task.created is published with source intake. Only open requests can be accepted; the column must not be a triage column.",
  middleware: [...triageMiddleware, requireEntitlement] as const,
  request: { params: intakeItemParam, body: jsonBody(acceptIntakeBody) },
  responses: {
    200: jsonResponse("The accepted request", intakeItemSchema),
    400: errorResponse("Invalid body, archived, or an unknown column"),
    403: errorResponse(TRIAGE_FORBIDDEN),
    404: errorResponse("Request not found"),
    409: errorResponse("The request was already accepted or is closed"),
  },
});

export const declineIntakeItemRoute = createRoute({
  method: "post",
  operationId: "declineIntakeItem",
  path: "/item/{id}/decline",
  tags: TAGS,
  summary: "Decline request",
  description:
    "Close an open request without adding it to the board; the requester is notified with the optional reason. The task stays in triage and can be reopened.",
  middleware: [...triageMiddleware] as const,
  request: { params: intakeItemParam, body: jsonBody(declineIntakeBody) },
  responses: {
    200: jsonResponse("The declined request", intakeItemSchema),
    400: errorResponse("Invalid body"),
    403: errorResponse(TRIAGE_FORBIDDEN),
    404: errorResponse("Request not found"),
    409: errorResponse("The request is not open"),
  },
});

export const snoozeIntakeItemRoute = createRoute({
  method: "post",
  operationId: "snoozeIntakeItem",
  path: "/item/{id}/snooze",
  tags: TAGS,
  summary: "Snooze request",
  description:
    "Hide an open request until a time; snoozing again changes the time. Snoozes expire on their own: from that moment the request reads as pending everywhere, and a job logs the wake-up within five minutes.",
  middleware: [...triageMiddleware] as const,
  request: { params: intakeItemParam, body: jsonBody(snoozeIntakeBody) },
  responses: {
    200: jsonResponse("The snoozed request", intakeItemSchema),
    400: errorResponse(
      "Not an ISO date-time with an offset, not in the future, or more than a year away",
    ),
    403: errorResponse(TRIAGE_FORBIDDEN),
    404: errorResponse("Request not found"),
    409: errorResponse("The request is not open"),
  },
});

export const unsnoozeIntakeItemRoute = createRoute({
  method: "post",
  operationId: "unsnoozeIntakeItem",
  path: "/item/{id}/unsnooze",
  tags: TAGS,
  summary: "Unsnooze request",
  description: "Bring a snoozed request back into review now.",
  middleware: [...triageMiddleware] as const,
  request: { params: intakeItemParam },
  responses: {
    200: jsonResponse("The pending request", intakeItemSchema),
    403: errorResponse(TRIAGE_FORBIDDEN),
    404: errorResponse("Request not found"),
    409: errorResponse("The request isn't snoozed"),
  },
});

export const markIntakeItemDuplicateRoute = createRoute({
  method: "post",
  operationId: "markIntakeItemDuplicate",
  path: "/item/{id}/duplicate",
  tags: TAGS,
  summary: "Mark request as duplicate",
  description:
    "Close an open request as a duplicate of a task on the same project's board or backlog; the requester is notified.",
  middleware: [...triageMiddleware] as const,
  request: { params: intakeItemParam, body: jsonBody(duplicateIntakeBody) },
  responses: {
    200: jsonResponse("The duplicate request", intakeItemSchema),
    400: errorResponse(
      "Invalid body, the request's own task, or a task that is archived or in intake",
    ),
    403: errorResponse(TRIAGE_FORBIDDEN),
    404: errorResponse("Request not found, or the task is not in this project"),
    409: errorResponse("The request is not open"),
  },
});

export const reopenIntakeItemRoute = createRoute({
  method: "post",
  operationId: "reopenIntakeItem",
  path: "/item/{id}/reopen",
  tags: TAGS,
  summary: "Reopen request",
  description:
    "Put a declined or duplicate request back to pending, clearing its reason.",
  middleware: [...triageMiddleware] as const,
  request: { params: intakeItemParam },
  responses: {
    200: jsonResponse("The pending request", intakeItemSchema),
    403: errorResponse(TRIAGE_FORBIDDEN),
    404: errorResponse("Request not found"),
    409: errorResponse("The request is open or was accepted"),
  },
});

export const deleteIntakeItemRoute = createRoute({
  method: "delete",
  operationId: "deleteIntakeItem",
  path: "/item/{id}",
  tags: TAGS,
  summary: "Delete request",
  description:
    "Delete a request and its task (task.deleted is published). Needs task:delete, or the requester withdrawing an open request. Accepted requests are ordinary tasks: delete the task instead.",
  middleware: [intakeItemAccess()] as const,
  request: { params: intakeItemParam },
  responses: {
    200: jsonResponse("The deleted request's ids", intakeDeleteResultSchema),
    403: errorResponse(
      `No workspace access, neither task:delete nor the requester of an open request, or ${FEATURE_OFF}`,
    ),
    404: errorResponse("Request not found"),
    409: errorResponse("The request was accepted"),
  },
});
