import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { aiWriteProvenance } from "../ai/provenance";
import { requireEntitlement } from "../billing/require-entitlement-middleware";
import db from "../database";
import {
  assetTable,
  projectTable,
  taskTable,
  workspaceTable,
} from "../database/schema";
import {
  updateTaskEstimateHandler,
  updateTaskEstimateRoute,
} from "../estimate/task-estimate-route";
import {
  apiRouter,
  type BaseVariables,
  createRoute,
  errorResponse,
  jsonResponse,
  lookupNotFound,
} from "../openapi";
import { projectDefaultAssignee } from "../project/people";
import { canSeeProject } from "../project/visibility";
import {
  assertStorageConfigured,
  assertTaskImageKeyMatchesContext,
  createTaskImageUploadUrl,
  InvalidUploadedAssetError,
  isImageContentType,
  validateTaskAssetUploadInput,
  verifyTaskAssetUpload,
} from "../storage/s3";
import { recordPendingUpload } from "../storage/upload-sweep";
import {
  getDescriptionVersionHandler,
  getDescriptionVersionRoute,
  listDescriptionVersionsHandler,
  listDescriptionVersionsRoute,
  restoreDescriptionVersionHandler,
  restoreDescriptionVersionRoute,
} from "../task-description-version/routes";
import { boundedRequestBody } from "../utils/bounded-request-body";
import { includeBodyDestination } from "../utils/destination-project";
import { normalizeApiServerUrl } from "../utils/openapi-spec";
import {
  hasWorkspacePermission,
  requireWorkspacePermission,
  workspacePermissionChecker,
} from "../utils/require-workspace-permission";
import {
  validateAndParseDate,
  validateDateRange,
} from "../utils/validate-dates";
import { workspaceAccess } from "../utils/workspace-access-middleware";
import {
  archiveTaskHandler,
  archiveTaskRoute,
  unarchiveTaskHandler,
  unarchiveTaskRoute,
} from "./archive-route";
import bulkUpdateTasks from "./controllers/bulk-update-tasks";
import createTask from "./controllers/create-task";
import deleteTask from "./controllers/delete-task";
import exportTasks from "./controllers/export-tasks";
import getTask from "./controllers/get-task";
import getTaskByKey from "./controllers/get-task-by-key";
import getTasks from "./controllers/get-tasks";
import importTasks from "./controllers/import-tasks";
import moveTask from "./controllers/move-task";
import {
  requireBulkTaskEntitlement,
  requireBulkTaskPermission,
  requireTaskAssigneePermission,
} from "./controllers/require-task-permission";
import updateTask from "./controllers/update-task";
import updateTaskAssignee from "./controllers/update-task-assignee";
import {
  setTaskAssigneesController,
  updateTaskAssigneesController,
} from "./controllers/update-task-assignees";
import updateTaskDates from "./controllers/update-task-dates";
import updateTaskDescription from "./controllers/update-task-description";
import updateTaskDueDate from "./controllers/update-task-due-date";
import updateTaskMilestone from "./controllers/update-task-milestone";
import updateTaskPosition from "./controllers/update-task-position";
import updateTaskPriority from "./controllers/update-task-priority";
import updateTaskStatus from "./controllers/update-task-status";
import updateTaskTitle from "./controllers/update-task-title";
import {
  getDeferredDescriptionMatches,
  getDescriptionPage,
} from "./description-pages";
import {
  boardSchema,
  bulkResultSchema,
  descriptionMatchesSchema,
  descriptionPageSchema,
  finalizedAssetSchema,
  imageUploadSchema,
  moveTaskResultSchema,
  taskExportSchema,
  taskImportResultSchema,
  taskKeyLookupSchema,
  taskSchema,
  taskWithAssigneeSchema,
} from "./response";
import {
  bulkUpdateBody,
  createTaskBody,
  descriptionMatchesQuery,
  descriptionPageQuery,
  finalizeImageUploadBody,
  imageUploadBody,
  importTasksBody,
  listTasksQuery,
  moveTaskBody,
  patchAssigneesBody,
  projectIdParam,
  setAssigneesBody,
  taskKeyParam,
  taskParam,
  updateAssigneeBody,
  updateDatesBody,
  updateDescriptionBody,
  updateDueDateBody,
  updateMilestoneBody,
  updatePositionBody,
  updatePriorityBody,
  updateStatusBody,
  updateTaskBody,
  updateTitleBody,
} from "./schema";
import { similarTasksRoute } from "./similar-routes";
import { findSimilarTasks } from "./similar-tasks";

const listTasksRoute = createRoute({
  method: "get",
  operationId: "listTasks",
  path: "/tasks/{projectId}",
  tags: ["Tasks"],
  summary: "List tasks",
  description:
    "Get a project's board: its columns, each with the tasks in it, plus the archived and planned buckets. Responses always contain at most 100 tasks (50 by default). Continue through pagination.totalPages for the whole board, and for each task page follow relatedPage through pagination.relatedTotalPages for all labels, links and column metadata. Filters and sorting apply before pagination. Descriptions larger than 64 KiB are omitted with descriptionDeferred=true; read the task detail or description pages for full text.",
  middleware: [workspaceAccess.fromProject("projectId")] as const,
  request: { params: projectIdParam, query: listTasksQuery },
  responses: {
    200: jsonResponse("The project board", boardSchema),
    503: errorResponse("Task list request timed out"),
    400: errorResponse("Invalid query"),
    403: errorResponse("No access to the project's workspace"),
    404: lookupNotFound("project"),
  },
});

const bulkUpdateTasksRoute = createRoute({
  method: "patch",
  operationId: "bulkUpdateTasks",
  path: "/bulk",
  tags: ["Tasks"],
  summary: "Bulk update tasks",
  description:
    "Apply one operation to many tasks at once. Every task must be in the same workspace; updateEstimate also needs them in one project with its Estimates feature on. The assignee operations (updateAssignee, addAssignee, removeAssignee) need task:assign and change every task in one transaction; their updatedCount counts the tasks whose assignees actually changed. archive and unarchive (task:update) count the tasks whose archive state changed. move (task:update on every source project and on the destination) changes every task in one transaction and counts the tasks that moved.",
  middleware: [
    workspaceAccess.fromTasks(),
    requireBulkTaskPermission,
    requireBulkTaskEntitlement,
  ] as const,
  request: {
    body: {
      required: true,
      content: { "application/json": { schema: bulkUpdateBody } },
    },
  },
  responses: {
    200: jsonResponse("Bulk operation result", bulkResultSchema),
    400: errorResponse(
      "Invalid body, the tasks span more than one workspace, a task would pass 20 assignees, (updateStartDate) a start after a selected task's due date, or (updateEstimate) more than one project or a value outside the active estimate system",
    ),
    403: errorResponse(
      "No workspace access, missing the permission the operation needs, an assignee who is not a workspace member, or (updateEstimate) the Estimates feature is off",
    ),
    404: errorResponse(
      "No tasks found, or (move) destination project not found",
    ),
    409: errorResponse(
      "updateStatus, archive, unarchive or move on tasks waiting in intake",
    ),
  },
});

const createTaskRoute = createRoute({
  method: "post",
  operationId: "createTask",
  path: "/{projectId}",
  tags: ["Tasks"],
  summary: "Create task",
  description:
    "Add a task to a project. It is placed in the column named by `status`; the legacy status `archived` creates it archived in the project's entry column. Assignees come from `assigneeIds` (or the deprecated single `userId`) and need only task:create. When the body has neither field, the project's default assignee (if set) is assigned; send `assigneeIds: []` to create the task unassigned. The caller is recorded as the task's creator. With `parentId` the task is created as that task's subtask in one transaction, which also needs task:update.",
  middleware: [
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ task: ["create"] }),
    requireEntitlement,
  ] as const,
  request: {
    params: projectIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: createTaskBody } },
    },
  },
  responses: {
    200: jsonResponse("The created task", taskSchema),
    400: errorResponse(
      "Invalid body, more than 20 assignees, an estimate value outside the project's active estimate system, or a parent in another project or waiting in intake",
    ),
    403: errorResponse(
      "No workspace access, missing task:create permission (or task:update with `parentId`), an assignee who is not a workspace member, or an estimate sent while the project's Estimates feature is off",
    ),
    404: errorResponse(
      "Unknown project, a project in the trash, or one the caller can't see; or the parent task does not exist in this workspace",
    ),
  },
});

const getTaskRoute = createRoute({
  method: "get",
  operationId: "getTask",
  path: "/{id}",
  tags: ["Tasks"],
  summary: "Get task",
  description:
    "Get a single task by ID, with every assignee (id, name, avatar) resolved.",
  middleware: [workspaceAccess.fromTask()] as const,
  request: { params: taskParam },
  responses: {
    200: jsonResponse("Task details", taskWithAssigneeSchema),
    403: errorResponse("No access to the task's workspace"),
    404: lookupNotFound("task"),
  },
});

// Readable links (/workspace/{id}/task/WEB-12) resolve through this.
const getTaskByKeyRoute = createRoute({
  method: "get",
  operationId: "getTaskByKey",
  path: "/by-key/{workspaceId}/{key}",
  tags: ["Tasks"],
  summary: "Find a task by its key",
  description:
    "Resolves a readable task key (WEB-12, any case) inside a workspace the caller belongs to. Requests waiting in intake are not found; archived tasks are. Answers 404 when no task in the workspace has that key.",
  middleware: [workspaceAccess.fromParam("workspaceId")] as const,
  request: { params: taskKeyParam },
  responses: {
    200: jsonResponse("The task's id, project and key", taskKeyLookupSchema),
    403: errorResponse("No access to the workspace"),
    404: errorResponse("No task with that key in the workspace"),
  },
});

const moveTaskRoute = createRoute({
  method: "put",
  operationId: "moveTask",
  path: "/move/{id}",
  tags: ["Tasks"],
  summary: "Move task",
  description:
    "Move a task to another project, optionally into a named column. Both projects must be in the same workspace, and the caller needs task:update in both. A destination the caller or a project-limited API key can't reach answers 404.",
  middleware: [
    workspaceAccess.fromTask(),
    includeBodyDestination("destinationProjectId"),
    requireWorkspacePermission({ task: ["update"] }),
    requireEntitlement,
  ] as const,
  request: {
    params: taskParam,
    body: {
      required: true,
      content: { "application/json": { schema: moveTaskBody } },
    },
  },
  responses: {
    200: jsonResponse(
      "The moved task, with both project ids",
      moveTaskResultSchema,
    ),
    400: errorResponse("Invalid body"),
    403: errorResponse(
      "No workspace access, or missing task:update permission in either project",
    ),
    404: errorResponse(
      "Unknown task or destination project, one in the trash, or one the caller can't see",
    ),
    409: errorResponse(
      "The task is waiting in intake; accept it from the Intake tab instead",
    ),
  },
});

const updateTaskRoute = createRoute({
  method: "put",
  operationId: "updateTask",
  path: "/{id}",
  tags: ["Tasks"],
  summary: "Update task",
  description:
    "Replace every field of a task. Use the single-field routes for narrower edits. The estimate is not part of this body and stays unchanged; set it with PUT /task/estimate/{id}. Status: the legacy `archived` archives the task in its column; a different column restores an archived task, while echoing its current status keeps it archived. Assignees: `assigneeIds` replaces them; without it, echoing the current first assignee as `userId` keeps them all, another `userId` replaces them all, and no `userId` clears them. task:assign is needed only when the set of assignees changes.",
  middleware: [
    workspaceAccess.fromTask(),
    requireWorkspacePermission({ task: ["update"] }),
    requireTaskAssigneePermission,
    requireEntitlement,
  ] as const,
  request: {
    params: taskParam,
    body: {
      required: true,
      content: { "application/json": { schema: updateTaskBody } },
    },
  },
  responses: {
    200: jsonResponse("The updated task", taskSchema),
    400: errorResponse("Invalid body, or more than 20 assignees"),
    403: errorResponse(
      "No workspace access, missing task:update or task:assign permission, or an assignee who is not a workspace member",
    ),
    404: lookupNotFound("task"),
    409: errorResponse(
      "The task is waiting in intake and the status would change; accept it from the Intake tab instead",
    ),
  },
});

const exportTasksRoute = createRoute({
  method: "get",
  operationId: "exportTasks",
  path: "/export/{projectId}",
  tags: ["Tasks"],
  summary: "Export tasks",
  description:
    "Export a project's tasks, with their labels, as a JSON document.",
  middleware: [workspaceAccess.fromProject("projectId")] as const,
  request: { params: projectIdParam },
  responses: {
    200: jsonResponse("The exported project and tasks", taskExportSchema),
    403: errorResponse("No access to the project's workspace"),
    404: lookupNotFound("project"),
  },
});

// Imports send batches; this bounds oversized script calls (B13 §3.8).
const IMPORT_BODY_BYTES = 16 * 1024 * 1024;

const importTasksRoute = createRoute({
  method: "post",
  operationId: "importTasks",
  path: "/import/{projectId}",
  tags: ["Tasks"],
  summary: "Import tasks",
  description:
    "Import tasks into a project, at most 5,000 per request (16 MiB). Each task is reported individually, so a partial import still returns 200. A status matches a column slug, then a column name (case-insensitive), else the task goes to the backlog. Labels, cycle, modules and estimate are optional and checked softly: a value that can't be used is skipped with a warning and the task is still created.",
  middleware: [
    boundedRequestBody(IMPORT_BODY_BYTES),
    workspaceAccess.fromProject("projectId"),
    requireWorkspacePermission({ task: ["create"] }),
    requireEntitlement,
  ] as const,
  request: {
    params: projectIdParam,
    body: {
      required: true,
      content: { "application/json": { schema: importTasksBody } },
    },
  },
  responses: {
    200: jsonResponse("Per-task import outcome", taskImportResultSchema),
    400: errorResponse("Invalid body, or more than 5,000 tasks"),
    403: errorResponse(
      "No workspace access, or missing task:create permission",
    ),
    404: lookupNotFound("project"),
    413: errorResponse("The body is larger than 16 MiB"),
  },
});

const deleteTaskRoute = createRoute({
  method: "delete",
  operationId: "deleteTask",
  path: "/{id}",
  tags: ["Tasks"],
  summary: "Delete task",
  description:
    "Move a task and its sub-tasks to the project's trash (task.deleted is published for each). Trashed tasks read as gone everywhere but the trash; comments, relations, attachments and time entries are kept. Restore or delete permanently through the trash routes; trash older than TRASH_RETENTION_DAYS is deleted permanently.",
  middleware: [
    workspaceAccess.fromTask(),
    requireWorkspacePermission({ task: ["delete"] }),
  ] as const,
  request: { params: taskParam },
  responses: {
    200: jsonResponse("The trashed task", taskSchema),
    403: errorResponse(
      "No workspace access, or missing task:delete permission",
    ),
    404: lookupNotFound("task"),
  },
});

const updateTaskStatusRoute = createRoute({
  method: "put",
  operationId: "updateTaskStatus",
  path: "/status/{id}",
  tags: ["Tasks"],
  summary: "Update task status",
  description:
    "Move a task to another column in the same project; an archived task is restored. The legacy status `archived` archives the task and keeps its column (prefer POST /task/archive/{id}). Tasks waiting in intake answer 409: accepting is the only way out of triage.",
  middleware: [
    workspaceAccess.fromTask(),
    requireWorkspacePermission({ task: ["update"] }),
    requireEntitlement,
  ] as const,
  request: {
    params: taskParam,
    body: {
      required: true,
      content: { "application/json": { schema: updateStatusBody } },
    },
  },
  responses: {
    200: jsonResponse("The updated task", taskSchema),
    400: errorResponse("Invalid body"),
    403: errorResponse(
      "No workspace access, or missing task:update permission",
    ),
    404: lookupNotFound("task"),
    409: errorResponse(
      "The task is waiting in intake; accept it from the Intake tab instead",
    ),
  },
});

const updateTaskPositionRoute = createRoute({
  method: "put",
  operationId: "updateTaskPosition",
  path: "/position/{id}",
  tags: ["Tasks"],
  summary: "Update task position",
  description:
    "Place a task in its column, or move it to another column in the same project; an archived task moved to another column is restored. Only the position and, when it differs, the status change, so this is safe to call from a view that may hold stale task data. Reordering does not change the task's `updatedAt`. Tasks waiting in intake can be reordered, but answer 409 to a status change: accepting is the only way out of triage. The legacy status `archived` is rejected; use POST /task/archive/{id}.",
  middleware: [
    workspaceAccess.fromTask(),
    requireWorkspacePermission({ task: ["update"] }),
    requireEntitlement,
  ] as const,
  request: {
    params: taskParam,
    body: {
      required: true,
      content: { "application/json": { schema: updatePositionBody } },
    },
  },
  responses: {
    200: jsonResponse("The updated task", taskSchema),
    400: errorResponse("Invalid body or status"),
    403: errorResponse(
      "No workspace access, or missing task:update permission",
    ),
    404: errorResponse("Task not found, or in the trash"),
    409: errorResponse(
      "The task is waiting in intake and the status would change; accept it from the Intake tab instead",
    ),
  },
});

const updateTaskPriorityRoute = createRoute({
  method: "put",
  operationId: "updateTaskPriority",
  path: "/priority/{id}",
  tags: ["Tasks"],
  summary: "Update task priority",
  description: "Set a task's priority.",
  middleware: [
    workspaceAccess.fromTask(),
    requireWorkspacePermission({ task: ["update"] }),
    requireEntitlement,
  ] as const,
  request: {
    params: taskParam,
    body: {
      required: true,
      content: { "application/json": { schema: updatePriorityBody } },
    },
  },
  responses: {
    200: jsonResponse("The updated task", taskSchema),
    400: errorResponse("Invalid priority"),
    403: errorResponse(
      "No workspace access, or missing task:update permission",
    ),
    404: lookupNotFound("task"),
  },
});

const updateTaskMilestoneRoute = createRoute({
  method: "put",
  operationId: "updateTaskMilestone",
  path: "/milestone/{id}",
  tags: ["Tasks"],
  summary: "Mark task as milestone",
  description:
    "Mark a task as a milestone, or back to a regular task. The timeline draws a milestone as a single point on its due date; its stored dates don't change.",
  middleware: [
    workspaceAccess.fromTask(),
    requireWorkspacePermission({ task: ["update"] }),
    requireEntitlement,
  ] as const,
  request: {
    params: taskParam,
    body: {
      required: true,
      content: { "application/json": { schema: updateMilestoneBody } },
    },
  },
  responses: {
    200: jsonResponse("The updated task", taskSchema),
    400: errorResponse("Invalid body"),
    403: errorResponse(
      "No workspace access, or missing task:update permission",
    ),
    404: lookupNotFound("task"),
  },
});

const updateTaskAssigneeRoute = createRoute({
  method: "put",
  operationId: "updateTaskAssignee",
  path: "/assignee/{id}",
  tags: ["Tasks"],
  summary: "Replace task assignee",
  description:
    "Replace all of a task's assignees with one workspace member, or send null to unassign everyone. Use the assignees routes to keep other assignees.",
  middleware: [
    workspaceAccess.fromTask(),
    requireWorkspacePermission({ task: ["assign"] }),
    requireEntitlement,
  ] as const,
  request: {
    params: taskParam,
    body: {
      required: true,
      content: { "application/json": { schema: updateAssigneeBody } },
    },
  },
  responses: {
    200: jsonResponse("The updated task", taskSchema),
    400: errorResponse("Invalid body"),
    403: errorResponse(
      "No workspace access, missing task:assign permission, or the assignee is not a member of the workspace",
    ),
    404: lookupNotFound("task"),
  },
});

const setTaskAssigneesRoute = createRoute({
  method: "put",
  operationId: "setTaskAssignees",
  path: "/assignees/{id}",
  tags: ["Tasks"],
  summary: "Set task assignees",
  description:
    "Replace a task's assignees with this list of workspace members. People who stay keep their order; new people are added at the end. Send an empty list to unassign everyone. At most 20.",
  middleware: [
    workspaceAccess.fromTask(),
    requireWorkspacePermission({ task: ["assign"] }),
    requireEntitlement,
  ] as const,
  request: {
    params: taskParam,
    body: {
      required: true,
      content: { "application/json": { schema: setAssigneesBody } },
    },
  },
  responses: {
    200: jsonResponse("The updated task", taskSchema),
    400: errorResponse("Invalid body, or more than 20 assignees"),
    403: errorResponse(
      "No workspace access, missing task:assign permission, or a new assignee who is not a member of the workspace",
    ),
    404: errorResponse("Task not found"),
  },
});

const updateTaskAssigneesRoute = createRoute({
  method: "patch",
  operationId: "updateTaskAssignees",
  path: "/assignees/{id}",
  tags: ["Tasks"],
  summary: "Add or remove task assignees",
  description:
    "Add and/or remove workspace members without touching the other assignees. Adding someone already assigned, or removing someone who isn't, does nothing.",
  middleware: [
    workspaceAccess.fromTask(),
    requireWorkspacePermission({ task: ["assign"] }),
    requireEntitlement,
  ] as const,
  request: {
    params: taskParam,
    body: {
      required: true,
      content: { "application/json": { schema: patchAssigneesBody } },
    },
  },
  responses: {
    200: jsonResponse("The updated task", taskSchema),
    400: errorResponse(
      "Invalid body, nothing to add or remove, one user in both lists, or more than 20 assignees",
    ),
    403: errorResponse(
      "No workspace access, missing task:assign permission, or an added user who is not a member of the workspace",
    ),
    404: errorResponse("Task not found"),
  },
});

const updateTaskDueDateRoute = createRoute({
  method: "put",
  operationId: "updateTaskDueDate",
  path: "/due-date/{id}",
  tags: ["Tasks"],
  summary: "Update task due date",
  description: "Set or clear a task's due date.",
  middleware: [
    workspaceAccess.fromTask(),
    requireWorkspacePermission({ task: ["update"] }),
    requireEntitlement,
  ] as const,
  request: {
    params: taskParam,
    body: {
      required: true,
      content: { "application/json": { schema: updateDueDateBody } },
    },
  },
  responses: {
    200: jsonResponse("The updated task", taskSchema),
    400: errorResponse("Invalid date"),
    403: errorResponse(
      "No workspace access, or missing task:update permission",
    ),
    404: lookupNotFound("task"),
  },
});

const updateTaskDatesRoute = createRoute({
  method: "put",
  operationId: "updateTaskDates",
  path: "/dates/{id}",
  tags: ["Tasks"],
  summary: "Update task dates",
  description:
    "Set or clear a task's start and due dates in one atomic write, for moving a task on a timeline or calendar. A date left out keeps its current value and null clears it; nothing else on the task changes. The start may not be after the due date, checked against the stored date when only one is sent. Moving the due date resets its sent reminders.",
  middleware: [
    workspaceAccess.fromTask(),
    requireWorkspacePermission({ task: ["update"] }),
    requireEntitlement,
  ] as const,
  request: {
    params: taskParam,
    body: {
      required: true,
      content: { "application/json": { schema: updateDatesBody } },
    },
  },
  responses: {
    200: jsonResponse("The updated task", taskSchema),
    400: errorResponse(
      "Invalid body, neither date sent, an invalid date, or a start after the due date",
    ),
    403: errorResponse(
      "No workspace access, or missing task:update permission",
    ),
    404: errorResponse("Task not found, or in the trash"),
  },
});

const updateTaskTitleRoute = createRoute({
  method: "put",
  operationId: "updateTaskTitle",
  path: "/title/{id}",
  tags: ["Tasks"],
  summary: "Update task title",
  description: "Rename a task.",
  middleware: [
    workspaceAccess.fromTask(),
    requireWorkspacePermission({ task: ["update"] }),
    requireEntitlement,
  ] as const,
  request: {
    params: taskParam,
    body: {
      required: true,
      content: { "application/json": { schema: updateTitleBody } },
    },
  },
  responses: {
    200: jsonResponse("The updated task", taskSchema),
    400: errorResponse("Invalid body"),
    403: errorResponse(
      "No workspace access, or missing task:update permission",
    ),
    404: lookupNotFound("task"),
  },
});

const createTaskImageUploadRoute = createRoute({
  method: "put",
  operationId: "createTaskImageUpload",
  path: "/image-upload/{id}",
  tags: ["Tasks"],
  summary: "Create image upload URL",
  description:
    "Get a presigned URL for uploading an image used in a task description or comment. PUT the bytes to it, then call the finalize route.",
  middleware: [
    workspaceAccess.fromTask(),
    requireWorkspacePermission({ task: ["update"] }),
    requireEntitlement,
  ] as const,
  request: {
    params: taskParam,
    body: {
      required: true,
      content: { "application/json": { schema: imageUploadBody } },
    },
  },
  responses: {
    200: jsonResponse("The presigned upload", imageUploadSchema),
    400: errorResponse("Unsupported content type, or the file is too large"),
    403: errorResponse(
      "No workspace access, or missing task:update permission",
    ),
    404: errorResponse("Task not found"),
    503: errorResponse("Image uploads are not configured on this instance"),
  },
});

const finalizeTaskImageUploadRoute = createRoute({
  method: "post",
  operationId: "finalizeTaskImageUpload",
  path: "/image-upload/{id}/finalize",
  tags: ["Tasks"],
  summary: "Finalize image upload",
  description:
    "Record an uploaded image as a private asset and return the URL to reference it by.",
  middleware: [
    workspaceAccess.fromTask(),
    requireWorkspacePermission({ task: ["update"] }),
    requireEntitlement,
  ] as const,
  request: {
    params: taskParam,
    body: {
      required: true,
      content: { "application/json": { schema: finalizeImageUploadBody } },
    },
  },
  responses: {
    200: jsonResponse("The stored asset", finalizedAssetSchema),
    400: errorResponse(
      "Invalid upload, or the key does not belong to this task",
    ),
    403: errorResponse(
      "No workspace access, or missing task:update permission",
    ),
    404: errorResponse("Task not found"),
    503: errorResponse(
      "Image uploads are not configured on this instance, or the upload could not be verified",
    ),
  },
});

const updateTaskDescriptionRoute = createRoute({
  method: "put",
  operationId: "updateTaskDescription",
  path: "/description/{id}",
  tags: ["Tasks"],
  summary: "Update task description",
  description: "Replace a task's description.",
  middleware: [
    workspaceAccess.fromTask(),
    requireWorkspacePermission({ task: ["update"] }),
    requireEntitlement,
  ] as const,
  request: {
    params: taskParam,
    body: {
      required: true,
      content: { "application/json": { schema: updateDescriptionBody } },
    },
  },
  responses: {
    200: jsonResponse("The updated task", taskSchema),
    400: errorResponse("Invalid body"),
    403: errorResponse(
      "No workspace access, or missing task:update permission",
    ),
    404: lookupNotFound("task"),
  },
});

const descriptionPageRoute = createRoute({
  method: "get",
  operationId: "getTaskDescriptionPage",
  path: "/{id}/description",
  tags: ["Tasks"],
  summary: "Read a description page",
  description:
    "Read a task's description in pages of 32,768 characters, for a description larger than 64 KiB that task lists omit (descriptionDeferred). Start at offset 0 and follow nextOffset until it is null; offsets count Unicode characters. Send the version from the first page with each later one: if the task was edited in between, the answer is 409 and the read starts again from offset 0.",
  middleware: [workspaceAccess.fromTaskId("id")] as const,
  request: { params: taskParam, query: descriptionPageQuery },
  responses: {
    200: jsonResponse("Description page", descriptionPageSchema),
    400: errorResponse("Invalid offset or version"),
    403: errorResponse("No workspace access"),
    404: lookupNotFound("task"),
    409: errorResponse("Description changed; reload from offset zero"),
    503: errorResponse("Description request timed out"),
  },
});
const descriptionMatchesRoute = createRoute({
  method: "get",
  operationId: "findDeferredTaskDescriptions",
  path: "/description-matches/{projectId}",
  tags: ["Tasks"],
  summary: "Search descriptions omitted from task lists",
  description:
    "Find the project's board tasks (archived ones included; trashed tasks and requests waiting in intake left out) whose description is larger than 64 KiB, so task lists omit it (descriptionDeferred), and contains `query` as plain text, ignoring case. A board search uses it for the text it doesn't have. Answers task ids in id order, 100 per page; pass nextCursor as `after` for the next page.",
  middleware: [workspaceAccess.fromProject("projectId")] as const,
  request: { params: projectIdParam, query: descriptionMatchesQuery },
  responses: {
    200: jsonResponse("Matching task IDs", descriptionMatchesSchema),
    400: errorResponse("Invalid search query or cursor"),
    403: errorResponse("No workspace access"),
    404: lookupNotFound("project"),
    503: errorResponse("Description search timed out"),
  },
});

const task = apiRouter<BaseVariables & { workspaceId: string }>()
  .openapi(descriptionPageRoute, async (c) =>
    c.json(
      await getDescriptionPage(c.req.valid("param").id, c.req.valid("query")),
      200,
    ),
  )
  .openapi(similarTasksRoute, async (c) =>
    c.json(
      await findSimilarTasks({
        projectId: c.req.valid("param").projectId,
        workspaceId: c.get("workspaceId"),
        userId: c.get("userId"),
        text: c.req.valid("query").q,
        can: await workspacePermissionChecker(c),
      }),
      200,
    ),
  )
  .openapi(descriptionMatchesRoute, async (c) => {
    const { query, after } = c.req.valid("query");
    return c.json(
      await getDeferredDescriptionMatches(
        c.req.valid("param").projectId,
        query,
        after,
      ),
      200,
    );
  })
  .openapi(listTasksRoute, async (c) => {
    const { projectId } = c.req.valid("param");
    const filters = c.req.valid("query") || {};

    const tasks = await getTasks(projectId, filters);

    return c.json(tasks, 200);
  })
  .openapi(bulkUpdateTasksRoute, async (c) => {
    const { taskIds, operation, value } = c.req.valid("json");
    const userId = c.get("userId");

    if (!userId) {
      throw new HTTPException(401, { message: "Unauthorized" });
    }

    if (
      operation !== "delete" &&
      operation !== "updateDueDate" &&
      operation !== "updateStartDate" &&
      operation !== "archive" &&
      operation !== "unarchive" &&
      value === undefined
    ) {
      throw new HTTPException(400, {
        message: "Value is required for this operation",
      });
    }

    const result = await bulkUpdateTasks({
      taskIds,
      operation,
      value,
      userId,
    });

    return c.json(result, 200);
  })
  .openapi(createTaskRoute, async (c) => {
    const { projectId } = c.req.param();
    const {
      title,
      description,
      startDate,
      dueDate,
      priority,
      status,
      userId,
      assigneeIds,
      customFields,
      estimatePointId,
      parentId,
      isMilestone,
      aiAssist,
    } = c.req.valid("json");

    // Linking the new task under a parent changes the parent's subtasks,
    // which the relation routes guard with task:update.
    if (parentId && !(await hasWorkspacePermission(c, { task: ["update"] }))) {
      throw new HTTPException(403, { message: "Insufficient permissions" });
    }

    const parsedStartDate =
      startDate !== undefined
        ? validateAndParseDate(startDate, "startDate")
        : undefined;
    const parsedDueDate =
      dueDate !== undefined
        ? validateAndParseDate(dueDate, "dueDate")
        : undefined;

    validateDateRange(parsedStartDate, parsedDueDate);

    // The project's default assignee applies only when the request leaves
    // assignees out entirely; an explicit empty list stays unassigned.
    const defaultAssignee =
      assigneeIds === undefined && userId === undefined
        ? await projectDefaultAssignee(projectId)
        : null;

    const task = await createTask({
      projectId,
      currentUserId: c.get("userId"),
      userId: userId,
      assigneeIds: defaultAssignee ? [defaultAssignee] : assigneeIds,
      title,
      description,
      startDate: parsedStartDate,
      dueDate: parsedDueDate,
      priority,
      status,
      customFields,
      estimatePointId,
      parentId,
      isMilestone,
      aiProvenance: await aiWriteProvenance({
        workspaceId: c.get("workspaceId"),
        userId: c.get("userId"),
        assist: aiAssist,
      }),
    });

    return c.json(task, 200);
  })
  .openapi(getTaskRoute, async (c) => {
    const { id } = c.req.valid("param");

    const task = await getTask(id);

    return c.json(task, 200);
  })
  .openapi(getTaskByKeyRoute, async (c) => {
    const { workspaceId, key } = c.req.valid("param");
    const found = await getTaskByKey(workspaceId, key);
    // A task of a restricted project the caller cannot see reads as missing.
    if (!(await canSeeProject(c.get("userId"), found.projectId))) {
      throw new HTTPException(404, { message: "Task not found" });
    }
    return c.json(found, 200);
  })
  .openapi(moveTaskRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { destinationProjectId, destinationStatus } = c.req.valid("json");
    const currentUserId = c.get("userId");

    const result = await moveTask({
      taskId: id,
      destinationProjectId,
      destinationStatus,
      currentUserId,
    });

    return c.json(result, 200);
  })
  .openapi(updateTaskRoute, async (c) => {
    const { id } = c.req.valid("param");
    const {
      title,
      description,
      startDate,
      dueDate,
      priority,
      status,
      projectId,
      position,
      userId,
      assigneeIds,
      aiAssist,
    } = c.req.valid("json");

    const currentUserId = c.get("userId");

    const parsedStartDate =
      startDate !== undefined
        ? validateAndParseDate(startDate, "startDate")
        : undefined;
    const parsedDueDate =
      dueDate !== undefined
        ? validateAndParseDate(dueDate, "dueDate")
        : undefined;

    validateDateRange(parsedStartDate, parsedDueDate);

    const task = await updateTask(
      id,
      title,
      status,
      parsedStartDate,
      parsedDueDate,
      projectId,
      description,
      priority,
      position,
      userId,
      currentUserId,
      assigneeIds,
      { workspaceId: c.get("workspaceId"), assist: aiAssist },
    );

    return c.json(task, 200);
  })
  .openapi(exportTasksRoute, async (c) => {
    const { projectId } = c.req.valid("param");

    const exportData = await exportTasks(projectId);

    return c.json(exportData, 200);
  })
  .openapi(importTasksRoute, async (c) => {
    const { projectId } = c.req.valid("param");
    const { tasks } = c.req.valid("json");
    const currentUserId = c.get("userId");

    const result = await importTasks(projectId, tasks, currentUserId);

    return c.json(result, 200);
  })
  .openapi(deleteTaskRoute, async (c) => {
    const { id } = c.req.valid("param");

    const currentUserId = c.get("userId");
    const task = await deleteTask(id, currentUserId);

    return c.json(task, 200);
  })
  .openapi(updateTaskStatusRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { status } = c.req.valid("json");
    const currentUserId = c.get("userId");

    const task = await updateTaskStatus({ id, status, currentUserId });

    return c.json(task, 200);
  })
  .openapi(updateTaskPositionRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { position, status } = c.req.valid("json");
    const currentUserId = c.get("userId");

    const task = await updateTaskPosition({
      id,
      position,
      status,
      currentUserId,
    });

    return c.json(task, 200);
  })
  .openapi(updateTaskPriorityRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { priority } = c.req.valid("json");
    const currentUserId = c.get("userId");

    const task = await updateTaskPriority({ id, priority, currentUserId });

    return c.json(task, 200);
  })
  .openapi(updateTaskMilestoneRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { isMilestone } = c.req.valid("json");
    const currentUserId = c.get("userId");

    const task = await updateTaskMilestone({ id, isMilestone, currentUserId });

    return c.json(task, 200);
  })
  .openapi(updateTaskEstimateRoute, updateTaskEstimateHandler)
  .openapi(archiveTaskRoute, archiveTaskHandler)
  .openapi(listDescriptionVersionsRoute, listDescriptionVersionsHandler)
  .openapi(getDescriptionVersionRoute, getDescriptionVersionHandler)
  .openapi(restoreDescriptionVersionRoute, restoreDescriptionVersionHandler)
  .openapi(unarchiveTaskRoute, unarchiveTaskHandler)
  .openapi(updateTaskAssigneeRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { userId } = c.req.valid("json");
    const currentUserId = c.get("userId");

    const task = await updateTaskAssignee({ id, userId, currentUserId });

    return c.json(task, 200);
  })
  .openapi(setTaskAssigneesRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { assigneeIds } = c.req.valid("json");

    const task = await setTaskAssigneesController({
      id,
      assigneeIds,
      currentUserId: c.get("userId"),
    });

    return c.json(task, 200);
  })
  .openapi(updateTaskAssigneesRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { add, remove } = c.req.valid("json");

    const task = await updateTaskAssigneesController({
      id,
      add,
      remove,
      currentUserId: c.get("userId"),
    });

    return c.json(task, 200);
  })
  .openapi(updateTaskDueDateRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { dueDate = null } = c.req.valid("json");
    const currentUserId = c.get("userId");

    const task = await updateTaskDueDate({
      id,
      dueDate: dueDate ? validateAndParseDate(dueDate, "dueDate") : null,
      currentUserId,
    });

    return c.json(task, 200);
  })
  .openapi(updateTaskDatesRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { startDate, dueDate } = c.req.valid("json");
    // undefined keeps the stored date, null clears it.
    const parse = (value: string | null | undefined, field: string) =>
      value == null ? value : validateAndParseDate(value, field);

    const task = await updateTaskDates({
      id,
      startDate: parse(startDate, "startDate"),
      dueDate: parse(dueDate, "dueDate"),
      currentUserId: c.get("userId"),
    });

    return c.json(task, 200);
  })
  .openapi(updateTaskTitleRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { title } = c.req.valid("json");
    const currentUserId = c.get("userId");

    const task = await updateTaskTitle({ id, title, currentUserId });

    return c.json(task, 200);
  })
  .openapi(createTaskImageUploadRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { filename, contentType, size, surface } = c.req.valid("json");

    try {
      validateTaskAssetUploadInput(contentType, size);
    } catch (error) {
      throw new HTTPException(400, {
        message:
          error instanceof Error
            ? error.message
            : "Invalid image upload request",
      });
    }

    const [taskContext] = await db
      .select({
        taskId: taskTable.id,
        projectId: taskTable.projectId,
        workspaceId: workspaceTable.id,
      })
      .from(taskTable)
      .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
      .innerJoin(
        workspaceTable,
        eq(projectTable.workspaceId, workspaceTable.id),
      )
      .where(eq(taskTable.id, id))
      .limit(1);

    if (!taskContext) {
      throw new HTTPException(404, { message: "Task not found" });
    }

    try {
      const upload = await createTaskImageUploadUrl({
        workspaceId: taskContext.workspaceId,
        projectId: taskContext.projectId,
        taskId: taskContext.taskId,
        surface,
        filename,
        contentType,
        size,
      });
      await recordPendingUpload(upload.key);

      return c.json(upload, 200);
    } catch (error) {
      throw new HTTPException(503, {
        message:
          error instanceof Error
            ? error.message
            : "Image uploads are not configured",
      });
    }
  })
  .openapi(finalizeTaskImageUploadRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { key, filename, contentType, size, surface } = c.req.valid("json");
    const userId = c.get("userId");

    try {
      validateTaskAssetUploadInput(contentType, size);
    } catch (error) {
      throw new HTTPException(400, {
        message:
          error instanceof Error
            ? error.message
            : "Invalid image upload request",
      });
    }

    const [taskContext] = await db
      .select({
        taskId: taskTable.id,
        projectId: taskTable.projectId,
        workspaceId: workspaceTable.id,
      })
      .from(taskTable)
      .innerJoin(projectTable, eq(taskTable.projectId, projectTable.id))
      .innerJoin(
        workspaceTable,
        eq(projectTable.workspaceId, workspaceTable.id),
      )
      .where(eq(taskTable.id, id))
      .limit(1);

    if (!taskContext) {
      throw new HTTPException(404, { message: "Task not found" });
    }

    try {
      assertStorageConfigured();
    } catch (error) {
      throw new HTTPException(503, {
        message:
          error instanceof Error
            ? error.message
            : "Image uploads are not configured",
      });
    }

    const normalizedKey = key.trim();
    if (
      !assertTaskImageKeyMatchesContext(normalizedKey, {
        workspaceId: taskContext.workspaceId,
        projectId: taskContext.projectId,
        taskId: taskContext.taskId,
        surface,
      })
    ) {
      throw new HTTPException(400, {
        message: "Image upload key does not match the task context.",
      });
    }

    let uploaded: Awaited<ReturnType<typeof verifyTaskAssetUpload>>;
    try {
      uploaded = await verifyTaskAssetUpload(normalizedKey, {
        size,
        contentType,
      });
    } catch (error) {
      throw new HTTPException(
        error instanceof InvalidUploadedAssetError ? 400 : 503,
        {
          message:
            error instanceof InvalidUploadedAssetError
              ? error.message
              : "Unable to verify uploaded object.",
        },
      );
    }

    const [existingAsset] = await db
      .select({ id: assetTable.id })
      .from(assetTable)
      .where(eq(assetTable.objectKey, normalizedKey))
      .limit(1);

    const [asset] = existingAsset
      ? await db
          .update(assetTable)
          .set({
            workspaceId: taskContext.workspaceId,
            projectId: taskContext.projectId,
            taskId: taskContext.taskId,
            filename,
            mimeType: uploaded.contentType,
            size: uploaded.size,
            kind: isImageContentType(uploaded.contentType)
              ? "image"
              : "attachment",
            surface,
            createdBy: userId || null,
          })
          .where(eq(assetTable.id, existingAsset.id))
          .returning({
            id: assetTable.id,
          })
      : await db
          .insert(assetTable)
          .values({
            workspaceId: taskContext.workspaceId,
            projectId: taskContext.projectId,
            taskId: taskContext.taskId,
            objectKey: normalizedKey,
            filename,
            mimeType: uploaded.contentType,
            size: uploaded.size,
            kind: isImageContentType(uploaded.contentType)
              ? "image"
              : "attachment",
            surface,
            createdBy: userId || null,
          })
          .returning({
            id: assetTable.id,
          });

    if (!asset) {
      throw new HTTPException(500, {
        message: "Failed to save asset",
      });
    }

    const apiBaseUrl = normalizeApiServerUrl(
      process.env.MARGAYA_API_URL || new URL(c.req.url).origin,
    );
    return c.json(
      {
        id: asset.id,
        url: `${apiBaseUrl}/asset/${asset.id}`,
      },
      200,
    );
  })
  .openapi(updateTaskDescriptionRoute, async (c) => {
    const { id } = c.req.valid("param");
    const { description, aiAssist } = c.req.valid("json");
    const currentUserId = c.get("userId");

    const task = await updateTaskDescription({
      id,
      description,
      currentUserId,
      ai: { workspaceId: c.get("workspaceId"), assist: aiAssist },
    });

    return c.json(task, 200);
  });

export default task;
