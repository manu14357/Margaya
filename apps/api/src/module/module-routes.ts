import { requireEntitlement } from "../billing/require-entitlement-middleware";
import { createRoute, errorResponse, jsonResponse } from "../openapi";
import {
  moduleDeleteResultSchema,
  moduleDetailSchema,
  moduleLinkDeleteResultSchema,
  moduleLinkListSchema,
  moduleLinkSchema,
  moduleProgressSchema,
  moduleSchema,
  moduleTaskChangeSchema,
  moduleTaskPageSchema,
} from "./response";
import {
  FEATURE_OFF,
  jsonBody,
  readModule,
  TAGS,
  updateModuleMiddleware,
} from "./routes";
import {
  createModuleLinkBody,
  listModuleTasksQuery,
  moduleLinkParam,
  moduleParam,
  moduleTaskIdsBody,
  updateModuleBody,
  updateModuleLinkBody,
} from "./schema";

const readForbidden = errorResponse(
  `No workspace access, missing module:read permission, or ${FEATURE_OFF}`,
);
const updateForbidden = errorResponse(
  `No workspace access, missing module:update permission, or ${FEATURE_OFF}`,
);
const notFound = errorResponse("Module not found");
const archived = errorResponse("The module is archived");

export const getModuleRoute = createRoute({
  method: "get",
  operationId: "getModule",
  path: "/{id}",
  tags: TAGS,
  summary: "Get module",
  description:
    "Get one module, archived ones included, with its links and members.",
  middleware: [...readModule] as const,
  request: { params: moduleParam },
  responses: {
    200: jsonResponse("The module", moduleDetailSchema),
    403: readForbidden,
    404: notFound,
  },
});

export const updateModuleRoute = createRoute({
  method: "put",
  operationId: "updateModule",
  path: "/{id}",
  tags: TAGS,
  summary: "Update module",
  description:
    "Change a module; omitted fields stay unchanged. null clears the description, the dates and the lead; memberIds replaces the members. Archived modules can't change.",
  middleware: [...updateModuleMiddleware, requireEntitlement] as const,
  request: { params: moduleParam, body: jsonBody(updateModuleBody) },
  responses: {
    200: jsonResponse("The updated module", moduleSchema),
    400: errorResponse(
      "Invalid body or dates, or a lead or member outside the workspace",
    ),
    403: updateForbidden,
    404: notFound,
    409: errorResponse(
      "The module is archived, or another module has this name",
    ),
  },
});

export const deleteModuleRoute = createRoute({
  method: "delete",
  operationId: "deleteModule",
  path: "/{id}",
  tags: TAGS,
  summary: "Delete module",
  description:
    "Delete a module, archived ones included. Needs module:delete, or module:update for the module's creator. Its tasks stay in the project; favorites and recent visits of the module are removed.",
  middleware: [...updateModuleMiddleware] as const,
  request: { params: moduleParam },
  responses: {
    200: jsonResponse(
      "The deleted module and the tasks it held",
      moduleDeleteResultSchema,
    ),
    403: errorResponse(
      `No workspace access, not an admin or the module's creator, or ${FEATURE_OFF}`,
    ),
    404: notFound,
  },
});

export const archiveModuleRoute = createRoute({
  method: "post",
  operationId: "archiveModule",
  path: "/{id}/archive",
  tags: TAGS,
  summary: "Archive module",
  description:
    "Archive a completed or cancelled module. It becomes read-only, leaves pickers and the default list, and its favorites and recent visits are removed. Archiving an archived module changes nothing.",
  middleware: [...updateModuleMiddleware] as const,
  request: { params: moduleParam },
  responses: {
    200: jsonResponse("The archived module", moduleSchema),
    400: errorResponse("The module is not completed or cancelled"),
    403: updateForbidden,
    404: notFound,
  },
});

export const unarchiveModuleRoute = createRoute({
  method: "post",
  operationId: "unarchiveModule",
  path: "/{id}/unarchive",
  tags: TAGS,
  summary: "Restore module",
  description:
    "Restore an archived module. Restoring an active module changes nothing.",
  middleware: [...updateModuleMiddleware] as const,
  request: { params: moduleParam },
  responses: {
    200: jsonResponse("The restored module", moduleSchema),
    403: updateForbidden,
    404: notFound,
  },
});

export const getModuleProgressRoute = createRoute({
  method: "get",
  operationId: "getModuleProgress",
  path: "/{id}/progress",
  tags: TAGS,
  summary: "Get module progress",
  description:
    "Counts, progress, the burn-down/burn-up chart and breakdowns by assignee, label and priority over the module's visible tasks. Cancelled tasks are counted apart and never in progress.",
  middleware: [...readModule] as const,
  request: { params: moduleParam },
  responses: {
    200: jsonResponse("The module's progress report", moduleProgressSchema),
    403: readForbidden,
    404: notFound,
  },
});

export const listModuleTasksRoute = createRoute({
  method: "get",
  operationId: "listModuleTasks",
  path: "/{id}/tasks",
  tags: TAGS,
  summary: "List module tasks",
  description:
    "The module's visible tasks (not archived, not in triage) by number, 50 per page by default and at most 100.",
  middleware: [...readModule] as const,
  request: { params: moduleParam, query: listModuleTasksQuery },
  responses: {
    200: jsonResponse("A page of the module's tasks", moduleTaskPageSchema),
    400: errorResponse("Invalid query"),
    403: readForbidden,
    404: notFound,
  },
});

export const addModuleTasksRoute = createRoute({
  method: "post",
  operationId: "addModuleTasks",
  path: "/{id}/tasks",
  tags: TAGS,
  summary: "Add tasks to module",
  description:
    "Add up to 200 tasks. Ids that are not visible tasks of the module's project come back as ignored, which is not an error.",
  middleware: [...updateModuleMiddleware, requireEntitlement] as const,
  request: { params: moduleParam, body: jsonBody(moduleTaskIdsBody) },
  responses: {
    200: jsonResponse("What changed for each id", moduleTaskChangeSchema),
    400: errorResponse("Invalid body"),
    403: updateForbidden,
    404: notFound,
    409: archived,
  },
});

export const removeModuleTasksRoute = createRoute({
  method: "delete",
  operationId: "removeModuleTasks",
  path: "/{id}/tasks",
  tags: TAGS,
  summary: "Remove tasks from module",
  description:
    "Take up to 200 tasks out of the module. Ids that are not visible tasks of the module's project come back as ignored, which is not an error.",
  middleware: [...updateModuleMiddleware] as const,
  request: { params: moduleParam, body: jsonBody(moduleTaskIdsBody) },
  responses: {
    200: jsonResponse("What changed for each id", moduleTaskChangeSchema),
    400: errorResponse("Invalid body"),
    403: updateForbidden,
    404: notFound,
    409: archived,
  },
});

export const listModuleLinksRoute = createRoute({
  method: "get",
  operationId: "listModuleLinks",
  path: "/{id}/links",
  tags: TAGS,
  summary: "List module links",
  description: "The module's reference links, newest first.",
  middleware: [...readModule] as const,
  request: { params: moduleParam },
  responses: {
    200: jsonResponse("The module's links", moduleLinkListSchema),
    403: readForbidden,
    404: notFound,
  },
});

export const createModuleLinkRoute = createRoute({
  method: "post",
  operationId: "createModuleLink",
  path: "/{id}/links",
  tags: TAGS,
  summary: "Add module link",
  description:
    "Add an http or https link (https:// is assumed without a scheme). A module has at most 100 links, each URL once.",
  middleware: [...updateModuleMiddleware, requireEntitlement] as const,
  request: { params: moduleParam, body: jsonBody(createModuleLinkBody) },
  responses: {
    200: jsonResponse("The created link", moduleLinkSchema),
    400: errorResponse("Invalid URL or title, or 100 links already"),
    403: updateForbidden,
    404: notFound,
    409: errorResponse("The module is archived, or already has this link"),
  },
});

export const updateModuleLinkRoute = createRoute({
  method: "put",
  operationId: "updateModuleLink",
  path: "/{id}/links/{linkId}",
  tags: TAGS,
  summary: "Update module link",
  description:
    "Change a link's URL or title; omitted fields stay, null clears the title.",
  middleware: [...updateModuleMiddleware, requireEntitlement] as const,
  request: { params: moduleLinkParam, body: jsonBody(updateModuleLinkBody) },
  responses: {
    200: jsonResponse("The updated link", moduleLinkSchema),
    400: errorResponse("Invalid URL or title"),
    403: updateForbidden,
    404: errorResponse("Module or link not found"),
    409: errorResponse("The module is archived, or already has this link"),
  },
});

export const deleteModuleLinkRoute = createRoute({
  method: "delete",
  operationId: "deleteModuleLink",
  path: "/{id}/links/{linkId}",
  tags: TAGS,
  summary: "Delete module link",
  description: "Delete a link of the module.",
  middleware: [...updateModuleMiddleware] as const,
  request: { params: moduleLinkParam },
  responses: {
    200: jsonResponse("The deleted link", moduleLinkDeleteResultSchema),
    403: updateForbidden,
    404: errorResponse("Module or link not found"),
    409: archived,
  },
});
